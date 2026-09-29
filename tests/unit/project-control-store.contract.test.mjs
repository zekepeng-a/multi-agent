// Store contract test: the SAME behaviour suite runs against every backend.
//
// This is what makes the backend swappable. If a PostgreSQL store is added later,
// it is registered here and must pass the same contract without touching the
// Controller tests. Nothing in this file may use backend-specific APIs — only
// the Store contract in project-control/store.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { MemoryStore } from "../../project-control/memory-store.mjs";
import {
  SqliteStore,
  isSqliteAvailable,
  SQLITE_REQUIREMENT,
} from "../../project-control/sqlite-store.mjs";
import {
  AttemptStatus,
  ConflictError,
  EvidenceStatus,
  InvariantError,
  RunStatus,
  TaskStatus,
  VerificationVerdict,
  createAcceptance,
  createAttempt,
  createEvidence,
  createProject,
  createRun,
  createTask,
  createVerification,
} from "../../project-control/domain.mjs";

const BACKENDS = [
  {
    name: "MemoryStore",
    skip: false,
    make() {
      return new MemoryStore();
    },
  },
  {
    name: "SqliteStore",
    skip: isSqliteAvailable() ? false : `node:sqlite is unavailable: ${SQLITE_REQUIREMENT}`,
    make(t) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-contract-"));
      const store = new SqliteStore(path.join(dir, "project-control.db"));
      t.after(() => {
        try {
          store.close();
        } catch {
          // already closed
        }
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      });
      return store;
    },
  },
];

// ── shared fixture helpers (backend-agnostic) ────────────────────────────────

function seedAcceptance(store, { criteria = [{ id: "build", type: "BUILD", required: true }] } = {}) {
  store.seedAcceptance(createAcceptance({ id: "acceptance-1", targetId: "task-1", criteria }));
}

function seedTask(store, { id = "task-1", acceptanceVersion = 1, status = TaskStatus.READY } = {}) {
  store.seedTask(createTask({ id, title: `${id} title`, acceptanceId: "acceptance-1", acceptanceVersion, status }));
}

function seedChain(store, { taskId = "task-1", runId = "run-1", attemptId = "attempt-1" } = {}) {
  store.createRun(createRun({ id: runId, taskId, status: RunStatus.READY }));
  store.createAttempt(createAttempt({ id: attemptId, runId, attemptNumber: 1 }));
}

