import test from "node:test";
import assert from "node:assert/strict";

import { Controller } from "../../project-control/controller.mjs";
import { DshWorkflowRuntimeAdapter } from "../../project-control/dsh-workflow-runtime.mjs";
import { FakeVerifier } from "../../project-control/fake-verifier.mjs";
import { LocalProcessRuntimeAdapter } from "../../project-control/local-process-runtime.mjs";
import { MemoryStore } from "../../project-control/memory-store.mjs";
import {
  RuntimeOutcome,
  RuntimeState,
  UnsupportedRuntimeCapabilityError,
  assertCapability,
} from "../../project-control/runtime-adapter.mjs";
import {
  EvidenceStatus,
  TaskStatus,
  VerificationVerdict,
  createAcceptance,
  createTask,
} from "../../project-control/domain.mjs";

test("LocalProcessRuntimeAdapter executes a real child process and normalizes success", async () => {
  const runtime = new LocalProcessRuntimeAdapter();
  const started = await runtime.start({
    run: { id: "run-1" },
    attempt: { id: "attempt-1" },
    contextCapsule: {
      process: {
        command: process.execPath,
        args: ["-e", "process.stdout.write('runtime-ok')"],
      },
    },
  });

  assert.notEqual(started.runtimeRef.externalId, "run-1");
  assert.notEqual(started.runtimeRef.externalId, "attempt-1");
  const result = await runtime.collectResult(started.runtimeRef);

  assert.equal(result.outcome, RuntimeOutcome.COMPLETED);
  assert.equal(result.details.exitCode, 0);
  assert.equal(result.details.stdout, "runtime-ok");
  assert.ok(result.resultRef.startsWith("process-output://"));
  assert.ok(result.revision);
  assert.equal((await runtime.observe(started.runtimeRef)).state, RuntimeState.COMPLETED);
});

test("LocalProcessRuntimeAdapter normalizes non-zero exit as FAILED", async () => {
  const runtime = new LocalProcessRuntimeAdapter();
  const started = await runtime.start({
    run: { id: "run-1" },
    attempt: { id: "attempt-1" },
    contextCapsule: {
      process: {
        command: process.execPath,
        args: ["-e", "process.stderr.write('boom'); process.exit(7)"],
      },
    },
  });
  const result = await runtime.collectResult(started.runtimeRef);

  assert.equal(result.outcome, RuntimeOutcome.FAILED);
  assert.equal(result.details.exitCode, 7);
  assert.equal(result.details.stderr, "boom");
});

test("LocalProcessRuntimeAdapter cancellation is explicit and not success", async () => {
  const runtime = new LocalProcessRuntimeAdapter();
  const started = await runtime.start({
    run: { id: "run-1" },
    attempt: { id: "attempt-1" },
    contextCapsule: {
      process: {
        command: process.execPath,
        args: ["-e", "setTimeout(() => {}, 5000)"],
      },
    },
  });

  await runtime.cancel(started.runtimeRef, "test cancellation");
  const result = await runtime.collectResult(started.runtimeRef);

  assert.equal(result.outcome, RuntimeOutcome.CANCELLED);
  assert.equal((await runtime.observe(started.runtimeRef)).state, RuntimeState.CANCELLED);
});

test("unsupported runtime capability fails loudly", () => {
  const runtime = new LocalProcessRuntimeAdapter();

  assert.equal(runtime.capabilities().resume, false);
  assert.throws(
    () => assertCapability(runtime, "resume"),
    (error) =>
      error instanceof UnsupportedRuntimeCapabilityError &&
      error.code === "UNSUPPORTED_RUNTIME_CAPABILITY" &&
      error.capability === "resume",
  );
});

test("Controller maps a real process COMPLETED result into Candidate Evidence and Acceptance flow", async () => {
  const store = new MemoryStore();
  store.seedAcceptance(createAcceptance({
    id: "acceptance-1",
    targetId: "task-1",
    criteria: [{ id: "runtime", type: "BEHAVIOR", required: true }],
  }));
  store.seedTask(createTask({
    id: "task-1",
    title: "execute real process",
    acceptanceId: "acceptance-1",
    acceptanceVersion: 1,
  }));

  const runtime = new LocalProcessRuntimeAdapter();
  const controller = new Controller({
    store,
    runtime,
    verifier: new FakeVerifier({ verdict: VerificationVerdict.PASS }),
    runtimeContextFactory: () => ({
      process: {
        command: process.execPath,
        args: ["-e", "process.stdout.write('artifact')"],
      },
    }),
    idFactory: (() => {
      let n = 0;
      return (prefix) => `${prefix}-${++n}`;
    })(),
  });

  const result = await controller.reconcileTask("task-1");

  assert.equal(result.action, "ACCEPT");
  assert.equal(result.task.status, TaskStatus.ACCEPTED);
  assert.equal(result.evidence.status, EvidenceStatus.CANDIDATE);
  assert.ok(result.evidence.contentRef.startsWith("process-output://"));
  assert.ok(result.attempt.runtimeRef);
  assert.equal(result.attempt.runtimeRef.runtimeKind, "local-process");
  assert.notEqual(result.attempt.runtimeRef.externalId, result.run.id);
  assert.notEqual(result.attempt.runtimeRef.externalId, result.attempt.id);
});

