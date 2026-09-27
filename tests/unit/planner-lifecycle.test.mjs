// planner-lifecycle.test.mjs —— V0.5.9 / R1：Planner Artifact Lifecycle 收口后的行为契约
//
// 覆盖：状态顺序（A）/ 骨架不得 FINALIZED+PUBLISHED（B）/ 发布后 digest 一致（C）/
//       显式阶段形态校验（§8）/ canonical digest 稳定（J）。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const L = await import(pathToFileURL(path.join(ROOT, "planner-lifecycle.mjs")).href);
const { PLANNER_PHASE, ARTIFACT_KIND, FINALIZATION_MODE, validatePlannerArtifact, normalizePlannedTasks,
        canonicalizePlannerArtifact, computePlanDigest, buildPlanId, attachPlanIdentity,
        finalizePlannerOutput, publishPlannerArtifact, planIdentityOf } = L;

const FAST = { pollMs: 100, stableSamples: 2, invalidStableSamples: 6, markerWaitMs: 1200 };
const mk = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r1-"));
  return { dir, tmp: path.join(dir, "_plan2.json.tmp"), done: path.join(dir, "_plan2.json.done"), final: path.join(dir, "_plan2.json") };
};
const write = (f, o) => fs.writeFileSync(f, typeof o === "string" ? o : JSON.stringify(o), "utf-8");
const cleanup = (d) => fs.rmSync(d, { recursive: true, force: true });
const task = (id) => ({ id, title: `${id} 任务`, description: "d", required_capability: "coding", acceptance_criteria: ["file: x"], requires_review: false });
const FULL = { plan: { goal: "g", assumptions: ["a"], architecture_decisions: [{ decision: "d1" }], memory_refs: [] }, tasks: [task("TASK-001"), task("TASK-002")] };
const SKELETON = { plan: { goal: "g", architecture_decisions: [], memory_refs: [{ memory_id: "decision-x", affected_output: "TASK-001", effect: "@M1@", reason: "@MR1@" }] }, tasks: [{ id: "TASK-001", title: "占位任务" }] };

// ── A：状态顺序 DRAFT → VALIDATED → FINALIZED → PUBLISHED ────────────────────
test("A(状态顺序): 非法/骨架停留在 DRAFT；完整输出经 VALIDATED→FINALIZED→PUBLISHED", async () => {
  const a = mk();
  try {
    write(a.tmp, SKELETON);                                   // 骨架（占位符）
    const r1 = await finalizePlannerOutput({ tmpFile: a.tmp, doneFile: a.done, kind: ARTIFACT_KIND.STAGE2, deadline: Date.now() + 2000, ...FAST });
    assert.equal(r1.ok, false, "骨架不得 FINALIZED");
    assert.equal(r1.phase, PLANNER_PHASE.DRAFT, "应停留在 DRAFT");

    write(a.tmp, FULL); write(a.done, "ok");
    const r2 = await finalizePlannerOutput({ tmpFile: a.tmp, doneFile: a.done, kind: ARTIFACT_KIND.STAGE2, deadline: Date.now() + 6000, ...FAST });
    assert.equal(r2.ok, true);
    assert.equal(r2.phase, PLANNER_PHASE.FINALIZED);
    assert.equal(r2.finalizationMode, FINALIZATION_MODE.MARKER);

    const pub = publishPlannerArtifact(a.tmp, a.final, { planId: "plan-stage2-001-abc123", finalizationMode: r2.finalizationMode });
    assert.equal(pub.ok, true, "发布应成功（PUBLISHED）");
    assert.equal(pub.planId, "plan-stage2-001-abc123");
    assert.ok(String(pub.planDigest).startsWith("sha256:"));
  } finally { cleanup(a.dir); }
});

// ── B：骨架绝不能进入 ACCEPTED（等价：不得 FINALIZED/PUBLISHED） ──────────────
test("B(骨架拦截): 语义非空但含占位符的骨架 → 永不 FINALIZED，且不产生 final artifact", async () => {
  const a = mk();
  try {
    write(a.tmp, SKELETON);
    write(a.done, "ok");                                     // 即使 LLM 声称完成
    const r = await finalizePlannerOutput({ tmpFile: a.tmp, doneFile: a.done, kind: ARTIFACT_KIND.STAGE2, deadline: Date.now() + 2500, ...FAST });
    assert.equal(r.ok, false, "占位符骨架不得定稿");
    assert.equal(fs.existsSync(a.final), false, "不得产生 final artifact");
  } finally { cleanup(a.dir); }
});

