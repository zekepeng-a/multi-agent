import test from "node:test";
import assert from "node:assert/strict";

import {
  ConflictError,
  EvidenceStatus,
  TaskStatus,
  createAcceptance,
  createTask,
  createEvidence,
  createVerification,
  VerificationVerdict,
} from "../../project-control/domain.mjs";
import { MemoryStore } from "../../project-control/memory-store.mjs";
import { FakeRuntime } from "../../project-control/fake-runtime.mjs";
import { Controller } from "../../project-control/controller.mjs";

function fixture(runtimeMode = "success") {
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
  let n = 0;
  const controller = new Controller({
    store,
    runtime,
    idFactory: (prefix) => `${prefix}-${++n}`,
  });
  return { store, runtime, controller };
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
