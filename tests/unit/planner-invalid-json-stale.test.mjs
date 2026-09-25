// planner-invalid-json-stale.test.mjs —— V0.5.5 / Bug #8 回归：陈旧非法 JSON 提前失败
//
// 背景：Bug #4 的策略是「JSON 非法 ⇒ 假设仍在写 ⇒ 继续等待」。该策略对**正在增长的半写**正确，
// 但对**已停止变化且内容永久非法**的产物（如 LLM 一次性写出 31.5KB 语法错误 JSON）会空等至 deadline（420s）。
// V0.5.5 增加「陈旧非法」判据：大小稳定且解析失败累计达到 invalidStableSamples ⇒ 提前返回 null。
// 必须同时保证：文件一旦继续变化即重置计数（Bug #4 半写保护不回归）、合法但语义不完整仍继续等待（Bug #7 不回归）。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { waitForStableJson, semanticPlannerOutputComplete } = await import(pathToFileURL(path.join(ROOT, "orchestrator.mjs")).href);

// 测试用快速参数：pollMs=100, stableSamples=2 ⇒ 每次解析尝试约 200ms；invalidStableSamples=5 ⇒ stale≈1s
const FAST = { pollMs: 100, stableSamples: 2, invalidStableSamples: 5 };
const tmp = (name = "_plan2.json") => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bug8-"));
  return { dir, file: path.join(dir, name) };
};
const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// ── Test 1：永久非法 JSON + 文件稳定 ⇒ 明显早于 deadline 提前失败 ─────────────────
test("Test1: 永久非法 JSON + 稳定文件 → 提前失败（远早于 deadline），并报告 stale_invalid_json", async () => {
  const { dir, file } = tmp();
  fs.writeFileSync(file, '{"plan":{"goal":"g"},"tasks":[{"id":"T-1"', "utf-8"); // 永久非法（截断）
  const deadline = Date.now() + 5000; // 5s deadline
  const t0 = Date.now();
  let stale = null;
  const parsed = await waitForStableJson(file, deadline, { ...FAST, onStaleInvalid: (info) => { stale = info; } });
  const elapsed = Date.now() - t0;
  assert.equal(parsed, null, "应返回 null（失败）");
  assert.ok(stale, "应触发 onStaleInvalid 回调");
  assert.equal(stale.reason, "stale_invalid_json");
  assert.ok(elapsed < 2500, `应明显早于 deadline（实际 ${elapsed}ms < 2500ms，deadline=5000ms）`);
  assert.ok(elapsed >= 800, `不应过早失败（实际 ${elapsed}ms）`);
  cleanup(dir);
});

// ── Test 2：非法 → 持续变化 → 最终合法 ⇒ 接受（半写保护） ─────────────────────────
test("Test2: 非法 JSON + 文件持续变化 → 最终合法 JSON ⇒ 成功接受", async () => {
  const { dir, file } = tmp();
  const full = JSON.stringify({ tasks: [{ id: "T-1" }, { id: "T-2" }] });
  fs.writeFileSync(file, full.slice(0, 10), "utf-8");
  const timers = [
    setTimeout(() => fs.writeFileSync(file, full.slice(0, 20), "utf-8"), 250),
    setTimeout(() => fs.writeFileSync(file, full.slice(0, 31), "utf-8"), 500),
    setTimeout(() => fs.writeFileSync(file, full, "utf-8"), 750),
  ];
  const parsed = await waitForStableJson(file, Date.now() + 10000, FAST);
  timers.forEach(clearTimeout);
  assert.ok(parsed && parsed.tasks.length === 2, "必须等到完整 JSON（半写不得被误杀为 stale）");
  cleanup(dir);
});

// ── Test 3：非法 → 短暂稳定 → 很快恢复 ⇒ 不能立即判 stale ─────────────────────────
test("Test3: 非法 JSON 短暂稳定后很快恢复 → 不判 stale", async () => {
  const { dir, file } = tmp();
  fs.writeFileSync(file, '{"tasks":[', "utf-8"); // 非法
  // 稳定约 2 次解析尝试（≈400ms）后恢复为合法（阈值 5 ⇒ 不应触发 stale）
  setTimeout(() => fs.writeFileSync(file, JSON.stringify({ tasks: [{ id: "T-1" }] }), "utf-8"), 700);
  let stale = null;
  const parsed = await waitForStableJson(file, Date.now() + 8000, { ...FAST, onStaleInvalid: (i) => { stale = i; } });
  assert.equal(stale, null, "短暂稳定不得判 stale");
  assert.ok(parsed && parsed.tasks.length === 1, "应最终接受合法 JSON");
  cleanup(dir);
});

