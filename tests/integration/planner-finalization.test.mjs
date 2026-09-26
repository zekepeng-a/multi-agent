// planner-finalization.test.mjs —— V0.5.8 / Bug #10：Planner Output Finalization Protocol
//
// 核心命题：**"文件稳定 + 语义非空" ≠ "最终输出"**。
// 旧行为：LLM 先落一个"合法骨架"（含占位符 @M1@、tasks 少、refs 少）→ 稳定 → 谓词满足 → 被采纳。
// 新行为：DRAFT(.tmp) → 形状完整(VALIDATED) → done 标记或稳定回退(FINALIZED) → 才被发布/采纳。
// 本测试用"受控 Writer"直接驱动真实的 finalization 逻辑（确定性，不依赖 LLM）。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { waitForFinalizedPlannerOutput, plannerOutputShapeComplete, publishPlannerOutput, semanticPlannerOutputComplete, normalizePlannedTasks } =
  await import(pathToFileURL(path.join(ROOT, "orchestrator.mjs")).href);

const FAST = { pollMs: 100, stableSamples: 2, invalidStableSamples: 6, markerWaitMs: 1500 };
const mk = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bug10-"));
  return { dir, tmp: path.join(dir, "_plan2.json.tmp"), done: path.join(dir, "_plan2.json.done"), final: path.join(dir, "_plan2.json") };
};
const write = (f, obj) => fs.writeFileSync(f, typeof obj === "string" ? obj : JSON.stringify(obj), "utf-8");
const cleanup = (d) => fs.rmSync(d, { recursive: true, force: true });

const task = (id, title) => ({ id, title: title || `${id} 任务`, description: "d", required_capability: "coding", acceptance_criteria: ["file: x"], requires_review: false });

/** Bug #10 现场形态的"骨架"：合法 JSON、tasks 非空、但含占位符且内容不完整 */
const SKELETON = {
  plan: { goal: "g", assumptions: ["a"], expert_consultations: [], risks: [], architecture_decisions: [], memory_refs: [{ memory_id: "decision-add52d34", affected_output: "TASK-002", stance: "adopted", effect: "@M1@", reason: "@MR1@" }] },
  tasks: [task("TASK-001", "骨架任务"), { id: "TASK-002", title: "占位任务" }],
};
/** 真正完整的 Planner 输出 */
const FULL = {
  plan: {
    goal: "g", assumptions: ["a1", "a2"], expert_consultations: [], risks: ["r1"],
    architecture_decisions: [{ decision: "d1" }, { decision: "d2" }],
    memory_refs: Array.from({ length: 10 }, (_, i) => ({ memory_id: `decision-m${i}`, affected_output: "TASK-002", stance: "adopted", effect: `继承第 ${i} 条约束的具体规则`, reason: "r" })),
  },
  tasks: [task("TASK-001"), task("TASK-002"), task("TASK-003"), task("TASK-004"), task("TASK-005")],
};

// ── 谓词单元：骨架 vs 完整 ───────────────────────────────────────────────────
test("谓词: 占位符骨架 shape=false，完整输出 shape=true（语义谓词对两者都为 true）", () => {
  assert.equal(semanticPlannerOutputComplete(SKELETON), true, "语义谓词确实会被骨架骗过（这是 Bug #10 的根因）");
  assert.equal(plannerOutputShapeComplete(SKELETON), false, "形状谓词必须识破骨架");
  assert.equal(plannerOutputShapeComplete(FULL), true);
});

// ── Test 1：Bug #10 原场景（骨架 → 停顿 → 完整） ──────────────────────────────
test("Test1(Bug#10 原场景): 骨架 → 停顿 → 完整输出 ⇒ 只采纳完整版本", async () => {
  const { dir, tmp, done } = mk();
  try {
    write(tmp, SKELETON);                                  // t=0 合法骨架
    setTimeout(() => { write(tmp, FULL); write(done, "ok"); }, 1200); // 停顿后写完整 + 完成标记
    const r = await waitForFinalizedPlannerOutput({ tmpFile: tmp, doneFile: done, deadline: Date.now() + 10000, ...FAST });
    assert.equal(r.ok, true, "应成功");
    assert.equal(r.mode, "marker");
    assert.equal(r.parsed.tasks.length, 5, "必须是完整版本的 5 个任务，而不是骨架的 2 个");
    assert.equal(r.parsed.plan.memory_refs.length, 10, "必须是完整版本的 10 条 memory_refs");
    assert.equal(r.parsed.plan.architecture_decisions.length, 2);
  } finally { cleanup(dir); }
});

