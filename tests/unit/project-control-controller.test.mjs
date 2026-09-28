import test from "node:test";
import assert from "node:assert/strict";

import {
  AttemptStatus,
  ConflictError,
  EvidenceStatus,
  ReconcileOutcome,
  RunStatus,
  TaskStatus,
  VerificationVerdict,
  createAcceptance,
  createEvidence,
  createTask,
  createVerification,
} from "../../project-control/domain.mjs";
import { MemoryStore } from "../../project-control/memory-store.mjs";
import { FakeRuntime } from "../../project-control/fake-runtime.mjs";
import { FakeVerifier } from "../../project-control/fake-verifier.mjs";
import { Controller } from "../../project-control/controller.mjs";

function fixture(runtimeMode = "success", verifierVerdict = VerificationVerdict.PASS) {
  const store = new MemoryStore();
  store.seedAcceptance(createAcceptance({
    id: "acceptance-1",
    targetId: "task-1",
    criteria: [{ id: "build", type: "BUILD", required: true }],
  }));
  store.seedTask(createTask({
    id: "task-1",
    title: "minimum controller task",
    acceptanceId: "acceptance-1",
  }));
  const runtime = new FakeRuntime({ mode: runtimeMode, revision: "rev-1" });
  const verifier = new FakeVerifier({ verdict: verifierVerdict });
  let n = 0;
  const controller = new Controller({
    store,
    runtime,
    verifier,
    idFactory: (prefix) => `${prefix}-${++n}`,
  });
  return { store, runtime, verifier, controller };
}

test("happy path: controller drives READY task to ACCEPTED through evidence and verification", async () => {
  const { store, controller } = fixture();

  const result = await controller.reconcileTask("task-1");

  assert.equal(result.action, "ACCEPT");
  assert.equal(result.task.status, TaskStatus.ACCEPTED);
  assert.equal(result.evidence.status, EvidenceStatus.CANDIDATE);
  assert.equal(result.verification.verdict, VerificationVerdict.PASS);
  assert.equal(store.getRun("run-1").status, "COMPLETED");
  assert.equal(store.getAttempt("attempt-2").status, "COMPLETED");

  const events = store.getEvents().map((event) => event.type);
  assert.ok(events.includes("run.created"));
  assert.ok(events.includes("attempt.created"));
  assert.ok(events.includes("evidence.recorded"));
  assert.ok(events.includes("verification.recorded"));
  assert.ok(events.includes("task.accepted"));
});

test("lost attempt does not erase the Run and requires reconciliation", async () => {
  const { store, controller } = fixture("lost");

  const result = await controller.reconcileTask("task-1");

  assert.equal(result.action, "RECONCILE");
  assert.equal(result.task.status, TaskStatus.IN_PROGRESS);
  assert.equal(result.run.status, "BLOCKED");
  assert.equal(result.attempt.status, "LOST");
  assert.equal(store.getRunsForTask("task-1").length, 1);
});

test("candidate evidence alone cannot accept a task", () => {
  const { store } = fixture();
  const evidence = createEvidence({
    id: "e-1",
    taskId: "task-1",
    runId: "run-x",
    attemptId: "attempt-x",
    acceptanceId: "acceptance-1",
    acceptanceVersion: 1,
    revision: "rev-1",
    status: EvidenceStatus.CANDIDATE,
    contentRef: "artifact://candidate",
  });
  store.recordEvidence(evidence);

  assert.throws(
    () => store.acceptTask("task-1", 1, { verificationId: "missing" }),
    /verification not found/,
  );
});

test("verification must match the acceptance contract revision", () => {
  const { store } = fixture();
  assert.throws(() => store.recordVerification(createVerification({
    id: "v-1",
    acceptanceId: "acceptance-1",
    acceptanceVersion: 2,
    evidenceIds: ["missing"],
    verdict: VerificationVerdict.PASS,
  })), /different acceptance contract version/);
});

test("failed verification prevents acceptance", async () => {
  const { store, controller } = fixture("success", VerificationVerdict.FAIL);

  const result = await controller.reconcileTask("task-1");

  assert.equal(result.action, "REVIEW");
  assert.equal(result.task.status, TaskStatus.NEEDS_REVIEW);
  assert.equal(result.verification.verdict, VerificationVerdict.FAIL);
});

test("stale optimistic writer gets a conflict", () => {
  const { store } = fixture();
  store.updateTask("task-1", 1, { status: TaskStatus.IN_PROGRESS }, { commandId: "cmd-1" });

  assert.throws(
    () => store.updateTask("task-1", 1, { status: TaskStatus.READY }, { commandId: "cmd-2" }),
    (error) => error instanceof ConflictError && error.code === "CONFLICT",
  );
});

test("duplicate command is idempotent for a task mutation", () => {
  const { store } = fixture();
  const first = store.updateTask(
    "task-1",
    1,
    { status: TaskStatus.IN_PROGRESS },
    { commandId: "cmd-1" },
  );
  const second = store.updateTask(
    "task-1",
    1,
    { status: TaskStatus.IN_PROGRESS },
    { commandId: "cmd-1" },
  );

  assert.equal(first.version, 2);
  assert.equal(second.version, 2);
  assert.equal(store.getTask("task-1").version, 2);
});

test("accepted task is a project-state decision, not a runtime claim", async () => {
  const { store, controller } = fixture();
  await controller.reconcileTask("task-1");

  const taskEvents = store.getEvents().filter((event) => event.aggregateId === "task-1");
  assert.equal(taskEvents.at(-1).type, "task.accepted");
  assert.equal(store.getTask("task-1").status, TaskStatus.ACCEPTED);
});

