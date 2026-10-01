import fs from "node:fs";
import { createProject, createAcceptance, createTask, createRun, createAttempt, createEvidence, createVerification } from "../../project-control/domain.mjs";
import { ProjectMemoryControl, memorySourceFingerprint } from "../../project-control/project-memory.mjs";

export function seedMemoryFixture(store) {
  store.seedProject(createProject({ id: "p", name: "Memory project" }));
  store.seedProject(createProject({ id: "other", name: "Other project" }));
  store.seedAcceptance(createAcceptance({ id: "a", targetId: "t" }));
  store.seedTask(createTask({ id: "t", projectId: "p", title: "Verified task", acceptanceId: "a", acceptanceVersion: 1, status: "NEEDS_REVIEW" }));
  store.createRun(createRun({ id: "r", taskId: "t" }));
  store.createAttempt(createAttempt({ id: "at", runId: "r", attemptNumber: 1 }));
  store.recordEvidence(createEvidence({ id: "e", taskId: "t", runId: "r", attemptId: "at", acceptanceId: "a", acceptanceVersion: 1, revision: "rev-1", status: "VERIFIED", contentRef: "artifact://test" }));
  store.recordVerification(createVerification({ id: "v", taskId: "t", acceptanceId: "a", acceptanceVersion: 1, evidenceIds: ["e"], verdict: "PASS", revision: "rev-1" }));
  store.acceptTask("t", 1, { verificationId: "v" });
  store.createProjectDecision(decisionInput());
}
export function decisionInput(over = {}) {
  return { id: "d", projectId: "p", title: "Keep bounded Memory", rationale: "Do not implement Capsule.", decidedBy: { type: "HUMAN", actorId: "human" }, sourceRefs: [{ type: "HUMAN_INSTRUCTION", id: "instruction" }], ...over };
}
export function ref(store, type, id, extra = {}) {
  const collection = type === "PROJECT_STATE" ? (extra.targetType ?? "TASK").toLowerCase() : type.toLowerCase();
  const record = store.getRecord(collection, id);
  return { type, id, projectId: "p", scope: "exact bounded source claim", pin: type === "DECISION" || type === "PROJECT_STATE" ? { version: record.version } : { fingerprint: memorySourceFingerprint(record) }, ...extra };
}
export function candidate(store, over = {}) {
  return { projectId: "p", type: "DECISION", confidence: "ACCEPTED", content: "Keep bounded Memory", applicability: "Project p G7.3", assumptions: [], sourceRefs: [ref(store, "DECISION", "d")], ...over };
}
export function fact(store, over = {}) {
  return candidate(store, { type: "FACT", confidence: "VERIFIED", content: "Task t verification passed at rev-1", sourceRefs: [ref(store, "EVIDENCE", "e"), ref(store, "VERIFICATION", "v")], claim: { verdict: "PASS" }, ...over });
}
export function acceptedFact(store, over = {}) {
  return candidate(store, { type: "FACT", content: "Task t passed its own contract a@1", sourceRefs: [ref(store, "PROJECT_STATE", "t", { targetType: "TASK", acceptanceId: "a", acceptanceVersion: 1, verificationId: "v" })], ...over });
}
export function inferred(store, over = {}) {
  return candidate(store, { type: "LESSON", confidence: "INFERRED", content: "Bounded work may reduce review cost", assumptions: ["Only applicable to this project stage"], ...over });
}
export function judgement(input, over = {}) {
  return { faithful: true, reason: "Trusted reviewer checked this exact scoped claim against all necessary sources", necessarySources: input.sourceRefs.map((r) => `${r.type}:${r.targetType ?? ""}:${r.id}`), ...(input.claim?.verdict ? { verdict: input.claim.verdict } : {}), ...over };
}
export function boundary(store, over = {}) {
  return new ProjectMemoryControl({ store, controlActorId: "control", humanActorId: "human", observeReality: (e) => ({ status: "CURRENT", revision: e.revision, ...(e.workspaceId ? { workspaceRevision: e.workspaceRevision } : {}), observationRef: "test:observation", observedAt: new Date().toISOString() }), ...over });
}
export function promote(control, input, id = "m", options = {}) {
  const attestation = control.validate(input, { judgement: judgement(input) });
  const args = { id, candidate: input, attestation, ...options };
  return { record: control.promote(args, { commandId: `promote:${id}` }), args };
}
// Real file observations for restart/integration proof, scoped to this known
// test artifact. This is not a production external-source resolver.
export function fileObserver(file) {
  return () => ({ status: "CURRENT", revision: fs.readFileSync(file, "utf8"), observationRef: file, observedAt: new Date().toISOString() });
}
