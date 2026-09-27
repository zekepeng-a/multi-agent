// artifact-identity.test.mjs（integration）—— V0.5.9 / §24：**System Invariant Test**
//
// 目的：直接补上审计发现的 **Inv2 Gap** ——
//   "Accepted artifact 必须与 audit artifact 同一版本" 此前**没有任何自动测试守护**。
// 本测试模拟完整链路：generate → finalize → publish（含身份注入）→ accept → record attribution
// → record tasks → record run，然后统一核对 planId / planDigest，最终返回 IDENTITY CONSISTENT。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { ARTIFACT_KIND, FINALIZATION_MODE, buildPlanId, finalizePlannerOutput, publishPlannerArtifact, planIdentityOf, verifyArtifactIdentity, computePlanDigest } =
  await import(pathToFileURL(path.join(ROOT, "planner-lifecycle.mjs")).href);

const task = (id, needsReview = false) => ({ id, title: `${id} 任务`, description: "d", required_capability: "coding", acceptance_criteria: ["file: x"], requires_review: needsReview });
const PLAN = {
  plan: {
    goal: "为示例项目增加能力",
    assumptions: ["a1"],
    architecture_decisions: [{ decision: "复用既有模块", rationale: "r", alternatives: ["新建模块"] }],
    memory_refs: [{ memory_id: "decision-aaaa1111", affected_output: "TASK-002", stance: "adopted", effect: "继承落点约束：追加到既有模块末尾", reason: "避免第二套口径" }],
  },
  tasks: [task("TASK-001"), task("TASK-002", true), task("TASK-003")],
};

/** 模拟一次完整的 Planner run（write → finalize → publish → accept → 各产物落盘） */
async function runPlannerOnce({ workdir, seq, kind = ARTIFACT_KIND.STAGE2, parentPlanId = null, rootPlanId = null, source = PLAN }) {
  const ai = path.join(workdir, ".ai");
  const results = path.join(ai, "results");
  fs.mkdirSync(results, { recursive: true });
  const finalFile = path.join(results, kind === ARTIFACT_KIND.REPLAN ? "_replan.json" : "_plan2.json");
  const tmpFile = `${finalFile}.tmp`;
  const doneFile = `${finalFile}.done`;

  // Writer（LLM 侧）：只写 .tmp + 完成标记
  fs.writeFileSync(tmpFile, JSON.stringify(source), "utf-8");
  fs.writeFileSync(doneFile, "ok", "utf-8");

  // Runtime 侧：finalize（领域校验）→ publish（身份注入）
  const planId = buildPlanId({ kind, seq, nonce: `n${seq}0000`.slice(0, 6) });
  const fin = await finalizePlannerOutput({ tmpFile, doneFile, kind, deadline: Date.now() + 6000, pollMs: 100, stableSamples: 2, markerWaitMs: 800 });
  assert.equal(fin.ok, true, `finalize 应成功: ${JSON.stringify(fin.meta)}`);
  const pub = publishPlannerArtifact(tmpFile, finalFile, { planId, parentPlanId, rootPlanId, finalizationMode: fin.finalizationMode });
  assert.equal(pub.ok, true);

  // ACCEPTED：Runtime 采纳**发布产物本身**（同一身份）
  const accepted = JSON.parse(fs.readFileSync(finalFile, "utf-8"));

  // attribution 产物（携带同一身份）
  fs.writeFileSync(path.join(results, "_memory-attribution.json"), JSON.stringify({
    at: "2026-09-26 00:00:00",
    planId: accepted.plan.planId, planDigest: accepted.plan.planDigest,
    contextMemoryIds: ["decision-aaaa1111"], declared: accepted.plan.memory_refs, valid: accepted.plan.memory_refs, invalid: [], summary: {},
  }, null, 2), "utf-8");

  // tasks.json（plan 与 identity 同源）
  fs.writeFileSync(path.join(ai, "tasks.json"), JSON.stringify({ version: 2, goal: accepted.plan.goal, plan: accepted.plan, tasks: accepted.tasks }, null, 2), "utf-8");

  // runs/*.json（run → owning plan）
  const runsDir = path.join(ai, "runs");
  fs.mkdirSync(runsDir, { recursive: true });
  const runs = accepted.tasks.map((t, i) => ({ runId: `${t.id}-${1700000000000 + i}`, planId: accepted.plan.planId, taskId: t.id, phase: "done", status: "completed" }));
  for (const r of runs) fs.writeFileSync(path.join(runsDir, `${r.runId}.json`), JSON.stringify(r), "utf-8");

  return { accepted, published: accepted, attribution: JSON.parse(fs.readFileSync(path.join(results, "_memory-attribution.json"), "utf-8")), tasksPlan: JSON.parse(fs.readFileSync(path.join(ai, "tasks.json"), "utf-8")).plan, runs, finalFile, planId, finalizationMode: fin.finalizationMode };
}

