// Persistence Spike v0.1 — does the already-verified Project Control semantics
// survive a process restart?
//
// Every test works on its own temporary database, and the fixture closes its
// stores before deleting the directory (Windows keeps the file locked
// otherwise). Nothing here may touch the repository, a real project directory,
// or a shared .ai/ state folder.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  SqliteStore,
  isSqliteAvailable,
  SQLITE_REQUIREMENT,
} from "../../project-control/sqlite-store.mjs";
import { Controller } from "../../project-control/controller.mjs";
import { FakeRuntime } from "../../project-control/fake-runtime.mjs";
import { FakeVerifier } from "../../project-control/fake-verifier.mjs";
import {
  AttemptStatus,
  ConflictError,
  GoalStatus,
  InvariantError,
  ProjectStatus,
  ReconcileOutcome,
  RunStatus,
  TaskStatus,
  VerificationVerdict,
  createAcceptance,
  createAttempt,
  createEvidence,
  createGoal,
  createMilestone,
  createProject,
  createRun,
  createTask,
  createVerification,
} from "../../project-control/domain.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHILD = path.join(HERE, "..", "helpers", "pc-persist-child.mjs");
const skip = isSqliteAvailable() ? false : `node:sqlite is unavailable in this runtime: ${SQLITE_REQUIREMENT}`;

/**
 * One temporary database per test. Stores opened through the fixture are closed
 * by the fixture's single cleanup hook, which then removes the directory — the
 * order matters on Windows, where an open SQLite file cannot be deleted.
 */
function projectFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-persist-"));
  const file = path.join(dir, "project-control.db");
  const opened = [];
  t.after(() => {
    for (const store of opened) {
      try {
        store.close();
      } catch {
        // already closed by the test
      }
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  return {
    dir,
    file,
    open() {
      const store = new SqliteStore(file);
      opened.push(store);
      return store;
    },
  };
}

function seedBase(store) {
  store.seedAcceptance(createAcceptance({
    id: "acceptance-1",
    targetId: "task-1",
    criteria: [{ id: "build", type: "BUILD", required: true }],
  }));
  store.seedTask(createTask({
    id: "task-1",
    title: "persisted task",
    acceptanceId: "acceptance-1",
    acceptanceVersion: 1,
  }));
}

function controllerFor(store, { runtimeMode = "success" } = {}) {
  let n = 0;
  const runtime = new FakeRuntime({ mode: runtimeMode });
  const controller = new Controller({
    store,
    runtime,
    verifier: new FakeVerifier({}),
    idFactory: (prefix) => `${prefix}-${++n}`,
  });
  return { controller, runtime };
}

function runChild(mode, file, ids) {
  const args = [CHILD, mode, file, ...(ids ? [JSON.stringify(ids)] : [])];
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  const line = (result.stdout ?? "").split(/\r?\n/).find((entry) => entry.startsWith("RESULT "));
  return {
    code: result.status,
    stderr: result.stderr ?? "",
    payload: line ? JSON.parse(line.slice("RESULT ".length)) : null,
  };
}

test("A: a task and its pinned acceptance revision survive closing and reopening the database", { skip }, (t) => {
  const db = projectFixture(t);
  const first = db.open();
  seedBase(first);
  first.close();

  const reopened = db.open();

  const task = reopened.getTask("task-1");
  assert.equal(task.status, TaskStatus.READY);
  assert.equal(task.acceptanceId, "acceptance-1");
  assert.equal(task.acceptanceVersion, 1);
  assert.equal(reopened.getAcceptance("acceptance-1", 1).criteria[0].id, "build");
});

test("B: contract revisions v1 and v2 coexist, before and after a reopen", { skip }, (t) => {
  const db = projectFixture(t);
  const store = db.open();
  seedBase(store);
  store.reviseAcceptance("acceptance-1", { criteria: [{ id: "lint", type: "LINT", required: true }] });
  store.close();

  const reopened = db.open();

  assert.equal(reopened.getAcceptance("acceptance-1", 1).status, "PENDING");
  assert.equal(reopened.getAcceptance("acceptance-1", 2).status, "PENDING");
  assert.equal(reopened.getAcceptance("acceptance-1", 1).criteria[0].id, "build");
  assert.equal(reopened.getAcceptance("acceptance-1", 2).criteria[0].id, "lint");
});

test("C: an existing task does not drift onto the newest revision after a restart", { skip }, async (t) => {
  const db = projectFixture(t);
  const store = db.open();
  seedBase(store);
  store.reviseAcceptance("acceptance-1", { criteria: [{ id: "lint", type: "LINT", required: true }] });
  store.close();

  const reopened = db.open();
  assert.equal(reopened.getTask("task-1").acceptanceVersion, 1);

  const { controller } = controllerFor(reopened);
  const result = await controller.reconcileTask("task-1");

  assert.equal(result.action, "ACCEPT");
  assert.equal(result.evidence.acceptanceVersion, 1, "evidence binds the pinned revision, not the newest");
  assert.equal(result.verification.acceptanceVersion, 1);
  assert.equal(reopened.getAcceptance("acceptance-1", 1).status, "PASSED");
  assert.equal(reopened.getAcceptance("acceptance-1", 2).status, "PENDING");
});

test("D: the full Run → Attempt → Evidence → Verification lineage survives a reopen", { skip }, async (t) => {
  const db = projectFixture(t);
  const store = db.open();
  seedBase(store);
  const { controller } = controllerFor(store);
  const result = await controller.reconcileTask("task-1");
  store.close();

  const reopened = db.open();

  assert.equal(reopened.getRun(result.run.id).status, RunStatus.COMPLETED);
  assert.equal(reopened.getAttempt(result.attempt.id).status, AttemptStatus.COMPLETED);
  assert.equal(reopened.getAttempt(result.attempt.id).runId, result.run.id);
  assert.equal(reopened.getEvidence(result.evidence.id).runId, result.run.id);
  assert.equal(reopened.getEvidence(result.evidence.id).attemptId, result.attempt.id);
  assert.equal(reopened.getEvidence(result.evidence.id).taskId, "task-1");
  assert.equal(reopened.getVerification(result.verification.id).taskId, "task-1");
  assert.deepEqual(reopened.getVerification(result.verification.id).evidenceIds, [result.evidence.id]);
});

test("E: an accepted task is still accepted after a restart", { skip }, async (t) => {
  const db = projectFixture(t);
  const store = db.open();
  seedBase(store);
  const { controller } = controllerFor(store);
  assert.equal((await controller.reconcileTask("task-1")).action, "ACCEPT");
  store.close();

  const reopened = db.open();
  assert.equal(reopened.getTask("task-1").status, TaskStatus.ACCEPTED);
  assert.equal(reopened.getAcceptance("acceptance-1", 1).status, "PASSED");
});

test("F: the append-oriented event log survives a restart unchanged", { skip }, async (t) => {
  const db = projectFixture(t);
  const store = db.open();
  seedBase(store);
  const { controller } = controllerFor(store);
  await controller.reconcileTask("task-1");
  const before = store.getEvents();
  store.close();

  const reopened = db.open();
  const after = reopened.getEvents();

  assert.equal(after.length, before.length);
  assert.deepEqual(
    after.map((event) => [event.id, event.type, event.aggregateId, event.commandId]),
    before.map((event) => [event.id, event.type, event.aggregateId, event.commandId]),
  );
  assert.deepEqual(after.at(-1).payload, before.at(-1).payload);
  assert.deepEqual(after.map((event) => event.occurredAt), before.map((event) => event.occurredAt));
});

test("G: a stale expectedVersion conflicts and leaves no partial update", { skip }, (t) => {
  const db = projectFixture(t);
  const store = db.open();
  seedBase(store);

  store.updateTask("task-1", 1, { status: TaskStatus.IN_PROGRESS }, { commandId: "cmd-1" });
  const events = store.getEvents().length;

  assert.throws(
    () => store.updateTask("task-1", 1, { status: TaskStatus.NEEDS_REVIEW }, { commandId: "cmd-2" }),
    (error) => error instanceof ConflictError,
  );
  assert.equal(store.getTask("task-1").version, 2);
  assert.equal(store.getTask("task-1").status, TaskStatus.IN_PROGRESS);
  assert.equal(store.getEvents().length, events, "a conflicting command writes no event");
});

test("H: a repeated commandId does not mutate a second time, even across a restart", { skip }, (t) => {
  const db = projectFixture(t);
  const store = db.open();
  seedBase(store);
  const first = store.updateTask("task-1", 1, { status: TaskStatus.IN_PROGRESS }, { commandId: "cmd-1" });
  const events = store.getEvents().length;
  store.close();

  const reopened = db.open();
  const replay = reopened.updateTask("task-1", 1, { status: TaskStatus.IN_PROGRESS }, { commandId: "cmd-1" });

  assert.equal(replay.version, first.version);
  assert.equal(reopened.getTask("task-1").version, 2, "the version must not move a second time");
  assert.equal(reopened.getEvents().length, events, "no duplicate event");

  // the same commandId may not be reused for a different operation either
  assert.throws(
    () => reopened.createRun(createRun({ id: "run-x", taskId: "task-1" }), { commandId: "cmd-1" }),
    InvariantError,
  );
});

test("I: a real transaction failure rolls back state, event and command row together", { skip }, (t) => {
  const db = projectFixture(t);
  const store = db.open();
  seedBase(store);
  const eventsBefore = store.getEvents().length;

  // Direction 1 — the state write succeeds, then a genuine SQL constraint
  // violation aborts the transaction: the foreign key on verifications.task_id
  // rejects a task that does not exist. This is a real database failure, not a
  // synthetic throw.
  assert.throws(
    () => store.runInTransaction(() => {
      store.updateTask("task-1", 1, { status: TaskStatus.IN_PROGRESS }, { commandId: "tx-1" });
      store.insertRecord("verification", "v-ghost", {
        id: "v-ghost", taskId: "ghost-task", acceptanceId: "acceptance-1", acceptanceVersion: 1,
      });
    }),
    (error) => error.code === "ERR_SQLITE_ERROR" && /FOREIGN KEY/.test(error.message),
  );

  assert.equal(store.getTask("task-1").version, 1, "state rolled back");
  assert.equal(store.getTask("task-1").status, TaskStatus.READY);
  assert.equal(store.getEvents().length, eventsBefore, "event rolled back");
  assert.throws(() => store.getVerification("v-ghost"), /verification not found/);
  // the idempotency row rolled back too, so the same command is still executable
  assert.equal(store.updateTask("task-1", 1, { status: TaskStatus.IN_PROGRESS }, { commandId: "tx-1" }).version, 2);

  // Direction 2 — the EVENT is written first and the state write then fails: the
  // event must disappear with the rest of the transaction.
  const eventsAfterDirectionOne = store.getEvents().length;
  assert.throws(
    () => store.runInTransaction(() => {
      store.appendEvent({
        type: "probe.recorded",
        aggregateType: "probe",
        aggregateId: "task-1",
        aggregateVersion: null,
        payload: { probe: true },
        commandId: null,
        occurredAt: new Date().toISOString(),
      });
      store.insertRecord("verification", "v-ghost-2", {
        id: "v-ghost-2", taskId: "ghost-task", acceptanceId: "acceptance-1", acceptanceVersion: 1,
      });
    }),
    (error) => error.code === "ERR_SQLITE_ERROR" && /FOREIGN KEY/.test(error.message),
  );

  assert.equal(store.getEvents().length, eventsAfterDirectionOne, "an event written first is rolled back too");
  assert.ok(!store.getEvents().some((event) => event.type === "probe.recorded"));
  assert.throws(() => store.getVerification("v-ghost-2"), /verification not found/);
});

test("J: contract content edited inside the database fails closed on read", { skip }, (t) => {
  const db = projectFixture(t);
  const store = db.open();
  seedBase(store);
  store.close();

  // tamper with a separate connection, leaving the fingerprint row untouched
  const sqlite = createRequire(import.meta.url)("node:sqlite");
  const raw = new sqlite.DatabaseSync(db.file);
  const row = raw.prepare("SELECT body FROM acceptance_revisions WHERE id = ? AND version = ?").get("acceptance-1", 1);
  const body = JSON.parse(row.body);
  body.criteria = [{ id: "swapped", type: "BUILD", required: false }];
  raw.prepare("UPDATE acceptance_revisions SET body = ? WHERE id = ? AND version = ?")
    .run(JSON.stringify(body), "acceptance-1", 1);
  raw.close();

  const reopened = db.open();

  assert.throws(
    () => reopened.getAcceptance("acceptance-1", 1),
    (error) => error instanceof InvariantError && /without a new revision/.test(error.message),
  );
});

test("K: the lineage can be re-proven from durable rows after a reopen", { skip }, async (t) => {
  const db = projectFixture(t);
  const store = db.open();
  seedBase(store);
  const { controller } = controllerFor(store);
  const result = await controller.reconcileTask("task-1");
  store.close();

  const reopened = db.open();
  const evidence = reopened.getEvidence(result.evidence.id);

  // recording a *new* verification forces the store to re-prove
  // Task ← Run ← Attempt ← Evidence against the pinned acceptance revision,
  // using nothing but rows loaded from the database
  const reproof = reopened.recordVerification(createVerification({
    id: "verification-reproof",
    taskId: "task-1",
    acceptanceId: "acceptance-1",
    acceptanceVersion: 1,
    evidenceIds: [evidence.id],
    verdict: VerificationVerdict.PASS,
    revision: evidence.revision,
  }));
  assert.equal(reproof.verdict, VerificationVerdict.PASS);

  // and a forged one is still refused after the reload
  reopened.seedTask(createTask({
    id: "task-2", title: "other task", acceptanceId: "acceptance-1", acceptanceVersion: 1,
  }));
  assert.throws(
    () => reopened.recordVerification(createVerification({
      id: "verification-forged",
      taskId: "task-2",
      acceptanceId: "acceptance-1",
      acceptanceVersion: 1,
      evidenceIds: [evidence.id],
      verdict: VerificationVerdict.PASS,
      revision: evidence.revision,
    })),
    (error) => error instanceof InvariantError && /does not belong to task task-2/.test(error.message),
  );
});

test("L: reconciliation evidence keeps its lineage across a restart", { skip }, async (t) => {
  const db = projectFixture(t);
  const store = db.open();
  seedBase(store);
  const { controller, runtime } = controllerFor(store, { runtimeMode: "lost" });
  runtime.reconcileOutcome = ReconcileOutcome.CONFIRMED_COMPLETED;

  assert.equal((await controller.reconcileTask("task-1")).action, "RECONCILE");
  const recovered = await controller.reconcileTask("task-1");
  assert.equal(recovered.action, "ACCEPT");
  const blockedRunId = recovered.reconciliation.runId;
  const lostAttemptId = recovered.reconciliation.attemptId;
  store.close();

  const reopened = db.open();

  assert.equal(reopened.getTask("task-1").status, TaskStatus.ACCEPTED);
  assert.equal(reopened.getRun(blockedRunId).status, RunStatus.BLOCKED, "the blocked Run stays as history");
  assert.equal(reopened.getAttempt(lostAttemptId).status, AttemptStatus.LOST);
  assert.equal(reopened.getEvidence(recovered.evidence.id).runId, blockedRunId);
  assert.equal(reopened.getEvidence(recovered.evidence.id).attemptId, lostAttemptId);
  assert.equal(reopened.getEvidence(recovered.evidence.id).acceptanceVersion, 1);
  assert.equal(reopened.getVerification(recovered.verification.id).taskId, "task-1");
});

test("project: a Project row survives a restart", { skip }, (t) => {
  const db = projectFixture(t);
  const store = db.open();
  store.seedProject(createProject({ id: "project-1", name: "Persisted project", description: "durable root" }));
  store.close();

  const reopened = db.open();
  const project = reopened.getProject("project-1");
  assert.equal(project.name, "Persisted project");
  assert.equal(project.status, ProjectStatus.ACTIVE);
  assert.equal(project.version, 1);
  assert.ok(reopened.getEvents().some((event) => event.type === "project.created"));
});

test("restart: a parent acceptance written by one process is authoritative in another", { skip }, (t) => {
  const db = projectFixture(t);

  const written = runChild("parent", db.file);
  assert.equal(written.code, 0, `child writer failed: ${written.stderr}`);
  assert.ok(written.payload, "child writer produced no result");
  assert.equal(written.payload.action, "ACCEPT");
  assert.equal(written.payload.reason, "goal-accepted");
  assert.equal(written.payload.goalStatus, GoalStatus.ACCEPTED);
  assert.equal(written.payload.goalVersion, 2, "the decision moved the goal exactly once");
  assert.equal(written.payload.contractStatus, "PASSED");
  assert.match(written.payload.evidenceRevision, /^sha256:[0-9a-f]{64}$/);
  assert.ok(written.payload.acceptCommandId, "the acceptance recorded its command");

  // a genuinely separate process, started after the first one exited
  const readBack = runChild("parent-read", db.file, {
    ...written.payload.ids,
    acceptCommandId: written.payload.acceptCommandId,
  });
  assert.equal(readBack.code, 0, `child reader failed: ${readBack.stderr}`);
  const seen = readBack.payload;

  assert.equal(seen.goalStatus, GoalStatus.ACCEPTED);
  assert.equal(seen.contractStatus, "PASSED");
  assert.equal(seen.evidenceTargetType, "GOAL");
  assert.equal(seen.evidenceTargetId, "goal-1");
  assert.equal(seen.evidenceTaskId, null, "aggregate evidence has no task lineage");
  assert.equal(seen.evidenceRunId, null);
  assert.equal(
    seen.reobservedId,
    written.payload.evidenceId,
    "the same children produce the same observation id in another process",
  );
  assert.equal(seen.replayedVersion, 2, "a replayed acceptance command does not accept twice");
  assert.equal(seen.acceptedEvents, 1);
  assert.equal(seen.eventCount, written.payload.eventCount, "a reuse and a replay write nothing");
});

test("schema: a database file written before parent acceptance is refused at open", { skip }, (t) => {
  const db = projectFixture(t);
  const store = db.open();
  seedBase(store);
  store.close();

  // Rebuild `evidence` the way the earlier version wrote it: no target columns.
  const sqlite = createRequire(import.meta.url)("node:sqlite");
  const raw = new sqlite.DatabaseSync(db.file);
  raw.exec("ALTER TABLE evidence RENAME TO evidence_previous");
  raw.exec(
    "CREATE TABLE evidence (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, run_id TEXT NOT NULL, " +
      "attempt_id TEXT NOT NULL, body TEXT NOT NULL)",
  );
  raw.exec(
    "INSERT INTO evidence (id, task_id, run_id, attempt_id, body) " +
      "SELECT id, task_id, run_id, attempt_id, body FROM evidence_previous",
  );
  raw.exec("DROP TABLE evidence_previous");
  raw.close();

  // Refused loudly at open time — never later as "no such column: target_id",
  // and never by silently ignoring the rows that lack the new columns.
  assert.throws(() => db.open(), /older schema and cannot be opened by this version/);
});

test("restart: an approval granted in one process authorizes in another", { skip }, (t) => {
  const db = projectFixture(t);

  const written = runChild("approval", db.file);
  assert.equal(written.code, 0, `child writer failed: ${written.stderr}`);
  assert.ok(written.payload, "child writer produced no result");
  assert.equal(written.payload.status, "APPROVED");
  assert.equal(written.payload.version, 2);
  assert.equal(written.payload.decidedBy, "alice");
  assert.equal(written.payload.targetVersion, 1, "the request pinned the state it was made against");
  assert.equal(written.payload.boundCommandId, "C1");

  // a genuinely separate process, started after the first one exited
  const readBack = runChild("approval-read", db.file, written.payload.ids);
  assert.equal(readBack.code, 0, `child reader failed: ${readBack.stderr}`);
  const seen = readBack.payload;

  assert.equal(seen.status, "APPROVED");
  assert.equal(seen.decidedBy, "alice", "the decision is still attributable after a restart");
  assert.equal(seen.usableId, "approval-1", "the durable permission authorizes in the second process");
  assert.equal(seen.targetVersion, 1);
  assert.equal(seen.version, 2);
  assert.equal(seen.capabilityReason, "CAPABILITY_MISMATCH", "and the capability it binds survives the restart");

  // the decision command replays across the process boundary: no second decision
  assert.equal(seen.replayedVersion, 2);
  assert.equal(seen.replayedStatus, "APPROVED");
  assert.equal(seen.approvedEvents, 1);

  // and the permission is bound to the version it was granted for
  assert.equal(seen.taskVersion, 2);
  assert.equal(seen.staleReason, "STALE", "v1 was approved; v2 is not covered");
  assert.equal(
    seen.eventCount,
    written.payload.eventCount + 1,
    "reading, authorizing and replaying wrote nothing; only the task move did",
  );
});

test("schema: a file written before approvals existed gains the table and still opens", { skip }, (t) => {
  const db = projectFixture(t);
  const store = db.open();
  seedBase(store);
  store.close();

  // A database from before this round: the approvals table simply did not exist.
  const sqlite = createRequire(import.meta.url)("node:sqlite");
  const raw = new sqlite.DatabaseSync(db.file);
  raw.exec("DROP TABLE approvals");
  raw.close();

  // No schema guard is added for a NEW table: an old file opens, keeps its data,
  // and gains the table. Only an incompatible change to an EXISTING table would
  // justify refusing a file (see the evidence/verification guard).
  const reopened = db.open();
  assert.equal(reopened.getTask("task-1").title, "persisted task");
  reopened.requestApproval({
    id: "approval-1",
    targetType: "TASK",
    targetId: "task-1",
    action: "deploy",
    capability: "deploy.production",
    scope: "production",
    requestedBy: "requester-1",
  });
  reopened.decideApproval("approval-1", 1, { decision: "APPROVE", decidedBy: "alice" });
  assert.equal(reopened.getApproval("approval-1").decision.status, "APPROVED");
  assert.equal(reopened.assertApprovalUsable({
    approvalId: "approval-1",
    targetType: "TASK",
    targetId: "task-1",
    targetVersion: 1,
    action: "deploy",
    capability: "deploy.production",
    scope: "production",
  }).id, "approval-1");
});

test("concurrency: two connections cannot both decide one approval", { skip }, (t) => {
  const db = projectFixture(t);
  const writerA = db.open();
  const writerB = db.open();

  writerA.seedProject(createProject({ id: "project-1", name: "Approval concurrency" }));
  writerA.seedAcceptance(createAcceptance({ id: "acceptance-1", targetId: "task-1" }));
  writerA.seedTask(createTask({
    id: "task-1",
    title: "T1",
    acceptanceId: "acceptance-1",
    acceptanceVersion: 1,
  }));
  writerA.requestApproval({
    id: "approval-1",
    targetType: "TASK",
    targetId: "task-1",
    action: "deploy",
    capability: "deploy.production",
    scope: "production",
    requestedBy: "requester-1",
  });

  const readByB = writerB.getApproval("approval-1");
  assert.equal(readByB.version, 1);

  const approved = writerA.decideApproval("approval-1", 1, {
    decision: "APPROVE",
    decidedBy: "alice",
  }, { commandId: "cmd-a" });
  assert.equal(approved.version, 2);

  // the second approver still holds v1: one decision happens, not two
  assert.throws(
    () => writerB.decideApproval("approval-1", readByB.version, {
      decision: "REJECT",
      decidedBy: "bob",
    }, { commandId: "cmd-b" }),
    (error) => error instanceof ConflictError,
  );
  assert.equal(writerA.getApproval("approval-1").decision.decidedBy, "alice");
  assert.equal(writerA.getApproval("approval-1").version, 2);
  const types = writerA.getEvents().map((event) => event.type);
  assert.equal(types.filter((type) => type === "approval.approved").length, 1);
  assert.equal(types.filter((type) => type === "approval.rejected").length, 0, "the loser wrote no fact");

  // and the compare-and-set is enforced by SQL itself, not only in process
  assert.equal(
    writerB.updateRecord("approval", "approval-1", {
      ...approved,
      version: 9,
      decision: { status: "APPROVED", decidedBy: "bob", decidedAt: new Date().toISOString(), reason: null },
    }, 1),
    false,
  );
});

test("K: a PASS verification whose evidence goes STALE in the database cannot accept, after a restart", { skip }, (t) => {
  const db = projectFixture(t);
  const store = db.open();
  seedBase(store);
  store.createRun(createRun({ id: "run-1", taskId: "task-1", status: RunStatus.READY }));
  store.createAttempt(createAttempt({ id: "attempt-1", runId: "run-1", attemptNumber: 1 }));
  store.recordEvidence(createEvidence({
    id: "ev-1",
    taskId: "task-1",
    runId: "run-1",
    attemptId: "attempt-1",
    acceptanceId: "acceptance-1",
    acceptanceVersion: 1,
    revision: "rev-1",
  }));
  // legal at the time: CANDIDATE evidence and a PASS verdict on the pinned revision
  store.recordVerification(createVerification({
    id: "v-1",
    taskId: "task-1",
    acceptanceId: "acceptance-1",
    acceptanceVersion: 1,
    evidenceIds: ["ev-1"],
    verdict: VerificationVerdict.PASS,
    revision: "rev-1",
  }));
  store.close();

  // v0.1 has no evidence-lifecycle API yet, so the supersede is written straight
  // into the database — which is also the state a reloaded store could find.
  const sqlite = createRequire(import.meta.url)("node:sqlite");
  const raw = new sqlite.DatabaseSync(db.file);
  const row = raw.prepare("SELECT body FROM evidence WHERE id = ?").get("ev-1");
  const body = JSON.parse(row.body);
  body.status = "STALE";
  raw.prepare("UPDATE evidence SET body = ? WHERE id = ?").run(JSON.stringify(body), "ev-1");
  raw.close();

  const reopened = db.open();
  assert.equal(reopened.getEvidence("ev-1").status, "STALE");

  assert.throws(
    () => reopened.acceptTask("task-1", 1, { verificationId: "v-1" }),
    (error) => error instanceof InvariantError && /cannot support a PASS verification/.test(error.message),
  );
  assert.notEqual(reopened.getTask("task-1").status, TaskStatus.ACCEPTED);
});

test("hierarchy: project, milestone, goal and task links survive a reopen", { skip }, (t) => {
  const db = projectFixture(t);
  const store = db.open();
  store.seedProject(createProject({ id: "project-1", name: "Hierarchy project" }));
  store.seedMilestone(createMilestone({ id: "ms-1", projectId: "project-1", name: "M1", goalIds: ["goal-1"] }));
  store.seedGoal(createGoal({
    id: "goal-1", projectId: "project-1", milestoneId: "ms-1", title: "G1", taskIds: ["task-1"],
  }));
  store.seedTask(createTask({
    id: "task-1", goalId: "goal-1", title: "T1", acceptanceId: "acceptance-1", acceptanceVersion: 1,
  }));
  store.updateGoal("goal-1", 1, { status: GoalStatus.ACCEPTED }, { commandId: "cmd-goal" });
  store.close();

  const reopened = db.open();

  assert.equal(reopened.getProject("project-1").name, "Hierarchy project");
  assert.equal(reopened.getMilestone("ms-1").projectId, "project-1");
  assert.deepEqual(reopened.getMilestonesForProject("project-1").map((m) => m.id), ["ms-1"]);
  assert.deepEqual(reopened.getGoalsForMilestone("ms-1").map((g) => g.id), ["goal-1"]);
  assert.deepEqual(reopened.getGoalsForProject("project-1").map((g) => g.id), ["goal-1"]);
  assert.deepEqual(reopened.getTasksForGoal("goal-1").map((task) => task.id), ["task-1"]);
  assert.equal(reopened.getGoal("goal-1").status, GoalStatus.ACCEPTED);
  assert.equal(reopened.getGoal("goal-1").version, 2);
  assert.ok(reopened.getEvents().some((event) => event.type === "goal.accepted"));
});

test("concurrency: two writers on one database cannot silently overwrite each other", { skip }, (t) => {
  const db = projectFixture(t);
  const writerA = db.open();
  const writerB = db.open();
  seedBase(writerA);

  const readByA = writerA.getTask("task-1");
  const readByB = writerB.getTask("task-1");
  assert.equal(readByA.version, 1);
  assert.equal(readByB.version, 1);

  const updated = writerA.updateTask("task-1", readByA.version, { status: TaskStatus.IN_PROGRESS }, { commandId: "cmd-a" });
  assert.equal(updated.version, 2);

  assert.throws(
    () => writerB.updateTask("task-1", readByB.version, { status: TaskStatus.NEEDS_REVIEW }, { commandId: "cmd-b" }),
    (error) => error instanceof ConflictError,
  );
  assert.equal(writerA.getTask("task-1").status, TaskStatus.IN_PROGRESS, "writer A's state is intact");
  assert.equal(writerA.getTask("task-1").version, 2);

  // and the compare-and-set is enforced by SQL itself, not only by the in-process check
  assert.equal(writerB.updateRecord("task", "task-1", { ...updated, status: TaskStatus.ACCEPTED }, 1), false);
});

test("restart: state written by one process is authoritative in another process", { skip }, (t) => {
  const db = projectFixture(t);

  const written = runChild("write", db.file);
  assert.equal(written.code, 0, `child writer failed: ${written.stderr}`);
  assert.ok(written.payload, "child writer produced no result");
  assert.equal(written.payload.action, "ACCEPT");
  assert.equal(written.payload.taskStatus, TaskStatus.ACCEPTED);
  assert.equal(written.payload.task2AcceptanceVersion, 2);

  // a genuinely separate process, started after the first one exited
  const readBack = runChild("read", db.file, written.payload.ids);
  assert.equal(readBack.code, 0, `child reader failed: ${readBack.stderr}`);
  const seen = readBack.payload;

  assert.equal(seen.taskStatus, TaskStatus.ACCEPTED);
  assert.equal(seen.acceptanceVersion, 1, "the task is still pinned to v1");
  assert.equal(seen.acceptanceV1, "PASSED");
  assert.equal(seen.acceptanceV2, "PENDING");
  assert.equal(seen.task2AcceptanceVersion, 2, "a task pinned to v2 stays on v2");
  assert.equal(seen.runStatus, RunStatus.COMPLETED);
  assert.equal(seen.attemptStatus, AttemptStatus.COMPLETED);
  assert.equal(seen.evidenceRunId, written.payload.ids.runId);
  assert.equal(seen.evidenceAttemptId, written.payload.ids.attemptId);
  assert.equal(seen.verificationTaskId, "task-1");
  assert.equal(seen.reproof, VerificationVerdict.PASS, "lineage is re-provable in the second process");
  assert.ok(seen.eventCount >= written.payload.eventCount, "history grew, it was not rewritten");
});