function evidenceFor(over = {}) {
  return createEvidence({
    id: "ev-1",
    taskId: "task-1",
    runId: "run-1",
    attemptId: "attempt-1",
    acceptanceId: "acceptance-1",
    acceptanceVersion: 1,
    revision: "rev-1",
    status: EvidenceStatus.CANDIDATE,
    contentRef: "artifact://contract",
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

function eventsWithoutTimestamps(store) {
  return store.getEvents().map(({ occurredAt, ...rest }) => rest);
}

// ── the contract, defined once per backend ───────────────────────────────────

for (const backend of BACKENDS) {
  const { name, skip } = backend;

  test(`${name}: seed + get round-trips Project, Acceptance revision, Task, Run and Attempt`, { skip }, (t) => {
    const store = backend.make(t);
    store.seedProject(createProject({ id: "project-1", name: "Contract project" }));
    seedAcceptance(store);
    seedTask(store);
    seedChain(store);

    assert.equal(store.getProject("project-1").name, "Contract project");
    assert.equal(store.getProject("project-1").status, "ACTIVE");
    assert.equal(store.getTask("task-1").status, TaskStatus.READY);
    assert.equal(store.getTask("task-1").acceptanceVersion, 1);
    assert.equal(store.getAcceptance("acceptance-1", 1).criteria[0].id, "build");
    assert.equal(store.getRun("run-1").taskId, "task-1");
    assert.equal(store.getAttempt("attempt-1").runId, "run-1");
    assert.deepEqual(store.getRunsForTask("task-1").map((run) => run.id), ["run-1"]);

    assert.throws(() => store.getProject("nope"), /project not found/);
    assert.throws(() => store.getTask("nope"), /task not found/);
    assert.throws(() => store.getAttempt("nope"), /attempt not found/);
  });

  test(`${name}: contract revisions coexist and a task stays pinned to its own revision`, { skip }, (t) => {
    const store = backend.make(t);
    seedAcceptance(store);
    seedTask(store);

    const revised = store.reviseAcceptance("acceptance-1", { criteria: [{ id: "lint", type: "LINT", required: true }] });

    assert.equal(revised.version, 2);
    assert.equal(store.getAcceptance("acceptance-1", 1).criteria[0].id, "build");
    assert.equal(store.getAcceptance("acceptance-1", 2).criteria[0].id, "lint");
    assert.equal(store.getTask("task-1").acceptanceVersion, 1, "the task does not drift onto the head revision");
    assert.throws(() => store.getAcceptance("acceptance-1", 3), /not found/);
    assert.throws(() => store.getAcceptance("acceptance-1"), InvariantError);

    // a decision is not a revision change
    assert.equal(store.getAcceptance("acceptance-1", 1).version, 1);
  });

  test(`${name}: lineage violations are rejected on write`, { skip }, (t) => {
    const store = backend.make(t);
    seedAcceptance(store);
    seedTask(store);
    seedTask(store, { id: "task-2" });
    seedChain(store);
    seedChain(store, { taskId: "task-2", runId: "run-2", attemptId: "attempt-2" });

    // evidence of another task
    store.recordEvidence(evidenceFor({ id: "ev-task2", taskId: "task-2", runId: "run-2", attemptId: "attempt-2" }));
    assert.throws(() => store.recordVerification(verificationFor(["ev-task2"])), /does not belong to task task-1/);

    // evidence claiming task-1 through another task's Run
    store.recordEvidence(evidenceFor({ id: "ev-run2", runId: "run-2", attemptId: "attempt-2" }));
    assert.throws(() => store.recordVerification(verificationFor(["ev-run2"])), /references run run-2/);

    // evidence whose Attempt belongs to another Run
    store.recordEvidence(evidenceFor({ id: "ev-attempt2", runId: "run-1", attemptId: "attempt-2" }));
    assert.throws(() => store.recordVerification(verificationFor(["ev-attempt2"])), /references attempt attempt-2/);

    // two lineages inside one verification
    store.recordEvidence(evidenceFor({ id: "ev-a" }));
    assert.throws(
      () => store.recordVerification(verificationFor(["ev-a", "ev-task2"])),
      InvariantError,
    );

    // revision mismatch between evidence and verification
    store.recordEvidence(evidenceFor({ id: "ev-rev" }));
    assert.throws(() => store.recordVerification(verificationFor(["ev-rev"], { revision: "rev-9" })), /revision/);
    assert.throws(() => store.recordVerification(verificationFor(["ev-null"], {})), /evidence not found/);
  });

  test(`${name}: stale or superseded evidence cannot support PASS, and cannot be accepted later`, { skip }, (t) => {
    const store = backend.make(t);
    seedAcceptance(store);
    seedTask(store);
    seedChain(store);

    for (const status of [EvidenceStatus.STALE, EvidenceStatus.SUPERSEDED]) {
      const id = `ev-${status.toLowerCase()}`;
      store.recordEvidence(evidenceFor({ id, status }));
      assert.throws(
        () => store.recordVerification(verificationFor([id], { id: `v-${status}` })),
        /cannot support a PASS verification/,
      );
      // a failure verdict grants nothing and is still recordable
      assert.equal(
        store.recordVerification(verificationFor([id], { id: `v-fail-${status}`, verdict: VerificationVerdict.FAIL })).verdict,
        VerificationVerdict.FAIL,
      );
    }

    // recorded legally while CANDIDATE, then superseded underneath the verification
    store.recordEvidence(evidenceFor({ id: "ev-live" }));
    store.recordVerification(verificationFor(["ev-live"], { id: "v-live" }));
    store.putRecord("evidence", "ev-live", { ...store.getEvidence("ev-live"), status: EvidenceStatus.STALE });
    assert.throws(
      () => store.acceptTask("task-1", 1, { verificationId: "v-live" }),
      /cannot support a PASS verification/,
    );
    assert.notEqual(store.getTask("task-1").status, TaskStatus.ACCEPTED);
  });

  test(`${name}: optimistic concurrency conflicts instead of overwriting`, { skip }, (t) => {
    const store = backend.make(t);
    seedAcceptance(store);
    seedTask(store);
    seedChain(store);

    const updated = store.updateTask("task-1", 1, { status: TaskStatus.IN_PROGRESS }, { commandId: "cmd-1" });
    assert.equal(updated.version, 2);
    const events = store.getEvents().length;

    assert.throws(
      () => store.updateTask("task-1", 1, { status: TaskStatus.NEEDS_REVIEW }, { commandId: "cmd-2" }),
      (error) => error instanceof ConflictError,
    );
    assert.equal(store.getTask("task-1").status, TaskStatus.IN_PROGRESS);
    assert.equal(store.getTask("task-1").version, 2);
    assert.equal(store.getEvents().length, events, "a conflicting command appends no event");

    // the same guard applies to runs
    store.updateRun("run-1", 1, { status: RunStatus.RUNNING }, { commandId: "cmd-3" });
    assert.throws(
      () => store.updateRun("run-1", 1, { status: RunStatus.FAILED }, { commandId: "cmd-4" }),
      (error) => error instanceof ConflictError,
    );
  });

  test(`${name}: a repeated commandId replays instead of mutating twice`, { skip }, (t) => {
    const store = backend.make(t);
    seedAcceptance(store);
    seedTask(store);

    const first = store.updateTask("task-1", 1, { status: TaskStatus.IN_PROGRESS }, { commandId: "cmd-1" });
    const events = store.getEvents().length;
    const replay = store.updateTask("task-1", 1, { status: TaskStatus.IN_PROGRESS }, { commandId: "cmd-1" });

    assert.equal(first.version, 2);
    assert.equal(replay.version, 2);
    assert.equal(store.getTask("task-1").version, 2, "the version must not move a second time");
    assert.equal(store.getEvents().length, events, "no duplicate event");

    // one commandId may not be reused for a different operation
    assert.throws(
      () => store.createRun(createRun({ id: "run-x", taskId: "task-1" }), { commandId: "cmd-1" }),
      /already used for another operation/,
    );
  });

  test(`${name}: acceptance needs the pinned revision, a PASS verdict and a proven chain`, { skip }, (t) => {
    const store = backend.make(t);
    seedAcceptance(store);
    seedTask(store);
    seedChain(store);

    // candidate evidence alone is not acceptance
    store.recordEvidence(evidenceFor({ id: "ev-only" }));
    assert.throws(() => store.acceptTask("task-1", 1, { verificationId: "missing" }), /verification not found/);

    // a FAIL verdict cannot accept
    store.recordVerification(verificationFor(["ev-only"], { id: "v-fail", verdict: VerificationVerdict.FAIL }));
    assert.throws(() => store.acceptTask("task-1", 1, { verificationId: "v-fail" }), /cannot be accepted/);

    // a PASS verdict on the pinned revision does
    store.recordVerification(verificationFor(["ev-only"], { id: "v-pass" }));
    const accepted = store.acceptTask("task-1", 1, { verificationId: "v-pass" });
    assert.equal(accepted.status, TaskStatus.ACCEPTED);
    assert.equal(accepted.version, 2);
    assert.equal(store.getAcceptance("acceptance-1", 1).status, "PASSED");

    // a stale expectedVersion on acceptance conflicts instead of re-accepting
    assert.throws(
      () => store.acceptTask("task-1", 1, { verificationId: "v-pass" }),
      (error) => error instanceof ConflictError,
    );
    assert.equal(store.getTask("task-1").version, 2);
  });

  test(`${name}: the event log is append-only and self-describing`, { skip }, (t) => {
    const store = backend.make(t);
    store.seedProject(createProject({ id: "project-1", name: "Contract project" }));
    seedAcceptance(store);
    seedTask(store);
    seedChain(store);
    store.recordEvidence(evidenceFor({ id: "ev-1" }));
    store.recordVerification(verificationFor(["ev-1"], { id: "v-1" }));
    store.acceptTask("task-1", 1, { verificationId: "v-1" });

    const events = store.getEvents();
    assert.deepEqual(events.map((event) => event.id), events.map((_event, index) => `evt-${index + 1}`));
    assert.deepEqual(events.map((event) => event.type), [
      "project.created",
      "acceptance.created",
      "task.created",
      "run.created",
      "attempt.created",
      "evidence.recorded",
      "verification.recorded",
      "task.accepted",
    ]);
    assert.deepEqual(events.map((event) => event.aggregateType), [
      "project",
      "acceptance",
      "task",
      "run",
      "attempt",
      "evidence",
      "verification",
      "task",
    ]);
    // where an aggregate has a concurrency version the event carries it
    assert.deepEqual(events.map((event) => event.aggregateVersion), [1, null, 1, 1, null, null, null, 2]);
    assert.equal(events.at(-1).payload.verificationId, "v-1");
    for (const event of events) {
      assert.match(event.occurredAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(typeof event.aggregateId, "string");
    }

    // history is a copy: mutating what a caller received cannot change the store
    const snapshot = eventsWithoutTimestamps(store);
    const handedOut = store.getEvents();
    handedOut[0].type = "tampered";
    handedOut.push({ id: "evt-999", type: "forged" });
    assert.deepEqual(eventsWithoutTimestamps(store), snapshot);
  });
}
