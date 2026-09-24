// planner-semantic.test.mjs —— V0.5.4 / Bug #7 回归：Planner 输出「语义完成」判据
//
// 核心命题：文件稳定 ≠ 内容完成。
// 场景：LLM 分阶段写入 → 先落 `{tasks:[]}`（JSON 合法、大小稳定）→ 稍后才写入真实 tasks。
// 旧行为：waitForStableJson 在稳定判据满足时即返回 → plan() 见 tasks.length===0 → 误判失败 → 回退 DAG。
// 新行为：Planner 层注入语义完成谓词 → 持续等待直到 tasks 非空且含合法任务。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { waitForStableJson, semanticPlannerOutputComplete, semanticConsultationsComplete, normalizePlannedTasks } =
  await import(pathToFileURL(path.join(ROOT, "orchestrator.mjs")).href);

const tmpFile = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bug7-")), name);
const write = (f, obj) => fs.writeFileSync(f, JSON.stringify(obj), "utf-8");

// ── Test 1（核心）：{tasks:[]} 短暂稳定 → 稍后写入真实 tasks → 必须接受后者 ─────────
test("Test1: tasks 暂时为空（大小稳定）不应被当作完成，应等到真实 tasks", async () => {
  const f = tmpFile("_plan2.json");
  write(f, { plan: { goal: "g" }, tasks: [] });               // 阶段一：合法但任务为空
  const t0 = Date.now();
  const late = setTimeout(() => write(f, { plan: { goal: "g" }, tasks: [{ id: "TASK-001", title: "a" }, { id: "TASK-002", title: "b" }] }), 2500);

  const parsed = await waitForStableJson(f, Date.now() + 15000, { pollMs: 200, stableSamples: 2, isComplete: semanticPlannerOutputComplete });
  clearTimeout(late);
  assert.equal(parsed.tasks.length, 2, "必须接受真实 tasks 版本，而不是空的中间态");
  assert.ok(Date.now() - t0 >= 2400, "应在空 tasks 稳定后继续等待（未提前返回）");
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});

// ── Test 2：`{}`（无 tasks 字段）不能直接判定完成 ───────────────────────────────
test("Test2: 空对象 {} 不是完成态（不能直接 fallback）", async () => {
  const f = tmpFile("_plan2.json");
  write(f, {});
  const late = setTimeout(() => write(f, { tasks: [{ id: "T-1" }] }), 2000);
  const parsed = await waitForStableJson(f, Date.now() + 12000, { pollMs: 200, stableSamples: 2, isComplete: semanticPlannerOutputComplete });
  clearTimeout(late);
  assert.ok(Array.isArray(parsed.tasks) && parsed.tasks.length === 1, "应等到真正含任务的版本");
  assert.equal(semanticPlannerOutputComplete({}), false, "{} 语义未完成");
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});

// ── Test 3：tasks 空 + architecture_decisions 空 → 仍非完成态 ────────────────────
test("Test3: {tasks:[],architecture_decisions:[]} 不是完成态", async () => {
  const f = tmpFile("_plan2.json");
  write(f, { plan: { architecture_decisions: [] }, tasks: [] });
  const late = setTimeout(() => write(f, { plan: { architecture_decisions: [] }, tasks: [{ id: "T-1" }, { id: "T-2" }] }), 2000);
  const parsed = await waitForStableJson(f, Date.now() + 12000, { pollMs: 200, stableSamples: 2, isComplete: semanticPlannerOutputComplete });
  clearTimeout(late);
  assert.equal(parsed.tasks.length, 2);
  assert.equal(semanticPlannerOutputComplete({ tasks: [], architecture_decisions: [] }), false);
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});

// ── Test 4：完整 Planner 输出 → 正常接受（不引入额外延迟） ───────────────────────
test("Test4: 合法完整的 Planner 输出被立即接受", async () => {
  const f = tmpFile("_plan2.json");
  const full = { plan: { goal: "g", architecture_decisions: [{ decision: "d", rationale: "r" }] }, tasks: [{ id: "TASK-001" }, { id: "TASK-002" }] };
  write(f, full);
  const t0 = Date.now();
  const parsed = await waitForStableJson(f, Date.now() + 10000, { pollMs: 100, stableSamples: 2, isComplete: semanticPlannerOutputComplete });
  assert.equal(parsed.tasks.length, 2);
  assert.ok(Date.now() - t0 < 1000, "完整输出应在稳定判据满足后立即返回（无额外等待）");
  assert.equal(semanticPlannerOutputComplete(full), true);
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});

// ── Test 5：半写 JSON 保护保持（Bug #4） ────────────────────────────────────────
test("Test5: 半写 JSON 仍被保护（等待到可解析，Bug #4 不回归）", async () => {
  const f = tmpFile("_plan2.json");
  const full = JSON.stringify({ tasks: [{ id: "T-1" }] });
  fs.writeFileSync(f, full.slice(0, 8), "utf-8");             // 半写
  setTimeout(() => fs.writeFileSync(f, full, "utf-8"), 1200);
  const parsed = await waitForStableJson(f, Date.now() + 10000, { pollMs: 200, stableSamples: 2, isComplete: semanticPlannerOutputComplete });
  assert.equal(parsed.tasks[0].id, "T-1");
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});

// ── Test 6：含非法任务元素 → 保持既有 normalization 行为（Bug #5） ───────────────
test("Test6: 非法任务元素仍按既有 normalization 过滤（Bug #5 不回归）", () => {
  const parsed = { tasks: ["__TASK007__", { id: "TASK-001" }, null, { id: "  " }] };
  const norm = normalizePlannedTasks(parsed);
  assert.equal(norm.tasks.length, 1);
  assert.equal(norm.dropped, 3);
  assert.equal(semanticPlannerOutputComplete(parsed), true, "过滤后仍有合法任务 → 视为完成");
  assert.equal(semanticPlannerOutputComplete({ tasks: ["__TASK007__"] }), false, "全为非法元素 → 未完成（继续等待）");
});

// ── 额外：阶段1（consultations）谓词与数组形态兼容 ──────────────────────────────
test("附加: 阶段1 谓词（goal_understanding / expert_consultations）与 replan 数组形态", () => {
  assert.equal(semanticConsultationsComplete({ goal_understanding: "x", expert_consultations: [] }), true);
  assert.equal(semanticConsultationsComplete({ expert_consultations: [{ role: "architect" }] }), true);
  assert.equal(semanticConsultationsComplete({}), false);
  assert.equal(semanticConsultationsComplete(null), false);
  // replan 直接输出数组
  assert.equal(semanticPlannerOutputComplete([{ id: "T-1" }]), true);
  assert.equal(semanticPlannerOutputComplete([]), false);
});

// ── 附加：旧行为记录（无谓词时确实会提前返回空 tasks —— 机制复现） ──────────────
test("附加: 无谓词时（通用能力不变）仍会在稳定时返回中间态（机制复现）", async () => {
  const f = tmpFile("_plan2.json");
  write(f, { tasks: [] });
  const late = setTimeout(() => write(f, { tasks: [{ id: "T-1" }] }), 3000);
  const parsed = await waitForStableJson(f, Date.now() + 10000, { pollMs: 200, stableSamples: 2 }); // 不传谓词
  clearTimeout(late);
  assert.equal(parsed.tasks.length, 0, "通用函数保持原语义：稳定即返回（这正是 Bug #7 的机制）");
  fs.rmSync(path.dirname(f), { recursive: true, force: true });
});
