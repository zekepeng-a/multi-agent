// artifact-identity.test.mjs —— V0.5.9 / R3：Plan Identity 契约（I-PLAN-1..5）
//
// 覆盖：D（不同 Plan 不共享 planId）/ E（Replan 的 parentPlanId）/ F（attribution 身份一致）/
//       G（篡改 attribution digest 必须被拒）/ H（篡改 tasks.planId 必须被拒）/ I（run.planId 归属）。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { buildPlanId, attachPlanIdentity, computePlanDigest, publishPlannerArtifact, planIdentityOf, verifyArtifactIdentity, ARTIFACT_KIND } =
  await import(pathToFileURL(path.join(ROOT, "planner-lifecycle.mjs")).href);

const task = (id) => ({ id, title: `${id} 任务`, description: "d", required_capability: "coding", acceptance_criteria: ["file: x"], requires_review: false });
const P1 = { plan: { goal: "P1 计划", architecture_decisions: [{ decision: "d1" }], memory_refs: [] }, tasks: [task("TASK-001"), task("TASK-002")] };
const P2 = { plan: { goal: "P1 计划", architecture_decisions: [{ decision: "d1" }], memory_refs: [] }, tasks: [task("TASK-001"), task("TASK-002"), task("TASK-003")] };
const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), "r3-"));
const cleanup = (d) => fs.rmSync(d, { recursive: true, force: true });

// ── D：不同 Plan 不共享 planId ─────────────────────────────────────────────
test("D(I-PLAN-8): 不同 Plan 的 planId 必须不同", () => {
  const a = buildPlanId({ kind: ARTIFACT_KIND.STAGE2, seq: 1 });
  const b = buildPlanId({ kind: ARTIFACT_KIND.STAGE2, seq: 1 });
  assert.notEqual(a, b, "同 seq 但独立运行的两个 Plan 不得共享 planId");
  assert.notEqual(buildPlanId({ kind: ARTIFACT_KIND.STAGE2, seq: 1 }), buildPlanId({ kind: ARTIFACT_KIND.STAGE2, seq: 2 }));
});

// ── E：Replan 的 parentPlanId 链（P1 → P2） ───────────────────────────────
test("E(I6): Replan 产生新 planId 且 parentPlanId 指向上一版 Plan", () => {
  const p1 = attachPlanIdentity(P1, { planId: "plan-stage2-001-aaaaaa" });
  const p2 = attachPlanIdentity(P2, { planId: "plan-replan-002-bbbbbb", parentPlanId: p1.plan.planId, rootPlanId: p1.plan.rootPlanId });
  assert.notEqual(p1.plan.planId, p2.plan.planId, "Replan 必须换 id");
  assert.equal(p2.plan.parentPlanId, p1.plan.planId, "parentPlanId(P2) = P1");
  assert.equal(p2.plan.rootPlanId, p1.plan.planId, "rootPlanId 指向链根");
  assert.notEqual(p1.plan.planDigest, p2.plan.planDigest, "内容不同 ⇒ digest 不同");
});

// ── F：attribution 与 accepted 身份一致 ────────────────────────────────────
test("F(I-PLAN-4): attribution 的 planId/planDigest 与 accepted artifact 一致", () => {
  const acc = attachPlanIdentity(P1, { planId: "plan-stage2-003-cccccc" });
  const attribution = { planId: acc.plan.planId, planDigest: acc.plan.planDigest, valid: [], invalid: [] };
  const v = verifyArtifactIdentity({ accepted: acc, attribution });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(v.status, "IDENTITY CONSISTENT");
});

// ── G：篡改 attribution digest ⇒ 必须被拒绝 ───────────────────────────────
test("G(I-PLAN-4b): 篡改 _memory-attribution.planDigest ⇒ identity_mismatch（不得静默接受）", () => {
  const acc = attachPlanIdentity(P1, { planId: "plan-stage2-004-dddddd" });
  const tampered = { planId: acc.plan.planId, planDigest: "sha256:deadbeefdeadbeefdeadbeefdeadbeef" };
  const v = verifyArtifactIdentity({ accepted: acc, attribution: tampered });
  assert.equal(v.ok, false, "篡改必须被拒绝");
  assert.equal(v.status, "identity_mismatch");
  assert.ok(v.errors.some((e) => e.where.includes("I-PLAN-4b")));
});

// ── H：篡改 tasks.json.plan.planId ⇒ 必须失败 ─────────────────────────────
test("H(I-PLAN-3): tasks.json.plan.planId 被改成另一个 Plan ⇒ identity_mismatch", () => {
  const acc = attachPlanIdentity(P1, { planId: "plan-stage2-005-eeeeee" });
  const otherPlan = attachPlanIdentity(P1, { planId: "plan-stage2-006-ffffff" });
  const v = verifyArtifactIdentity({ accepted: acc, tasksPlan: otherPlan.plan });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.where.includes("I-PLAN-3")));
});

// ── I：run.planId 必须归属 owning plan ────────────────────────────────────
test("I(I-PLAN-5): run.planId 必须等于 owning planId，否则失败", () => {
  const acc = attachPlanIdentity(P1, { planId: "plan-stage2-007-gggggg" });
  const good = verifyArtifactIdentity({ accepted: acc, runs: [{ runId: "TASK-001-1", planId: acc.plan.planId }] });
  assert.equal(good.ok, true, JSON.stringify(good.errors));
  const bad = verifyArtifactIdentity({ accepted: acc, runs: [{ runId: "TASK-001-2", planId: "plan-stage2-999-zzzzzz" }] });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.where.includes("I-PLAN-5")));
});

// ── I-PLAN-1/2：published vs accepted ────────────────────────────────────
test("I-PLAN-1/2: published 与 accepted 的 planId/planDigest 不一致 ⇒ 失败", () => {
  const dir = mk();
  try {
    const tmp = path.join(dir, "_plan2.json.tmp");
    const fin = path.join(dir, "_plan2.json");
    fs.writeFileSync(tmp, JSON.stringify(P1), "utf-8");
    const pub = publishPlannerArtifact(tmp, fin, { planId: "plan-stage2-008-hhhhhh" });
    const published = JSON.parse(fs.readFileSync(fin, "utf-8"));
    assert.equal(verifyArtifactIdentity({ published, accepted: published }).ok, true);

    const acceptedDifferent = attachPlanIdentity(P2, { planId: pub.planId });   // 内容不同 ⇒ digest 不同
    const v = verifyArtifactIdentity({ published, accepted: acceptedDifferent });
    assert.equal(v.ok, false);
    assert.ok(v.errors.some((e) => e.where.includes("I-PLAN-2")), "digest 不同必须被检出");
  } finally { cleanup(dir); }
});

// ── planIdentityOf：从 artifact 提取身份 ──────────────────────────────────
test("planIdentityOf: 完整提取 planId/parent/root/digest/mode", () => {
  const a = attachPlanIdentity(P1, { planId: "plan-stage2-009-iiiiii", parentPlanId: "plan-stage2-001-aaaaaa", finalizationMode: "stability_fallback" });
  const id = planIdentityOf(a);
  assert.equal(id.planId, "plan-stage2-009-iiiiii");
  assert.equal(id.parentPlanId, "plan-stage2-001-aaaaaa");
  assert.equal(id.rootPlanId, "plan-stage2-009-iiiiii");   // 未指定 root ⇒ 自身
  assert.equal(id.planDigest, a.plan.planDigest);
  assert.equal(id.finalizationMode, "stability_fallback");
  assert.equal(computePlanDigest(a), a.plan.planDigest);
});