// ── Test 4：合法但语义不完整（Bug #7 不回归） ────────────────────────────────────
test("Test4: 合法但 tasks 为空 → 继续等待（Bug #7 不回归）", async () => {
  const { dir, file } = tmp();
  fs.writeFileSync(file, JSON.stringify({ plan: { goal: "g" }, tasks: [] }), "utf-8");
  setTimeout(() => fs.writeFileSync(file, JSON.stringify({ plan: { goal: "g" }, tasks: [{ id: "T-1" }] }), "utf-8"), 900);
  let stale = null;
  const parsed = await waitForStableJson(file, Date.now() + 8000, {
    ...FAST,
    isComplete: semanticPlannerOutputComplete,
    onStaleInvalid: (i) => { stale = i; },
  });
  assert.equal(stale, null, "合法但语义未完成不是 stale invalid（不得混为一谈）");
  assert.equal(parsed.tasks.length, 1, "应等到语义完整版本");
  cleanup(dir);
});

// ── Test 5：完整合法输出 ⇒ 立即接受（无额外延迟） ────────────────────────────────
test("Test5: 完整合法 Planner 输出 → 立即接受（无额外延迟）", async () => {
  const { dir, file } = tmp();
  fs.writeFileSync(file, JSON.stringify({ plan: { goal: "g" }, tasks: [{ id: "T-1" }, { id: "T-2" }] }), "utf-8");
  const t0 = Date.now();
  const parsed = await waitForStableJson(file, Date.now() + 5000, { ...FAST, isComplete: semanticPlannerOutputComplete });
  const elapsed = Date.now() - t0;
  assert.equal(parsed.tasks.length, 2);
  assert.ok(elapsed < 800, `应立即返回（实际 ${elapsed}ms；stale 判定不得引入额外延迟）`);
  cleanup(dir);
});

// ── Test 6：Bug #4 半写回归（内容持续增长 → 合法） ───────────────────────────────
test("Test6: Bug #4 半写回归——非法 JSON 内容持续增长 → 最终合法 ⇒ 成功", async () => {
  const { dir, file } = tmp();
  const full = JSON.stringify({ tasks: [{ id: "TASK-001" }, { id: "TASK-002" }, { id: "TASK-003" }] });
  let i = 5;
  fs.writeFileSync(file, full.slice(0, i), "utf-8");
  const growth = setInterval(() => {
    i += 12;
    if (i >= full.length) { fs.writeFileSync(file, full, "utf-8"); clearInterval(growth); }
    else fs.writeFileSync(file, full.slice(0, i), "utf-8");
  }, 150);
  const parsed = await waitForStableJson(file, Date.now() + 10000, FAST);
  clearInterval(growth);
  assert.ok(parsed && parsed.tasks.length === 3, "半写增长过程不得被判 stale，必须等到完整");
  cleanup(dir);
});

// ── Test 7：replan 路径（数组形态）不被破坏 ──────────────────────────────────────
test("Test7: replan 数组形态输出 —— 等待逻辑与语义谓词均适用", async () => {
  const { dir, file } = tmp("_replan.json");
  fs.writeFileSync(file, "[", "utf-8");                                  // 非法中间态
  setTimeout(() => fs.writeFileSync(file, JSON.stringify([{ id: "T-1" }, { id: "T-2" }]), "utf-8"), 600);
  const parsed = await waitForStableJson(file, Date.now() + 8000, { ...FAST, isComplete: semanticPlannerOutputComplete });
  assert.ok(Array.isArray(parsed), "replan 输出为数组形态");
  assert.equal(parsed.length, 2);
  cleanup(dir);
});

// ── Test 8：非法 + 持续变化直到 deadline ⇒ 仍遵守 deadline（不无限等待） ─────────
test("Test8: 非法 JSON 持续变化至 deadline → 仍遵守 deadline（不会无限等待）", async () => {
  const { dir, file } = tmp();
  let n = 1;
  fs.writeFileSync(file, "{", "utf-8");
  const churn = setInterval(() => { fs.writeFileSync(file, "{" + "x".repeat(n++), "utf-8"); }, 120); // 始终非法且持续变化
  const deadline = Date.now() + 2000;
  const t0 = Date.now();
  const parsed = await waitForStableJson(file, deadline, FAST);
  const elapsed = Date.now() - t0;
  clearInterval(churn);
  assert.equal(parsed, null, "无法解析 ⇒ 返回 null");
  assert.ok(elapsed >= 1900 && elapsed < 4000, `应在 deadline 附近结束（实际 ${elapsed}ms，deadline=2000ms）`);
  cleanup(dir);
});

// ── 附加：文件从不出现 ⇒ deadline 后 null（既有行为不回归） ─────────────────────
test("附加: 文件始终不存在 → deadline 后返回 null（既有行为不回归）", async () => {
  const { dir, file } = tmp("_missing.json");
  const deadline = Date.now() + 800;
  const parsed = await waitForStableJson(file, deadline, { ...FAST });
  assert.equal(parsed, null);
  cleanup(dir);
});