// ── Test 2：骨架永远不继续 ⇒ 不得采纳 ────────────────────────────────────────
test("Test2: 骨架稳定且永不更新 ⇒ 失败（绝不采纳骨架）", async () => {
  const { dir, tmp, done } = mk();
  try {
    write(tmp, SKELETON);
    const t0 = Date.now();
    const r = await waitForFinalizedPlannerOutput({ tmpFile: tmp, doneFile: done, deadline: Date.now() + 2500, ...FAST });
    const elapsed = Date.now() - t0;
    assert.equal(r.ok, false, "骨架不得被采纳");
    assert.equal(r.reason, "timeout");
    assert.ok(elapsed < 4000, `应在 deadline 附近结束（实际 ${elapsed}ms）`);
  } finally { cleanup(dir); }
});

// ── Test 3：完整输出一次性写入 ⇒ 直接成功、无额外等待 ────────────────────────
test("Test3: 完整输出 + 完成标记一次写入 ⇒ 快速成功（无额外等待）", async () => {
  const { dir, tmp, done } = mk();
  try {
    write(tmp, FULL);
    write(done, "ok");
    const t0 = Date.now();
    const r = await waitForFinalizedPlannerOutput({ tmpFile: tmp, doneFile: done, deadline: Date.now() + 10000, ...FAST });
    const elapsed = Date.now() - t0;
    assert.equal(r.ok, true);
    assert.equal(r.mode, "marker");
    assert.ok(elapsed < 1200, `应立即返回（实际 ${elapsed}ms）`);
    assert.equal(r.parsed.tasks.length, 5);
  } finally { cleanup(dir); }
});

// ── Test 4：非法 JSON 半写 → 持续变化 → 合法完整（Bug #4 不回归） ─────────────
test("Test4: 非法 JSON 半写 → 持续增长 → 合法完整 + 标记 ⇒ 成功（Bug #4）", async () => {
  const { dir, tmp, done } = mk();
  try {
    const full = JSON.stringify(FULL);
    let i = 10;
    fs.writeFileSync(tmp, full.slice(0, i), "utf-8");
    const g = setInterval(() => {
      i += Math.ceil(full.length / 6);
      if (i >= full.length) { write(tmp, FULL); write(done, "ok"); clearInterval(g); }
      else fs.writeFileSync(tmp, full.slice(0, i), "utf-8");
    }, 200);
    const r = await waitForFinalizedPlannerOutput({ tmpFile: tmp, doneFile: done, deadline: Date.now() + 12000, ...FAST });
    clearInterval(g);
    assert.equal(r.ok, true);
    assert.equal(r.parsed.tasks.length, 5);
  } finally { cleanup(dir); }
});

// ── Test 5：永久非法 JSON ⇒ 陈旧提前失败（Bug #8 不回归） ─────────────────────
test("Test5: 永久非法 JSON + 稳定 ⇒ stale_invalid 提前失败（Bug #8）", async () => {
  const { dir, tmp, done } = mk();
  try {
    fs.writeFileSync(tmp, '{"plan":{"goal":"g"},"tasks":[{"id":"T-1"', "utf-8"); // 永久非法（截断）
    const t0 = Date.now();
    const r = await waitForFinalizedPlannerOutput({ tmpFile: tmp, doneFile: done, deadline: Date.now() + 8000, ...FAST });
    const elapsed = Date.now() - t0;
    assert.equal(r.ok, false);
    assert.equal(r.reason, "stale_invalid_json");
    assert.ok(elapsed < 4000, `应明显早于 deadline（实际 ${elapsed}ms）`);
  } finally { cleanup(dir); }
});

// ── Test 6：合法但语义不完整（tasks 为空）⇒ 不采纳（Bug #7 不回归） ──────────
test("Test6: {tasks:[]} 或其等价空任务 ⇒ 不采纳；补全后才采纳（Bug #7）", async () => {
  const { dir, tmp, done } = mk();
  try {
    write(tmp, { plan: { goal: "g" }, tasks: [] });
    setTimeout(() => { write(tmp, FULL); write(done, "ok"); }, 900);
    const r = await waitForFinalizedPlannerOutput({ tmpFile: tmp, doneFile: done, deadline: Date.now() + 10000, ...FAST });
    assert.equal(r.ok, true);
    assert.equal(r.parsed.tasks.length, 5, "必须等到补全后的版本");
  } finally { cleanup(dir); }
});

