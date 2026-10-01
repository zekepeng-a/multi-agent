import fs from "node:fs";
import { createProject, createTask, createAcceptance, createRun, createAttempt, createWorkspace } from "../../project-control/domain.mjs";
import { ContextCapsuleControl } from "../../project-control/context-capsule.mjs";
import { FakeRuntime } from "../../project-control/fake-runtime.mjs";
import { decisionInput } from "./pc-memory-fixture.mjs";

export const fixedTime = "2026-09-30T00:00:00.000Z";
export const binding = { projectId: "p", taskId: "ct", runId: "cr", attemptId: "cat" };
export const generateInput = { id: "capsule-1", ...binding };
export function seedCapsuleFixture(store, rootRef = "fixture://workspace") {
  if (!store.getRecord("project", "p")) store.seedProject(createProject({ id: "p", name: "Capsule project" }));
  if (!store.getRecord("project", "other")) store.seedProject(createProject({ id: "other", name: "Other project" }));
  store.seedAcceptance(createAcceptance({ id: "ca", targetId: "ct", criteria: ["保持完整约束"] }));
  store.seedTask(createTask({ id: "ct", projectId: "p", title: "执行 bounded 工作", acceptanceId: "ca", acceptanceVersion: 1, status: "IN_PROGRESS" }));
  store.createRun(createRun({ id: "cr", taskId: "ct", status: "RUNNING" }));
  store.createAttempt(createAttempt({ id: "cat", runId: "cr", attemptNumber: 1 }));
  store.updateTask("ct", 1, { currentRunId: "cr" });
  store.updateRun("cr", 1, { currentAttemptId: "cat", attemptIds: ["cat"] });
  store.createWorkspace(createWorkspace({ id: "cw", projectId: "p", kind: "SHARED", access: "READ_ONLY", rootRef,
    baseRevision: "reality-1", currentRevision: "reality-1", status: "ACTIVE" }));
  if (!store.getRecord("decision", "d")) store.createProjectDecision(decisionInput({ rationale: "Preserve authority and scope" }));
}

export function capsuleBoundary(store, overrides = {}) {
  const runtime = overrides.runtime ?? new FakeRuntime();
  return { store, runtime, controlActorId: "control", profile: { id: "bounded-v1", version: "1", assemblerVersion: "1", maxBytes: 60000 },
    workspaceId: "cw", clock: () => fixedTime,
    verifyRequiredIntegrity: () => ({ complete: true, consistent: true, observationRef: "fixture:review", reason: "Test fixture restrictions checked at trusted composition" }),
    observeWorkspace: w => ({ status: "CURRENT", revision: w.currentRevision, observationRef: "fixture:workspace", observedAt: fixedTime }),
    policyContext: b => ({ id: "policy", version: "1", status: "CURRENT", binding: b, restrictions: ["No publish"], approvalRequests: [],
      provenance: { configuredBy: "human" }, observationRef: "fixture:policy", observedAt: fixedTime }),
    runtimeContext: b => ({ id: "runtime", version: "1", status: "CURRENT", binding: b, adapterId: runtime.capabilities().adapterId, restrictions: ["No direct state writes"],
      provenance: { configuredBy: "control" }, observationRef: "fixture:runtime", observedAt: fixedTime }), ...overrides };
}
export const capsules = (store, overrides) => new ContextCapsuleControl(capsuleBoundary(store, overrides));
export const generate = control => control.generate(generateInput, { commandId: "generate-1" });
export function reserve(control, overrides = {}) {
  return control.reserve({ capsuleId: "capsule-1", attemptId: "cat", expectedDeliveryVersion: 1, ...overrides }, { commandId: "dispatch-1" });
}
export const dispatch = (control, overrides = {}) => control.dispatch({ capsuleId: "capsule-1", attemptId: "cat", expectedDeliveryVersion: 1, ...overrides }, { commandId: "dispatch-1" });
export const fileWorkspaceObserver = file => w => ({ status: "CURRENT", revision: fs.readFileSync(file, "utf8"), observationRef: file, observedAt: fixedTime });