// ── 显式阶段形态（§8）：同一内容按不同 kind 判定不同 ────────────────────────
test("阶段形态: stage1/stage2/replan 各自校验，不靠 Array.isArray 猜测", () => {
  const s1 = { goal_understanding: "分析", expert_consultations: [] };
  assert.equal(validatePlannerArtifact(ARTIFACT_KIND.STAGE1, s1).ok, true);
  assert.equal(validatePlannerArtifact(ARTIFACT_KIND.STAGE2, s1).ok, false, "stage1 产物不是合法 stage2 产物");
  assert.equal(validatePlannerArtifact(ARTIFACT_KIND.STAGE2, FULL).ok, true);
  assert.equal(validatePlannerArtifact(ARTIFACT_KIND.REPLAN, [task("T-1")]).ok, true, "replan 支持数组形态");
  assert.equal(validatePlannerArtifact("bogus", FULL).ok, false, "未知 kind 必须失败");
  assert.deepEqual(validatePlannerArtifact(ARTIFACT_KIND.STAGE2, { tasks: [] }).errors.map((e) => e.code), ["no_valid_tasks"]);
});

// ── C：发布后 identity 与内容 digest 一致 ───────────────────────────────────
test("C(发布一致性): publish 注入 planId/planDigest，且 digest 与 canonical 内容一致", () => {
  const a = mk();
  try {
    write(a.tmp, FULL);
    const pub = publishPlannerArtifact(a.tmp, a.final, { planId: "plan-stage2-002-def456" });
    const onDisk = JSON.parse(fs.readFileSync(a.final, "utf-8"));
    assert.equal(onDisk.plan.planId, pub.planId);
    assert.equal(onDisk.plan.planDigest, pub.planDigest);
    assert.equal(computePlanDigest(onDisk), pub.planDigest, "磁盘 artifact 重新计算 digest 必须一致");
    assert.equal(fs.existsSync(a.tmp), false, "tmp 应被消费");
  } finally { cleanup(a.dir); }
});

// ── J：canonical digest 稳定（字段顺序无关） ────────────────────────────────
test("J(digest 稳定): 同内容不同键顺序 → digest 相同；内容变化 → digest 变化", () => {
  const x = { plan: { goal: "g", risks: ["r"], assumptions: ["a"] }, tasks: [task("T-1")] };
  const y = { tasks: [task("T-1")], plan: { assumptions: ["a"], goal: "g", risks: ["r"] } };
  assert.equal(computePlanDigest(x), computePlanDigest(y), "键顺序不得影响 digest");
  const z = { ...x, plan: { ...x.plan, goal: "g2" } };
  assert.notEqual(computePlanDigest(x), computePlanDigest(z), "内容变化必须改变 digest");
  // 身份字段不得影响 digest（digest 只表示 Plan 自身内容）
  const withId = attachPlanIdentity(x, { planId: "plan-x-001-aaaaaa" });
  assert.equal(computePlanDigest(withId), computePlanDigest(x), "身份字段不参与 digest");
  // stage1 内容（无 tasks）也参与 digest
  const s1a = attachPlanIdentity({ goal_understanding: "A", expert_consultations: [] }, { planId: "plan-stage1-001-zzz" });
  const s1b = attachPlanIdentity({ goal_understanding: "B", expert_consultations: [] }, { planId: "plan-stage1-001-zzz" });
  assert.notEqual(computePlanDigest(s1a), computePlanDigest(s1b), "stage1 内容差异必须反映在 digest");
});

// ── planId 语义：同 seq 同 kind 相同；不同 kind/seq 不同 ────────────────────
test("planId: 由 kind+seq+nonce 构成（同一 nonce 可复现，不同 nonce/seq 不同）", () => {
  const a = buildPlanId({ kind: ARTIFACT_KIND.STAGE2, seq: 1, nonce: "aaaaaa" });
  const b = buildPlanId({ kind: ARTIFACT_KIND.STAGE2, seq: 1, nonce: "aaaaaa" });
  const c = buildPlanId({ kind: ARTIFACT_KIND.STAGE2, seq: 2, nonce: "aaaaaa" });
  const d = buildPlanId({ kind: ARTIFACT_KIND.REPLAN, seq: 1, nonce: "aaaaaa" });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
  assert.match(a, /^plan-stage2-001-[0-9a-f]{6}$/);
  assert.notEqual(buildPlanId({ kind: ARTIFACT_KIND.STAGE2, seq: 1 }), buildPlanId({ kind: ARTIFACT_KIND.STAGE2, seq: 1 }), "默认 nonce 随机 ⇒ 两次生成不同");
});

// ── 兼容性：normalizePlannedTasks 过滤语义不变（Bug #5） ─────────────────────
test("回归(Bug#5): normalizePlannedTasks 仍安全过滤非法元素", () => {
  const n = normalizePlannedTasks({ tasks: ["__TASK007__", task("TASK-001"), null, { id: "  " }] });
  assert.equal(n.tasks.length, 1);
  assert.equal(n.dropped, 3);
});