test("Controller does not create Evidence or Acceptance for a failed real process", async () => {
  const store = new MemoryStore();
  store.seedAcceptance(createAcceptance({
    id: "acceptance-1",
    targetId: "task-1",
    criteria: [{ id: "runtime", type: "BEHAVIOR", required: true }],
  }));
  store.seedTask(createTask({
    id: "task-1",
    title: "failing process",
    acceptanceId: "acceptance-1",
    acceptanceVersion: 1,
  }));

  const controller = new Controller({
    store,
    runtime: new LocalProcessRuntimeAdapter(),
    verifier: new FakeVerifier({ verdict: VerificationVerdict.PASS }),
    runtimeContextFactory: () => ({
      process: {
        command: process.execPath,
        args: ["-e", "process.exit(9)"],
      },
    }),
  });

  const result = await controller.reconcileTask("task-1");

  assert.equal(result.action, "FAILED");
  assert.equal(store.getTask("task-1").status, TaskStatus.IN_PROGRESS);
  assert.equal(store.allRecords("evidence").length, 0);
  assert.equal(store.getAcceptance("acceptance-1", 1).status, "PENDING");
  assert.ok(result.attempt.runtimeRef);
});

function fakeWorkflowEngine({ value = { ok: true }, stopReason = "completed" } = {}) {
  const calls = [];
  let cancelled = false;
  let disposed = 0;
  return {
    calls,
    get cancelled() { return cancelled; },
    get disposed() { return disposed; },
    start(request) {
      calls.push(request);
      let resolveResult;
      const result = new Promise((resolve) => { resolveResult = resolve; });
      const live = {
        id: "workflow-123",
        meta: request.meta,
        result,
        cancel() {
          cancelled = true;
          resolveResult({ value: null, stopReason: "cancelled", agentsStarted: 0 });
        },
        async dispose() { disposed += 1; },
      };
      queueMicrotask(() => {
        if (!cancelled) {
          resolveResult({
            value: stopReason === "completed" ? value : null,
            stopReason,
            error: stopReason === "error" ? "workflow failed" : undefined,
            agentsStarted: 2,
          });
        }
      });
      return live;
    },
  };
}

test("DshWorkflowRuntimeAdapter maps the public WorkflowRun contract", async () => {
  const engine = fakeWorkflowEngine({ value: { artifact: "ok" } });
  const runtime = new DshWorkflowRuntimeAdapter({ workflowEngine: engine });

  const started = await runtime.start({
    run: { id: "run-project-1" },
    attempt: { id: "attempt-project-1" },
    contextCapsule: {
      dshWorkflow: {
        script: "return { artifact: 'ok' }",
        meta: { name: "test-workflow", description: "adapter contract test" },
        args: { task: "x" },
        parent: { id: "agent-parent" },
      },
    },
  });

  assert.equal(started.runtimeRef.workflowId, "workflow-123");
  assert.notEqual(started.runtimeRef.workflowId, "run-project-1");
  assert.equal(runtime.capabilities().resume, false);
  assert.equal(runtime.capabilities().pause, false);

  const result = await runtime.collectResult(started.runtimeRef);
  assert.equal(result.outcome, RuntimeOutcome.COMPLETED);
  assert.equal(result.details.stopReason, "completed");
  assert.deepEqual(result.details.value, { artifact: "ok" });
  assert.equal(engine.disposed, 1);
  assert.equal(engine.calls.length, 1);
});

test("DshWorkflowRuntimeAdapter maps cancel without pretending rollback", async () => {
  let resolveResult;
  const engine = {
    start() {
      return {
        id: "workflow-cancel",
        result: new Promise((resolve) => { resolveResult = resolve; }),
        cancel() {
          resolveResult({ value: null, stopReason: "cancelled", agentsStarted: 1 });
        },
        async dispose() {},
      };
    },
  };
  const runtime = new DshWorkflowRuntimeAdapter({ workflowEngine: engine });
  const started = await runtime.start({
    run: { id: "run-1" },
    attempt: { id: "attempt-1" },
    contextCapsule: {
      dshWorkflow: {
        script: "return null",
        meta: { name: "cancel-test", description: "cancel contract" },
        parent: { id: "parent" },
      },
    },
  });

  await runtime.cancel(started.runtimeRef, "stop");
  const result = await runtime.collectResult(started.runtimeRef);

  assert.equal(result.outcome, RuntimeOutcome.CANCELLED);
  assert.equal(result.details.stopReason, "cancelled");
});