// ── Reconciliation（I-11：blocked 必须可恢复，而不是停在返回 RECONCILE） ──────────
// 恢复 ≠ 重试：只有 runtime 的核对结论允许状态前进；unknown 不得触发任何副作用。

test("reconciliation: unknown keeps the Run BLOCKED, is repeatable, and re-executes nothing", async () => {
  const { store, runtime, controller } = fixture("lost");
  runtime.reconcileOutcome = ReconcileOutcome.UNKNOWN;

  const first = await controller.reconcileTask("task-1");
  assert.equal(first.action, "RECONCILE");

  const second = await controller.reconcileTask("task-1");
  assert.equal(second.action, "RECONCILE");
  assert.equal(second.reason, "reconciliation-unknown");
  assert.equal(second.reconciliation.outcome, ReconcileOutcome.UNKNOWN);
  assert.equal(second.task.status, TaskStatus.IN_PROGRESS);
  assert.equal(second.run.status, RunStatus.BLOCKED);
  assert.equal(second.attempt.status, AttemptStatus.LOST);

  const third = await controller.reconcileTask("task-1");
  assert.equal(third.action, "RECONCILE");

  assert.equal(store.getRunsForTask("task-1").length, 1, "unknown must not open a recovery Run");
  assert.equal(runtime.started.length, 1, "unknown must never re-execute external work");
  assert.equal(runtime.reconciled.length, 2, "each later call observes before deciding");
});

test("reconciliation: confirmed_no_effect allows recovery execution on a new Run", async () => {
  const { store, runtime, controller } = fixture(["lost", "success"]);
  runtime.reconcileOutcome = ReconcileOutcome.CONFIRMED_NO_EFFECT;

  const first = await controller.reconcileTask("task-1");
  assert.equal(first.action, "RECONCILE");
  const blockedRunId = first.run.id;
  const lostAttemptId = first.attempt.id;

  const second = await controller.reconcileTask("task-1");
  assert.equal(second.action, "ACCEPT");
  assert.equal(second.reconciliation.outcome, ReconcileOutcome.CONFIRMED_NO_EFFECT);
  assert.equal(second.recoveredFrom.runId, blockedRunId);
  assert.equal(second.task.status, TaskStatus.ACCEPTED);
  assert.notEqual(second.run.id, blockedRunId, "recovery executes on a new Run");
  assert.equal(second.run.status, RunStatus.COMPLETED);
  assert.equal(second.evidence.runId, second.run.id);

  assert.equal(runtime.reconciled.length, 1, "recovery is legitimized by one observation");
  assert.equal(runtime.started.length, 2, "the recovery Run executed only after the observation");

  assert.equal(store.getRunsForTask("task-1").length, 2);
  assert.equal(store.getRun(blockedRunId).status, RunStatus.BLOCKED);
  assert.equal(store.getAttempt(lostAttemptId).status, AttemptStatus.LOST);
  assert.deepEqual(store.getRun(blockedRunId).attemptIds, [lostAttemptId]);
});

test("reconciliation: confirmed_completed turns the existing result into Evidence without re-executing", async () => {
  const { store, runtime, controller } = fixture("lost");
  runtime.reconcileOutcome = ReconcileOutcome.CONFIRMED_COMPLETED;
  runtime.recoveredResultRef = "artifact://fake/recovered-result";

  const first = await controller.reconcileTask("task-1");
  assert.equal(first.action, "RECONCILE");
  const blockedRunId = first.run.id;
  const lostAttemptId = first.attempt.id;

  const second = await controller.reconcileTask("task-1");
  assert.equal(second.action, "ACCEPT");
  assert.equal(second.reconciliation.outcome, ReconcileOutcome.CONFIRMED_COMPLETED);

  assert.equal(runtime.started.length, 1, "confirmed_completed must not re-execute external work");
  assert.equal(store.getRunsForTask("task-1").length, 1, "confirmed_completed needs no new Run");

  assert.equal(second.evidence.status, EvidenceStatus.CANDIDATE);
  assert.equal(second.evidence.contentRef, "artifact://fake/recovered-result");
  assert.equal(second.evidence.runId, blockedRunId, "Evidence keeps the lineage that produced it");
  assert.equal(second.evidence.attemptId, lostAttemptId);
  assert.equal(second.verification.verdict, VerificationVerdict.PASS);
  assert.equal(second.task.status, TaskStatus.ACCEPTED);

  assert.equal(store.getRun(blockedRunId).status, RunStatus.BLOCKED);
  assert.equal(store.getAttempt(lostAttemptId).status, AttemptStatus.LOST);

  const types = store.getEvents().map((event) => event.type);
  assert.ok(types.indexOf("evidence.recorded") < types.indexOf("verification.recorded"));
  assert.ok(types.indexOf("verification.recorded") < types.indexOf("task.accepted"));
});

test("reconciliation: a recovered result that fails verification is never accepted", async () => {
  const { store, runtime, controller } = fixture("lost", VerificationVerdict.FAIL);
  runtime.reconcileOutcome = ReconcileOutcome.CONFIRMED_COMPLETED;

  await controller.reconcileTask("task-1");
  const second = await controller.reconcileTask("task-1");

  assert.equal(second.action, "REVIEW");
  assert.equal(second.task.status, TaskStatus.NEEDS_REVIEW);
  assert.equal(second.verification.verdict, VerificationVerdict.FAIL);
  assert.ok(!store.getEvents().some((event) => event.type === "task.accepted"));
});