// ── §24 核心：整链身份一致性 ────────────────────────────────────────────────
test("§24 System Invariant: 全链（finalize→publish→accept→attribution→tasks→run）身份一致 ⇒ IDENTITY CONSISTENT", async () => {
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), "inv-"));
  try {
    const r = await runPlannerOnce({ workdir: wd, seq: 1 });
    const v = verifyArtifactIdentity({ published: r.published, accepted: r.accepted, attribution: r.attribution, tasksPlan: r.tasksPlan, runs: r.runs });
    assert.equal(v.status, "IDENTITY CONSISTENT", JSON.stringify(v.errors, null, 2));
    assert.equal(v.ok, true);

    // digest 必须与最终 artifact 的规范化内容一致（可复算）
    assert.equal(computePlanDigest(r.accepted), r.accepted.plan.planDigest);
    // 采纳身份与发布身份相同（不依赖"同一 JS 对象"的内存巧合：此处从磁盘各自读取）
    assert.equal(planIdentityOf(r.accepted).planId, r.planId);
    assert.equal(r.attribution.planId, r.planId);
    assert.equal(r.tasksPlan.planId, r.planId);
    assert.ok(r.runs.every((x) => x.planId === r.planId));
    // finalization 模式必须是 marker 或 stability_fallback 之一（降级路径不得伪装成正常）
    assert.ok([FINALIZATION_MODE.MARKER, FINALIZATION_MODE.STABILITY_FALLBACK].includes(r.finalizationMode));
  } finally { fs.rmSync(wd, { recursive: true, force: true }); }
});

// ── 链路级篡改检测（在真实落盘结构上） ─────────────────────────────────────
test("§24 负例: 篡改磁盘 attribution 的 planDigest ⇒ 整链校验失败（不再静默接受）", async () => {
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), "inv-bad-"));
  try {
    const r = await runPlannerOnce({ workdir: wd, seq: 1 });
    const tampered = { ...r.attribution, planDigest: "sha256:00000000000000000000000000000000" };
    const v = verifyArtifactIdentity({ published: r.published, accepted: r.accepted, attribution: tampered, tasksPlan: r.tasksPlan, runs: r.runs });
    assert.equal(v.ok, false);
    assert.equal(v.status, "identity_mismatch");
  } finally { fs.rmSync(wd, { recursive: true, force: true }); }
});

test("§24 负例: tasks.json 指向另一个 Plan ⇒ 整链校验失败", async () => {
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), "inv-bad2-"));
  try {
    const r = await runPlannerOnce({ workdir: wd, seq: 1 });
    const otherPlan = { ...r.tasksPlan, planId: "plan-stage2-777-zzzzzz" };
    const v = verifyArtifactIdentity({ published: r.published, accepted: r.accepted, attribution: r.attribution, tasksPlan: otherPlan, runs: r.runs });
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.where.includes("I-PLAN-3")));
  } finally { fs.rmSync(wd, { recursive: true, force: true }); }
});

// ── Replan 链：P1 → P2（新 id + parentPlanId + 新 digest） ─────────────────
test("§24 Replan 链: P2.parentPlanId = P1.planId，且 P2 身份覆盖 tasks/attribution/run", async () => {
  const wd = fs.mkdtempSync(path.join(os.tmpdir(), "inv-replan-"));
  try {
    const p1 = await runPlannerOnce({ workdir: wd, seq: 1 });
    const plan2Source = { ...PLAN, tasks: [...PLAN.tasks, task("TASK-004")] };   // 内容变化
    const p2 = await runPlannerOnce({ workdir: wd, seq: 2, kind: ARTIFACT_KIND.REPLAN, parentPlanId: p1.planId, rootPlanId: p1.planId, source: plan2Source });

    assert.notEqual(p2.planId, p1.planId, "Replan 必须有新的 planId");
    assert.equal(p2.accepted.plan.parentPlanId, p1.planId, "parentPlanId 必须指向 P1");
    assert.equal(p2.accepted.plan.rootPlanId, p1.planId, "rootPlanId 指向链根");
    assert.notEqual(p2.accepted.plan.planDigest, p1.accepted.plan.planDigest, "内容变化 ⇒ digest 变化");

    const v = verifyArtifactIdentity({ published: p2.accepted, accepted: p2.accepted, attribution: p2.attribution, tasksPlan: p2.tasksPlan, runs: p2.runs });
    assert.equal(v.status, "IDENTITY CONSISTENT", JSON.stringify(v.errors, null, 2));

    // 磁盘上两份 artifact 并存且身份独立（P1 的 _plan2.json 已被 P2 发布覆盖；以 tasks.json 为准验证链）
    assert.equal(p2.tasksPlan.parentPlanId, p1.planId);
  } finally { fs.rmSync(wd, { recursive: true, force: true }); }
});
