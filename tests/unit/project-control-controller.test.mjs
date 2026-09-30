import test from "node:test";
import assert from "node:assert/strict";

import {
  ApprovalDecision,
  ApprovalTargetType,
  AttemptStatus,
  CommandStatus,
  CommandTargetType,
  ConflictError,
  EvidenceStatus,
  InvariantError,
  ReconcileOutcome,
  RiskLevel,
  RunStatus,
  TaskStatus,
  VerificationVerdict,
  createAcceptance,
  createAttempt,
  createEvidence,
  createRun,
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
    acceptanceVersion: 1,
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
    taskId: "task-1",
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

// ── Evidence lineage contract ────────────────────────────────────────────────
// Task ← Run ← Attempt ← Evidence must be one continuous, provable lineage, and a
// PASS may only rest on candidate/verified evidence bound to one revision.

function seedRunChain(store, { taskId, runId, attemptId, attemptNumber = 1 }) {
  store.createRun(createRun({ id: runId, taskId, status: RunStatus.READY }));
  store.createAttempt(createAttempt({ id: attemptId, runId, attemptNumber }));
}

function evidenceFor(over = {}) {
  return createEvidence({
    id: "ev-1",
    taskId: "task-1",
    runId: "t1-run",
    attemptId: "t1-attempt",
    acceptanceId: "acceptance-1",
    acceptanceVersion: 1,
    revision: "rev-1",
    status: EvidenceStatus.CANDIDATE,
    contentRef: "artifact://lineage",
    ...over,
  });
}

function verificationFor(evidenceIds, over = {}) {
  return createVerification({
    id: "v-1",
    taskId: "task-1",
    acceptanceId: "acceptance-1",
    acceptanceVersion: 1,
    evidenceIds,
    verdict: VerificationVerdict.PASS,
    revision: "rev-1",
    ...over,
  });
}

test("lineage: verification cannot reference evidence of another task", () => {
  const { store } = fixture();
  store.seedTask(createTask({ id: "task-2", title: "other task", acceptanceId: "acceptance-1", acceptanceVersion: 1 }));
  seedRunChain(store, { taskId: "task-2", runId: "t2-run", attemptId: "t2-attempt" });
  store.recordEvidence(evidenceFor({ id: "ev-2", taskId: "task-2", runId: "t2-run", attemptId: "t2-attempt" }));

  assert.throws(
    () => store.recordVerification(verificationFor(["ev-2"], { id: "v-2" })),
    (error) => error instanceof InvariantError && /does not belong to task/.test(error.message),
  );
});

test("lineage: verification cannot reference evidence of another run", () => {
  const { store } = fixture();
  seedRunChain(store, { taskId: "task-1", runId: "t1-run", attemptId: "t1-attempt" });
  store.seedTask(createTask({ id: "task-2", title: "other task", acceptanceId: "acceptance-1", acceptanceVersion: 1 }));
  seedRunChain(store, { taskId: "task-2", runId: "t2-run", attemptId: "t2-attempt" });
  // claims task-1, but points at the Run of another task
  store.recordEvidence(evidenceFor({ id: "ev-run", runId: "t2-run", attemptId: "t2-attempt" }));

  assert.throws(
    () => store.recordVerification(verificationFor(["ev-run"], { id: "v-run" })),
    (error) => error instanceof InvariantError && /references run t2-run/.test(error.message),
  );
});

test("lineage: verification cannot reference evidence of another attempt", () => {
  const { store } = fixture();
  seedRunChain(store, { taskId: "task-1", runId: "t1-run", attemptId: "t1-attempt" });
  store.seedTask(createTask({ id: "task-2", title: "other task", acceptanceId: "acceptance-1", acceptanceVersion: 1 }));
  seedRunChain(store, { taskId: "task-2", runId: "t2-run", attemptId: "t2-attempt" });
  // Task and Run are task-1's, but the Attempt belongs to another Run
  store.recordEvidence(evidenceFor({ id: "ev-attempt", runId: "t1-run", attemptId: "t2-attempt" }));

  assert.throws(
    () => store.recordVerification(verificationFor(["ev-attempt"], { id: "v-attempt" })),
    (error) => error instanceof InvariantError && /references attempt t2-attempt/.test(error.message),
  );
});

test("lineage: a shared acceptance contract does not excuse a foreign task lineage", () => {
  const { store } = fixture();
  store.seedTask(createTask({ id: "task-2", title: "other task", acceptanceId: "acceptance-1", acceptanceVersion: 1 }));
  seedRunChain(store, { taskId: "task-2", runId: "t2-run", attemptId: "t2-attempt" });
  const evidence = evidenceFor({ id: "ev-3", taskId: "task-2", runId: "t2-run", attemptId: "t2-attempt" });
  store.recordEvidence(evidence);
  const verification = verificationFor(["ev-3"], { id: "v-3" });

  // both sides carry the same acceptance contract, so that check alone passes
  assert.equal(evidence.acceptanceId, verification.acceptanceId);
  assert.equal(evidence.acceptanceVersion, verification.acceptanceVersion);
  assert.throws(() => store.recordVerification(verification), InvariantError);
});

test("lineage: STALE or SUPERSEDED evidence cannot support a PASS verification", () => {
  const { store } = fixture();
  seedRunChain(store, { taskId: "task-1", runId: "t1-run", attemptId: "t1-attempt" });

  for (const status of [EvidenceStatus.STALE, EvidenceStatus.SUPERSEDED]) {
    const evidenceId = `ev-${status.toLowerCase()}`;
    store.recordEvidence(evidenceFor({ id: evidenceId, status }));

    assert.throws(
      () => store.recordVerification(verificationFor([evidenceId], { id: `v-${status.toLowerCase()}` })),
      (error) => error instanceof InvariantError && /cannot support a PASS verification/.test(error.message),
      `${status} must not support a PASS verification`,
    );

    // the rule is scoped to PASS: a failure verdict grants nothing and is still recorded
    const failing = store.recordVerification(verificationFor([evidenceId], {
      id: `v-fail-${status.toLowerCase()}`,
      verdict: VerificationVerdict.FAIL,
    }));
    assert.equal(failing.verdict, VerificationVerdict.FAIL);
  }
});

test("lineage: verification revision must match the evidence revision", () => {
  const { store } = fixture();
  seedRunChain(store, { taskId: "task-1", runId: "t1-run", attemptId: "t1-attempt" });
  store.recordEvidence(evidenceFor({ id: "ev-rev", revision: "rev-1" }));

  assert.throws(
    () => store.recordVerification(verificationFor(["ev-rev"], { id: "v-rev-bad", revision: "rev-2" })),
    (error) => error instanceof InvariantError && /revision/.test(error.message),
  );
  assert.equal(
    store.recordVerification(verificationFor(["ev-rev"], { id: "v-rev-ok", revision: "rev-1" })).revision,
    "rev-1",
  );
});

test("lineage: a missing revision is never acceptable", () => {
  const { store } = fixture();
  seedRunChain(store, { taskId: "task-1", runId: "t1-run", attemptId: "t1-attempt" });
  store.recordEvidence(evidenceFor({ id: "ev-nullrev", revision: null }));

  assert.throws(
    () => store.recordVerification(verificationFor(["ev-nullrev"], { id: "v-null-null", revision: null })),
    (error) => error instanceof InvariantError && /revision/.test(error.message),
  );
  assert.throws(
    () => store.recordVerification(verificationFor(["ev-nullrev"], { id: "v-null-rev", revision: "rev-1" })),
    (error) => error instanceof InvariantError && /revision/.test(error.message),
  );
});

test("lineage: one verification may not mix evidence from two lineages", () => {
  const { store } = fixture();
  seedRunChain(store, { taskId: "task-1", runId: "t1-run", attemptId: "t1-attempt" });
  seedRunChain(store, { taskId: "task-1", runId: "t1-run-2", attemptId: "t1-attempt-2", attemptNumber: 2 });
  store.recordEvidence(evidenceFor({ id: "ev-a", runId: "t1-run", attemptId: "t1-attempt" }));
  store.recordEvidence(evidenceFor({ id: "ev-b", runId: "t1-run-2", attemptId: "t1-attempt-2" }));

  assert.throws(
    () => store.recordVerification(verificationFor(["ev-a", "ev-b"], { id: "v-mixed" })),
    (error) => error instanceof InvariantError && /mixes evidence/.test(error.message),
  );
});

test("lineage: evidence produced by reconciliation gets no lineage exemption", async () => {
  const { store, runtime, controller } = fixture("lost");
  runtime.reconcileOutcome = ReconcileOutcome.CONFIRMED_COMPLETED;

  await controller.reconcileTask("task-1");
  const result = await controller.reconcileTask("task-1");
  const recovered = result.evidence;
  assert.equal(result.action, "ACCEPT");
  assert.equal(recovered.taskId, "task-1");

  // it passed the very same contract as live evidence...
  assert.equal(result.verification.taskId, "task-1");
  assert.equal(result.verification.revision, recovered.revision);

  // ...and gets no exemption afterwards either
  store.seedTask(createTask({ id: "task-2", title: "other task", acceptanceId: "acceptance-1", acceptanceVersion: 1 }));
  assert.throws(
    () => store.recordVerification(verificationFor([recovered.id], { id: "v-j-task", taskId: "task-2" })),
    InvariantError,
  );
  assert.throws(
    () => store.recordVerification(verificationFor([recovered.id], { id: "v-j-rev", revision: "rev-other" })),
    InvariantError,
  );
});

test("lineage: a PASS verification recorded for another task cannot accept this task", () => {
  const { store } = fixture();
  store.seedTask(createTask({ id: "task-2", title: "other task", acceptanceId: "acceptance-1", acceptanceVersion: 1 }));
  seedRunChain(store, { taskId: "task-2", runId: "t2-run", attemptId: "t2-attempt" });
  store.recordEvidence(evidenceFor({ id: "ev-4", taskId: "task-2", runId: "t2-run", attemptId: "t2-attempt" }));
  const verification = store.recordVerification(verificationFor(["ev-4"], { id: "v-task2", taskId: "task-2" }));
  assert.equal(verification.verdict, VerificationVerdict.PASS);

  assert.throws(
    () => store.acceptTask("task-1", 1, { verificationId: "v-task2" }),
    (error) => error instanceof InvariantError && /does not belong to task task-1/.test(error.message),
  );
  assert.notEqual(store.getTask("task-1").status, TaskStatus.ACCEPTED);
});

test("lineage: acceptTask re-proves the chain for a forged PASS verification", () => {
  const { store } = fixture();
  store.seedTask(createTask({ id: "task-2", title: "other task", acceptanceId: "acceptance-1", acceptanceVersion: 1 }));
  seedRunChain(store, { taskId: "task-2", runId: "t2-run", attemptId: "t2-attempt" });
  store.recordEvidence(evidenceFor({ id: "ev-5", taskId: "task-2", runId: "t2-run", attemptId: "t2-attempt" }));

  // forged straight into the aggregate map: never passed recordVerification
  store.verifications.set("v-forged", {
    id: "v-forged",
    taskId: "task-1",
    acceptanceId: "acceptance-1",
    acceptanceVersion: 1,
    evidenceIds: ["ev-5"],
    verdict: VerificationVerdict.PASS,
    revision: "rev-1",
    createdAt: new Date().toISOString(),
  });

  assert.throws(
    () => store.acceptTask("task-1", 1, { verificationId: "v-forged" }),
    (error) => error instanceof InvariantError && /does not belong to task task-1/.test(error.message),
  );
  assert.notEqual(store.getTask("task-1").status, TaskStatus.ACCEPTED);
});

test("lineage: acceptTask rejects a PASS verification whose evidence has gone STALE", () => {
  const { store } = fixture();
  seedRunChain(store, { taskId: "task-1", runId: "t1-run", attemptId: "t1-attempt" });
  store.recordEvidence(evidenceFor({ id: "ev-live", status: EvidenceStatus.CANDIDATE }));
  store.recordVerification(verificationFor(["ev-live"], { id: "v-live" })); // legal when recorded

  // v0.1 has no evidence-lifecycle API yet, so a later supersede is simulated by
  // writing the aggregate directly — the state a persisted store could reload in.
  store.evidence.set("ev-live", { ...store.getEvidence("ev-live"), status: EvidenceStatus.STALE });

  assert.throws(
    () => store.acceptTask("task-1", 1, { verificationId: "v-live" }),
    (error) => error instanceof InvariantError && /cannot support a PASS verification/.test(error.message),
  );
  assert.notEqual(store.getTask("task-1").status, TaskStatus.ACCEPTED);
});

// ── Acceptance contract revision pinning ─────────────────────────────────────
// A task is pinned to the contract revision it was created with. Changing
// contract content creates a NEW revision and never moves an existing task.

test("contract pinning: a task executes and accepts on the revision it pinned", async () => {
  const { store, controller } = fixture();
  assert.equal(store.getTask("task-1").acceptanceVersion, 1);

  const result = await controller.reconcileTask("task-1");

  assert.equal(result.action, "ACCEPT");
  assert.equal(result.task.status, TaskStatus.ACCEPTED);
  assert.equal(result.evidence.acceptanceVersion, 1);
  assert.equal(result.verification.acceptanceVersion, 1);
  assert.equal(store.getAcceptance("acceptance-1", 1).status, "PASSED");
});

test("contract pinning: revising the contract does not move an existing task", async () => {
  const { store, controller } = fixture();
  const revised = store.reviseAcceptance("acceptance-1", {
    criteria: [{ id: "build", type: "BUILD", required: true }, { id: "lint", type: "LINT", required: true }],
  });

  assert.equal(revised.version, 2);
  assert.equal(revised.status, "PENDING");
  assert.equal(store.getTask("task-1").acceptanceVersion, 1, "the task stays pinned to v1");

  const result = await controller.reconcileTask("task-1");

  assert.equal(result.action, "ACCEPT");
  assert.equal(result.evidence.acceptanceVersion, 1, "evidence binds the pinned revision, not the newest one");
  assert.equal(result.verification.acceptanceVersion, 1);
  assert.equal(store.getAcceptance("acceptance-1", 1).status, "PASSED");
  assert.equal(store.getAcceptance("acceptance-1", 2).status, "PENDING", "the newer revision is untouched");
});

test("contract pinning: evidence bound to a newer revision cannot be verified by a v1 task", () => {
  const { store } = fixture();
  store.reviseAcceptance("acceptance-1", { criteria: [{ id: "late", type: "BUILD", required: true }] });
  seedRunChain(store, { taskId: "task-1", runId: "t1-run", attemptId: "t1-attempt" });
  store.recordEvidence(evidenceFor({ id: "ev-v2", acceptanceVersion: 2 }));

  assert.throws(
    () => store.recordVerification(verificationFor(["ev-v2"], { id: "v-v2", acceptanceVersion: 2 })),
    (error) => error instanceof InvariantError && /pinned/.test(error.message),
  );
});

test("contract pinning: a verification for a newer revision cannot accept a v1 task", () => {
  const { store } = fixture();
  store.reviseAcceptance("acceptance-1", { criteria: [{ id: "late", type: "BUILD", required: true }] });
  // a second task, pinned to the new revision and legitimately verified on it
  store.seedTask(createTask({ id: "task-2", title: "v2 task", acceptanceId: "acceptance-1", acceptanceVersion: 2 }));
  seedRunChain(store, { taskId: "task-2", runId: "t2-run", attemptId: "t2-attempt" });
  store.recordEvidence(evidenceFor({
    id: "ev-t2", taskId: "task-2", runId: "t2-run", attemptId: "t2-attempt", acceptanceVersion: 2,
  }));
  const verification = store.recordVerification(verificationFor(["ev-t2"], {
    id: "v-t2", taskId: "task-2", acceptanceVersion: 2,
  }));
  assert.equal(verification.verdict, VerificationVerdict.PASS);

  assert.throws(
    () => store.acceptTask("task-1", 1, { verificationId: "v-t2" }),
    (error) => error instanceof InvariantError && /cannot be accepted by this verification/.test(error.message),
  );
  assert.notEqual(store.getTask("task-1").status, TaskStatus.ACCEPTED);
});

test("contract pinning: v1 evidence cannot be carried by a v2 verification", () => {
  const { store } = fixture();
  store.reviseAcceptance("acceptance-1", { criteria: [{ id: "late", type: "BUILD", required: true }] });
  seedRunChain(store, { taskId: "task-1", runId: "t1-run", attemptId: "t1-attempt" });
  store.recordEvidence(evidenceFor({ id: "ev-v1", acceptanceVersion: 1 }));

  assert.throws(
    () => store.recordVerification(verificationFor(["ev-v1"], { id: "v-mix", acceptanceVersion: 2 })),
    InvariantError,
  );
});

test("contract pinning: contract content changed in place fails closed", async () => {
  const { store, controller } = fixture();

  // exactly the "content differs, identity confused" case: same id and version,
  // different criteria — the revision guard must refuse to resolve it
  for (const [key, acceptance] of store.acceptances) {
    if (acceptance.id === "acceptance-1" && acceptance.version === 1) {
      store.acceptances.set(key, { ...acceptance, criteria: [{ id: "swapped", type: "BUILD", required: false }] });
    }
  }

  assert.throws(
    () => store.getAcceptance("acceptance-1", 1),
    (error) => error instanceof InvariantError && /without a new revision/.test(error.message),
  );
  await assert.rejects(
    () => controller.reconcileTask("task-1"),
    (error) => error instanceof InvariantError && /without a new revision/.test(error.message),
  );

  // the supported way to change content is a new revision, which stays isolated
  const rewritten = [{ id: "rewritten", type: "LINT", required: true }];
  assert.equal(store.reviseAcceptance("acceptance-1", { criteria: rewritten }).version, 2);
  assert.deepEqual(store.getAcceptance("acceptance-1", 2).criteria, rewritten);
});

test("contract pinning: an acceptance decision is not a contract revision change", async () => {
  const { store, controller } = fixture();
  const before = store.getAcceptance("acceptance-1", 1);

  await controller.reconcileTask("task-1");

  const after = store.getAcceptance("acceptance-1", 1);
  assert.equal(after.status, "PASSED");
  assert.equal(after.version, 1, "accepting must not invent a new revision");
  assert.deepEqual(after.criteria, before.criteria, "the decision leaves the contract content untouched");
  assert.equal(store.getTask("task-1").acceptanceVersion, 1);
  assert.throws(() => store.getAcceptance("acceptance-1", 2), InvariantError, "no v2 revision was created");
});

test("contract pinning: acceptTask rejects a forged PASS verification pinned to another revision", () => {
  const { store } = fixture();
  const revised = store.reviseAcceptance("acceptance-1", { criteria: [{ id: "late", type: "BUILD", required: true }] });
  seedRunChain(store, { taskId: "task-1", runId: "t1-run", attemptId: "t1-attempt" });
  store.recordEvidence(evidenceFor({ id: "ev-forged" }));

  // forged straight into the aggregate map: claims this task and a *real*
  // revision (v2), so only the task's own pin can reject it
  store.verifications.set("v-forged-pin", {
    id: "v-forged-pin",
    taskId: "task-1",
    acceptanceId: "acceptance-1",
    acceptanceVersion: revised.version,
    evidenceIds: ["ev-forged"],
    verdict: VerificationVerdict.PASS,
    revision: "rev-1",
    createdAt: new Date().toISOString(),
  });

  assert.throws(
    () => store.acceptTask("task-1", 1, { verificationId: "v-forged-pin" }),
    (error) => error instanceof InvariantError && /cannot be accepted by this verification/.test(error.message),
  );
  assert.notEqual(store.getTask("task-1").status, TaskStatus.ACCEPTED);
});

test("contract pinning: reconciled evidence stays on the pinned revision", async () => {
  const { store, runtime, controller } = fixture("lost");
  runtime.reconcileOutcome = ReconcileOutcome.CONFIRMED_COMPLETED;

  await controller.reconcileTask("task-1");
  // the contract is revised *between* the loss and the reconciliation
  store.reviseAcceptance("acceptance-1", { criteria: [{ id: "late", type: "BUILD", required: true }] });

  const second = await controller.reconcileTask("task-1");

  assert.equal(second.action, "ACCEPT");
  assert.equal(second.evidence.acceptanceVersion, 1, "recovery must not follow the newer contract");
  assert.equal(second.verification.acceptanceVersion, 1);
  assert.equal(store.getAcceptance("acceptance-1", 1).status, "PASSED");
  assert.equal(store.getAcceptance("acceptance-1", 2).status, "PENDING");
});

// ── NEEDS_REVIEW recovery: re-verify the recorded evidence, never re-execute ──
// A task that failed verification is not a dead end: the next reconcile re-runs
// verification over the SAME Evidence, Run and Attempt. Nothing executes again,
// and the task can only leave NEEDS_REVIEW through the shared acceptance rule.

function eventCount(store, type) {
  return store.getEvents().filter((event) => event.type === type).length;
}

test("NEEDS_REVIEW recovery: a passing re-verification accepts on the recorded evidence", async () => {
  const { store, runtime, verifier, controller } = fixture("success", VerificationVerdict.FAIL);

  const first = await controller.reconcileTask("task-1");
  assert.equal(first.action, "REVIEW");
  assert.equal(first.task.status, TaskStatus.NEEDS_REVIEW);
  assert.equal(first.task.latestEvidenceId, first.evidence.id);
  const runsAfterFirst = store.getRunsForTask("task-1").length;
  const attemptsAfterFirst = first.run.attemptIds.length;
  const evidenceEventsAfterFirst = eventCount(store, "evidence.recorded");

  // the SAME evidence now verifies as PASS
  verifier.verdict = VerificationVerdict.PASS;
  const second = await controller.reconcileTask("task-1");

  assert.equal(second.action, "ACCEPT");
  assert.equal(second.task.status, TaskStatus.ACCEPTED);
  assert.equal(store.getAcceptance("acceptance-1", 1).status, "PASSED");

  // a NEW verification identity, and the failed one is preserved
  assert.notEqual(second.verification.id, first.verification.id);
  assert.equal(second.verification.evidenceIds[0], first.evidence.id);
  assert.equal(store.getVerification(first.verification.id).verdict, VerificationVerdict.FAIL);
  assert.equal(eventCount(store, "verification.recorded"), 2);
  assert.equal(eventCount(store, "task.accepted"), 1);

  // nothing was executed again
  assert.equal(runtime.started.length, 1, "the recovery path must not start the runtime");
  assert.equal(store.getRunsForTask("task-1").length, runsAfterFirst, "no new Run");
  assert.equal(store.getRun(first.run.id).attemptIds.length, attemptsAfterFirst, "no new Attempt");
  assert.equal(eventCount(store, "evidence.recorded"), evidenceEventsAfterFirst, "no new Evidence");
  assert.equal(store.getTask("task-1").latestEvidenceId, first.evidence.id);
});

test("NEEDS_REVIEW recovery: a failing re-verification records a fact without churning the task", async () => {
  const { store, runtime, controller } = fixture("success", VerificationVerdict.FAIL);

  const first = await controller.reconcileTask("task-1");
  const versionAfterFirst = store.getTask("task-1").version;
  const taskUpdatesAfterFirst = eventCount(store, "task.updated");
  const runsAfterFirst = store.getRunsForTask("task-1").length;
  const attemptsAfterFirst = first.run.attemptIds.length;
  const evidenceEventsAfterFirst = eventCount(store, "evidence.recorded");

  // re-verify twice, both times still FAIL
  const second = await controller.reconcileTask("task-1");
  const third = await controller.reconcileTask("task-1");

  assert.equal(second.action, "REVIEW");
  assert.equal(second.task.status, TaskStatus.NEEDS_REVIEW);
  assert.equal(third.action, "REVIEW");
  assert.equal(third.task.status, TaskStatus.NEEDS_REVIEW);
  assert.equal(store.getAcceptance("acceptance-1", 1).status, "PENDING");
  assert.equal(eventCount(store, "task.accepted"), 0);

  // the new verifications are recorded facts; the old one survives, and every id differs
  assert.equal(eventCount(store, "verification.recorded"), 3);
  assert.equal(store.getVerification(first.verification.id).verdict, VerificationVerdict.FAIL);
  assert.equal(new Set([first.verification.id, second.verification.id, third.verification.id]).size, 3);

  // "still NEEDS_REVIEW" is not a state change: no version drift, no extra event
  assert.equal(store.getTask("task-1").version, versionAfterFirst, "version must not grow for an unchanged state");
  assert.equal(eventCount(store, "task.updated"), taskUpdatesAfterFirst, "no redundant task.updated");
  assert.equal(runtime.started.length, 1);
  assert.equal(store.getRunsForTask("task-1").length, runsAfterFirst);
  assert.equal(store.getRun(first.run.id).attemptIds.length, attemptsAfterFirst);
  assert.equal(eventCount(store, "evidence.recorded"), evidenceEventsAfterFirst);
});

test("NEEDS_REVIEW recovery: fails closed without a recorded evidence id", async () => {
  const { store, runtime, controller } = fixture();
  store.updateTask("task-1", 1, { status: TaskStatus.NEEDS_REVIEW }, { commandId: "cmd-review" });

  const result = await controller.reconcileTask("task-1");

  assert.equal(result.action, "WAIT");
  assert.equal(result.reason, "needs-review-without-evidence");
  assert.notEqual(store.getTask("task-1").status, TaskStatus.ACCEPTED);
  assert.equal(runtime.started.length, 0, "nothing may execute");
  assert.equal(store.getRunsForTask("task-1").length, 0, "no Run may be created");
  assert.equal(eventCount(store, "task.accepted"), 0);
  assert.equal(eventCount(store, "verification.recorded"), 0);
});

test("NEEDS_REVIEW recovery: fails closed when the recorded evidence is gone", async () => {
  const { store, runtime, controller } = fixture();
  store.updateTask(
    "task-1",
    1,
    { status: TaskStatus.NEEDS_REVIEW, latestEvidenceId: "ev-missing" },
    { commandId: "cmd-review" },
  );

  const result = await controller.reconcileTask("task-1");

  assert.equal(result.action, "WAIT");
  assert.equal(result.reason, "needs-review-evidence-missing");
  assert.equal(runtime.started.length, 0, "nothing may execute");
  assert.equal(store.getRunsForTask("task-1").length, 0, "no Run may be created");
  assert.notEqual(store.getTask("task-1").status, TaskStatus.ACCEPTED);
  assert.equal(eventCount(store, "task.accepted"), 0);
});

test("NEEDS_REVIEW recovery: fails closed when the evidence lineage is broken", async () => {
  const { store, controller } = fixture("success", VerificationVerdict.FAIL);
  const first = await controller.reconcileTask("task-1");

  // the evidence points at a Run that no longer exists
  store.putRecord("evidence", first.evidence.id, { ...store.getEvidence(first.evidence.id), runId: "run-gone" });

  const result = await controller.reconcileTask("task-1");

  assert.equal(result.action, "WAIT");
  assert.equal(result.reason, "needs-review-evidence-lineage-broken");
  assert.equal(store.getTask("task-1").status, TaskStatus.NEEDS_REVIEW);
  assert.equal(eventCount(store, "task.accepted"), 0);
});

test("NEEDS_REVIEW recovery: cannot bypass the stale-evidence guard (I-10)", async () => {
  const { store, verifier, controller } = fixture("success", VerificationVerdict.FAIL);

  const first = await controller.reconcileTask("task-1");
  // the recorded evidence is superseded underneath the pending review
  store.putRecord("evidence", first.evidence.id, {
    ...store.getEvidence(first.evidence.id),
    status: EvidenceStatus.STALE,
  });
  verifier.verdict = VerificationVerdict.PASS;

  await assert.rejects(
    () => controller.reconcileTask("task-1"),
    (error) => error instanceof InvariantError && /cannot support a PASS verification/.test(error.message),
  );

  assert.equal(store.getTask("task-1").status, TaskStatus.NEEDS_REVIEW, "no fake success");
  assert.equal(store.getAcceptance("acceptance-1", 1).status, "PENDING");
  assert.equal(eventCount(store, "task.accepted"), 0);
});

// ── durable Command authorization (G2) ───────────────────────────────────────

function commandFixture({ bindApprovalToCommand = true } = {}) {
  const { store, runtime, controller } = fixture();
  const command = controller.createCommand({
    id: "command-1",
    targetType: CommandTargetType.TASK,
    targetId: "task-1",
    action: "deploy",
    capability: "deploy.production",
    scope: "production",
    riskLevel: RiskLevel.HIGH,
    requestedBy: "requester-1",
    expectedVersion: 1,
    parameters: { environment: "production" },
    idempotencyKey: "deploy:task-1:v1",
  }, { mutationId: "mutation-create-command-1" });

  store.requestApproval({
    id: "approval-1",
    targetType: ApprovalTargetType.TASK,
    targetId: "task-1",
    action: "deploy",
    capability: "deploy.production",
    scope: "production",
    riskLevel: RiskLevel.HIGH,
    requestedBy: "requester-1",
    commandId: bindApprovalToCommand ? command.id : null,
  });
  return { store, runtime, controller, command };
}

test("controller creates a durable command by pinning current target state", () => {
  const { store, runtime, command } = commandFixture();

  assert.equal(command.status, CommandStatus.CREATED);
  assert.equal(command.version, 1);
  assert.equal(command.targetType, CommandTargetType.TASK);
  assert.equal(command.targetId, "task-1");
  assert.equal(command.targetVersion, 1);
  assert.equal(command.action, "deploy");
  assert.equal(command.capability, "deploy.production");
  assert.equal(command.scope, "production");
  assert.equal(command.expectedVersion, 1);
  assert.deepEqual(command.parameters, { environment: "production" });
  assert.equal(store.getControlCommand("command-1").idempotencyKey, "deploy:task-1:v1");
  assert.equal(runtime.started.length, 0, "creating control intent executes nothing");
});

test("pending or missing approval leaves the durable command CREATED", () => {
  const { store, controller, command } = commandFixture();
  const eventsBefore = store.getEvents().length;

  const pending = controller.authorizeCommand(command.id, command.version, { approvalId: "approval-1" });
  assert.equal(pending.action, "WAIT");
  assert.equal(pending.reason, "approval-pending");
  assert.equal(pending.command.status, CommandStatus.CREATED);
  assert.equal(store.getControlCommand(command.id).version, 1);
  assert.equal(store.getEvents().length, eventsBefore, "WAIT is not a state transition");

  const missing = controller.authorizeCommand(command.id, command.version);
  assert.equal(missing.action, "WAIT");
  assert.equal(missing.reason, "approval-required");
  assert.equal(store.getControlCommand(command.id).status, CommandStatus.CREATED);
});

test("usable approval authorizes the stored command exactly once without executing it", () => {
  const { store, runtime, controller, command } = commandFixture();
  store.decideApproval("approval-1", 1, { decision: ApprovalDecision.APPROVE, decidedBy: "alice" });
  const taskBefore = store.getTask("task-1");

  const result = controller.authorizeCommand(command.id, command.version, {
    approvalId: "approval-1",
    mutationId: "mutation-authorize-command-1",
    // Extra caller data cannot substitute for durable intent; Controller ignores it.
    action: "delete",
    capability: "delete.production",
    scope: "staging",
  });

  assert.equal(result.action, "AUTHORIZE");
  assert.equal(result.command.status, CommandStatus.AUTHORIZED);
  assert.equal(result.command.version, 2);
  assert.equal(result.command.action, "deploy");
  assert.equal(result.command.capability, "deploy.production");
  assert.equal(result.command.scope, "production");
  assert.equal(result.command.authorization.approvalId, "approval-1");
  assert.equal(runtime.started.length, 0, "authorization is not execution");
  assert.deepEqual(store.getTask("task-1"), taskBefore, "authorization is not project acceptance");
  assert.ok(store.getEvents().some((event) => event.type === "command.authorized"));

  const replay = controller.authorizeCommand(command.id, command.version, {
    approvalId: "approval-1",
    mutationId: "mutation-authorize-command-1",
  });
  assert.equal(replay.action, "AUTHORIZE");
  assert.equal(replay.command.version, 2, "mutation replay does not transition twice");
  assert.equal(store.getEvents().filter((event) => event.type === "command.authorized").length, 1);
});

test("a stale target rejects the concrete command instead of retargeting it", () => {
  const { store, controller, command } = commandFixture();
  store.updateTask("task-1", 1, { status: TaskStatus.IN_PROGRESS }, { commandId: "move-task" });

  const result = controller.authorizeCommand(command.id, command.version, { approvalId: "approval-1" });

  assert.equal(result.action, "REJECT");
  assert.equal(result.reason, "target-stale");
  assert.equal(result.command.status, CommandStatus.REJECTED);
  assert.equal(result.command.targetVersion, 1, "the command is never silently rebound to v2");
  assert.equal(store.getTask("task-1").version, 2);
  assert.ok(store.getEvents().some((event) => event.type === "command.rejected"));
});

test("command concurrency is independent of target/approval concurrency", () => {
  const { controller, command } = commandFixture();

  assert.throws(
    () => controller.authorizeCommand(command.id, 99, { approvalId: "approval-1" }),
    (error) => error instanceof ConflictError && /expected v99, current v1/.test(error.message),
  );
});

test("a durable command cannot be created against a caller-invented target version", () => {
  const { controller } = fixture();

  assert.throws(
    () => controller.createCommand({
      id: "command-stale",
      targetType: CommandTargetType.TASK,
      targetId: "task-1",
      targetVersion: 9,
      action: "deploy",
      capability: "deploy.production",
      scope: "production",
      requestedBy: "requester-1",
      idempotencyKey: "stale",
    }),
    (error) => error instanceof InvariantError && /is v1, not v9/.test(error.message),
  );
});

test("COMMAND-target Approval remains fail closed even though durable Command now exists", () => {
  const { store } = commandFixture();

  assert.throws(
    () => store.requestApproval({
      id: "approval-command-target",
      targetType: ApprovalTargetType.COMMAND,
      targetId: "command-1",
      action: "deploy",
      capability: "deploy.production",
      scope: "production",
      requestedBy: "requester-1",
      commandId: "command-1",
    }),
    (error) => error instanceof InvariantError,
  );
});
