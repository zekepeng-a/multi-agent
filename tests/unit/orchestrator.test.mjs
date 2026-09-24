// orchestrator.test.mjs —— 回归测试：Bug #4（planner 产物半写竞态）/ Bug #5（非法任务元素崩溃）
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { waitForStableJson, normalizePlannedTasks, readJsonStrict } = await import(pathToFileURL(path.join(ROOT, "orchestrator.mjs")).href);

// ── Bug #5：非法任务元素不得导致崩溃 ─────────────────────────────────────────

test("normalizePlannedTasks: 过滤占位符字符串（Bug #5 现场数据）", () => {
  const parsed = { tasks: ["__TASK007__", "__TASK008__", { id: "TASK-001", title: "ok" }] };
  const r = normalizePlannedTasks(parsed);
  assert.equal(r.tasks.length, 1, "仅保留合法对象");
  assert.equal(r.dropped, 2, "占位符字符串被丢弃");
  assert.equal(r.tasks[0].id, "TASK-001");
});

test("normalizePlannedTasks: 过滤非对象/缺 id/空 id", () => {
  const parsed = { tasks: [null, 42, "str", [], {}, { id: "  " }, { id: 123 }, { id: "T-1" }] };
  const r = normalizePlannedTasks(parsed);
  assert.equal(r.tasks.length, 1);
  assert.equal(r.dropped, 7);
});

test("normalizePlannedTasks: 非数组 tasks → 空结果（触发回退 DAG，不崩溃）", () => {
  for (const bad of [null, undefined, {}, { tasks: "x" }, { tasks: 5 }]) {
    const r = normalizePlannedTasks(bad);
    assert.equal(r.tasks.length, 0);
  }
});

test("normalizePlannedTasks: 对字符串元素设置属性不再抛错（Bug #5 崩溃点）", () => {
  const r = normalizePlannedTasks({ tasks: ["__TASK007__"] });
  // 过滤后任务集为空 → 上层走回退 DAG；关键是不抛 TypeError
  assert.doesNotThrow(() => { for (const t of r.tasks) t.status = "pending"; });
});

// ── Bug #4：planner 产物半写竞态 ────────────────────────────────────────────

test("waitForStableJson: 半写文件 → 等写完再返回（Bug #4 场景）", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-test-"));
  const file = path.join(dir, "_plan2.json");
  const full = JSON.stringify({ plan: { goal: "g" }, tasks: [{ id: "T-1" }, { id: "T-2" }] });
  // 先写一半
  fs.writeFileSync(file, full.slice(0, 20), "utf-8");
  // 800ms 后补全（模拟 LLM 继续写入）
  setTimeout(() => fs.writeFileSync(file, full, "utf-8"), 800);
  const parsed = await waitForStableJson(file, Date.now() + 10000, { pollMs: 100, stableSamples: 2 });
  assert.ok(parsed, "应等待到写完并解析成功");
  assert.equal(parsed.tasks.length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("waitForStableJson: 文件从不出现 → deadline 后返回 null", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-test-"));
  const t0 = Date.now();
  const parsed = await waitForStableJson(path.join(dir, "missing.json"), Date.now() + 600, { pollMs: 100 });
  assert.equal(parsed, null);
  assert.ok(Date.now() - t0 >= 500, "应等待至 deadline");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("waitForStableJson: 带 BOM 的完整文件可解析", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-test-"));
  const file = path.join(dir, "_plan.json");
  fs.writeFileSync(file, "\uFEFF" + JSON.stringify({ tasks: [{ id: "T-1" }] }), "utf-8");
  const parsed = await waitForStableJson(file, Date.now() + 3000, { pollMs: 100, stableSamples: 1 });
  assert.equal(parsed.tasks[0].id, "T-1");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("readJsonStrict: 非法 JSON → null（不抛错）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orch-test-"));
  const file = path.join(dir, "bad.json");
  fs.writeFileSync(file, '{"tasks": ["__TAIL__"', "utf-8"); // 截断（Replan #2 现场形态）
  assert.equal(readJsonStrict(file), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("orchestrator 可被 import 而不执行 main（入口守卫）", async () => {
  // 若 main() 被触发，会因缺少 CLI 参数而写入日志/退出——此处仅验证模块导出可用
  assert.equal(typeof waitForStableJson, "function");
  assert.equal(typeof normalizePlannedTasks, "function");
});