// ── Test 7：非法 task element（占位符）⇒ 骨架不采纳，补全后过滤仍生效（Bug #5） ──
test("Test7: tasks 含 __TASK007__ 占位符 ⇒ 不视为完成；完整版本中 normalize 仍安全过滤（Bug #5）", async () => {
  const { dir, tmp, done } = mk();
  try {
    write(tmp, { plan: { goal: "g" }, tasks: [task("TASK-001"), "__TASK007__", { id: "TASK-003" }] });
    // 完整版本中故意保留一个非法元素，验证 normalize 仍过滤、不崩溃
    const fullWithJunk = { ...FULL, tasks: [...FULL.tasks, "__JUNK__", null] };
    setTimeout(() => { write(tmp, fullWithJunk); write(done, "ok"); }, 900);
    const r = await waitForFinalizedPlannerOutput({ tmpFile: tmp, doneFile: done, deadline: Date.now() + 10000, ...FAST });
    assert.equal(r.ok, true);
    const norm = normalizePlannedTasks(r.parsed);
    assert.equal(norm.tasks.length, 5, "非法元素被安全过滤");
    assert.equal(norm.dropped, 2);
  } finally { cleanup(dir); }
});

// ── Test 8：memory_refs 骨架（1 task / 1 ref / @M1@）⇒ 必须采纳 5/10 版本 ────
test("Test8(V0.5.7 场景): refs 骨架 1 条 → 完整 10 条 ⇒ Runtime 只能看到 10 条", async () => {
  const { dir, tmp, done } = mk();
  try {
    write(tmp, SKELETON);
    setTimeout(() => { write(tmp, FULL); write(done, "ok"); }, 1000);
    const r = await waitForFinalizedPlannerOutput({ tmpFile: tmp, doneFile: done, deadline: Date.now() + 10000, ...FAST });
    assert.equal(r.ok, true);
    assert.equal(r.parsed.plan.memory_refs.length, 10);
    assert.notEqual(r.parsed.plan.memory_refs[0].effect, "@M1@", "不得采纳占位符 effect");
  } finally { cleanup(dir); }
});

// ── 附加 1：done 标记缺失但形状完整 ⇒ stability_fallback（可用性兜底，仍不采纳骨架） ──
test("附加1: 形状完整但缺少 done 标记 ⇒ 稳定回退发布（mode=stability_fallback）", async () => {
  const { dir, tmp, done } = mk();
  try {
    write(tmp, FULL);
    const r = await waitForFinalizedPlannerOutput({ tmpFile: tmp, doneFile: done, deadline: Date.now() + 8000, ...FAST, markerWaitMs: 900 });
    assert.equal(r.ok, true);
    assert.equal(r.mode, "stability_fallback");
    assert.equal(r.parsed.tasks.length, 5);
  } finally { cleanup(dir); }
});

// ── 附加 2：publish 原子性（tmp → final，final 内容 = 校验通过内容） ─────────
test("附加2: publishPlannerOutput 将 tmp 发布为 final，且 tmp 不再存在", () => {
  const { dir, tmp, final } = mk();
  try {
    write(tmp, FULL);
    const how = publishPlannerOutput(tmp, final);
    assert.ok(["rename", "copy"].includes(how));
    assert.equal(fs.existsSync(tmp), false, "tmp 应被消费");
    const published = JSON.parse(fs.readFileSync(final, "utf-8"));
    assert.equal(published.tasks.length, 5);
    // 覆盖发布：final 已存在时仍应成功（Windows 下 rename 覆盖语义 / copy 回退）
    write(tmp, { plan: { goal: "g2" }, tasks: [task("TASK-009")] });
    const how2 = publishPlannerOutput(tmp, final);
    assert.ok(["rename", "copy"].includes(how2));
    assert.equal(JSON.parse(fs.readFileSync(final, "utf-8")).tasks[0].id, "TASK-009", "final 应被新版本覆盖");
  } finally { cleanup(dir); }
});
