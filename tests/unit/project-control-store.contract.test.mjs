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
import { ACCEPTABLE_SOURCE_TASK_STATES, Collection } from "../../project-control/store.mjs";
import {
  SqliteStore,
  isSqliteAvailable,
  SQLITE_REQUIREMENT,
} from "../../project-control/sqlite-store.mjs";
import {
  ApprovalDecision,
  ApprovalStatus,
  ApprovalTargetType,
  AttemptStatus,
  ConflictError,
  EvidenceStatus,
  GoalStatus,
  InvariantError,
  MilestoneStatus,
  ProjectStatus,
  RunStatus,
  TaskStatus,
  VerificationVerdict,
  createAcceptance,
  createApproval,
  createAttempt,
  createEvidence,
  createGoal,
  createMilestone,
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

const sqliteSkip = isSqliteAvailable() ? false : `node:sqlite is unavailable: ${SQLITE_REQUIREMENT}`;

const ACCEPTABLE_SOURCE_STATES = [TaskStatus.READY, TaskStatus.IN_PROGRESS, TaskStatus.NEEDS_REVIEW];
const REFUSED_SOURCE_STATES = [
  TaskStatus.DRAFT,
  TaskStatus.BLOCKED,
  TaskStatus.ACCEPTED,
  TaskStatus.REJECTED,
  TaskStatus.CANCELLED,
];

/**
 * One acceptance attempt from a given starting task status.
 *
 * A COMPLETE legal chain (Run → Attempt → Evidence → PASS verification on the
 * pinned revision) is always present, so a refusal can only be about the task's
 * source state — never about missing or bad evidence.
 */
function acceptanceAttempt(store, { startStatus = TaskStatus.READY } = {}) {
  seedAcceptance(store);
  seedTask(store, { status: startStatus });
  seedChain(store);
  store.recordEvidence(evidenceFor({ id: "ev-1" }));
  store.recordVerification(verificationFor(["ev-1"], { id: "v-1" }));

  const eventsBefore = store.getEvents().length;
  const acceptanceUpdatedAtBefore = store.getAcceptance("acceptance-1", 1).updatedAt;

  let accepted = null;
  let error = null;
  try {
    accepted = store.acceptTask("task-1", 1, { verificationId: "v-1", commandId: "cmd-accept" });
  } catch (caught) {
    error = caught;
  }

  const task = store.getTask("task-1");
  return {
    attemptedFrom: startStatus,
    acceptedStatus: accepted?.status ?? null,
    acceptedVersion: accepted?.version ?? null,
    errorName: error?.name ?? null,
    errorCode: error?.code ?? null,
    errorMessage: error?.message ?? null,
    status: task.status,
    version: task.version,
    acceptanceStatus: store.getAcceptance("acceptance-1", 1).status,
    acceptanceUpdatedAtBefore,
    acceptanceUpdatedAtAfter: store.getAcceptance("acceptance-1", 1).updatedAt,
    eventsBefore,
    eventsNow: store.getEvents().length,
    acceptedEventCount: store.getEvents().filter((event) => event.type === "task.accepted").length,
    eventTypes: store.getEvents().map((event) => event.type),
  };
}

/**
 * Drives one full acceptance and then sends a SECOND, brand-new acceptance
 * command against the already accepted task. Returns the observable facts only,
 * so both backends can be compared field by field.
 */
function acceptScenario(store) {
  seedAcceptance(store);
  seedTask(store);
  seedChain(store);
  store.recordEvidence(evidenceFor({ id: "ev-1" }));
  store.recordVerification(verificationFor(["ev-1"], { id: "v-1" }));

  const accepted = store.acceptTask("task-1", 1, { verificationId: "v-1", commandId: "cmd-accept" });
  const eventsAfterFirst = store.getEvents().length;
  const acceptanceUpdatedAtBefore = store.getAcceptance("acceptance-1", 1).updatedAt;

  let error = null;
  try {
    store.acceptTask("task-1", accepted.version, { verificationId: "v-1", commandId: "cmd-accept-again" });
  } catch (caught) {
    error = caught;
  }

  const task = store.getTask("task-1");
  return {
    firstStatus: accepted.status,
    firstVersion: accepted.version,
    errorName: error?.name ?? null,
    errorCode: error?.code ?? null,
    errorMessage: error?.message ?? null,
    status: task.status,
    version: task.version,
    acceptanceStatus: store.getAcceptance("acceptance-1", 1).status,
    acceptanceUpdatedAtBefore,
    acceptanceUpdatedAtAfter: store.getAcceptance("acceptance-1", 1).updatedAt,
    eventsAfterFirst,
    eventsNow: store.getEvents().length,
    acceptedEventCount: store.getEvents().filter((event) => event.type === "task.accepted").length,
    eventTypes: store.getEvents().map((event) => event.type),
  };
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

  test(`${name}: a NEW acceptance command against an ACCEPTED task is rejected`, { skip }, (t) => {
    // called on the Store directly — no Controller in the path
    const facts = acceptScenario(backend.make(t));

    // A: the first acceptance succeeded, the second is refused
    assert.equal(facts.firstStatus, TaskStatus.ACCEPTED);
    assert.equal(facts.firstVersion, 2);
    assert.equal(facts.errorName, "InvariantError");
    assert.equal(facts.errorCode, "INVARIANT_VIOLATION");
    assert.match(facts.errorMessage, /already ACCEPTED/);
    // B: the task is still accepted
    assert.equal(facts.status, TaskStatus.ACCEPTED);
    // C: the version did not move
    assert.equal(facts.version, 2);
    // D: no second domain event
    assert.equal(facts.eventsNow, facts.eventsAfterFirst);
    assert.equal(facts.acceptedEventCount, 1);
    // E: the acceptance decision was not written a second time
    assert.equal(facts.acceptanceStatus, "PASSED");
    assert.equal(facts.acceptanceUpdatedAtAfter, facts.acceptanceUpdatedAtBefore);
  });

  test(`${name}: replaying the ORIGINAL acceptance command still returns the accepted task`, { skip }, (t) => {
    const store = backend.make(t);
    seedAcceptance(store);
    seedTask(store);
    seedChain(store);
    store.recordEvidence(evidenceFor({ id: "ev-1" }));
    store.recordVerification(verificationFor(["ev-1"], { id: "v-1" }));
    const first = store.acceptTask("task-1", 1, { verificationId: "v-1", commandId: "cmd-accept" });
    const events = store.getEvents().length;

    // The SAME commandId is recognized before both the version check and the
    // terminal guard, so a replay stays idempotent rather than an error.
    const replay = store.acceptTask("task-1", 1, { verificationId: "v-1", commandId: "cmd-accept" });

    assert.equal(replay.status, TaskStatus.ACCEPTED);
    assert.equal(replay.version, first.version);
    assert.equal(store.getTask("task-1").status, TaskStatus.ACCEPTED);
    assert.equal(store.getTask("task-1").version, 2);
    assert.equal(store.getEvents().length, events, "no duplicate event");
  });

  test(`${name}: refuses acceptance from every non-acceptable task state`, { skip }, (t) => {
    for (const startStatus of REFUSED_SOURCE_STATES) {
      const facts = acceptanceAttempt(backend.make(t), { startStatus });

      // illegal source state -> InvariantError, never a new acceptance
      assert.equal(facts.errorName, "InvariantError", `${startStatus} must be refused`);
      assert.equal(facts.errorCode, "INVARIANT_VIOLATION", startStatus);
      assert.equal(facts.acceptedStatus, null, `${startStatus}: no acceptance result`);
      assert.match(facts.errorMessage, new RegExp(startStatus), `${startStatus}: the message names the state`);

      // J: the refused command changed nothing at all
      assert.equal(facts.status, startStatus, `${startStatus}: task status unchanged`);
      assert.equal(facts.version, 1, `${startStatus}: task version unchanged`);
      assert.equal(facts.acceptanceStatus, "PENDING", `${startStatus}: acceptance decision untouched`);
      assert.equal(
        facts.acceptanceUpdatedAtAfter,
        facts.acceptanceUpdatedAtBefore,
        `${startStatus}: acceptance row was not rewritten`,
      );
      assert.equal(facts.eventsNow, facts.eventsBefore, `${startStatus}: no event appended`);
      assert.equal(facts.acceptedEventCount, 0, `${startStatus}: no task.accepted event`);
    }
  });

  test(`${name}: accepts normally from every acceptable source state`, { skip }, (t) => {
    for (const startStatus of ACCEPTABLE_SOURCE_STATES) {
      const facts = acceptanceAttempt(backend.make(t), { startStatus });

      assert.equal(facts.errorName, null, `${startStatus} must be accepted: ${facts.errorMessage}`);
      assert.equal(facts.acceptedStatus, TaskStatus.ACCEPTED, startStatus);
      assert.equal(facts.acceptedVersion, 2, startStatus);
      assert.equal(facts.status, TaskStatus.ACCEPTED, startStatus);
      assert.equal(facts.version, 2, startStatus);
      assert.equal(facts.acceptanceStatus, "PASSED", startStatus);
      assert.equal(facts.acceptedEventCount, 1, startStatus);
      assert.equal(facts.eventsNow, facts.eventsBefore + 1, `${startStatus}: exactly one event appended`);
    }
  });

  test(`${name}: hierarchy aggregates keep version, CAS, event identity and command idempotency`, { skip }, (t) => {
    const store = backend.make(t);
    const count = (type) => store.getEvents().filter((event) => event.type === type).length;

    store.seedProject(createProject({ id: "project-1", name: "Hierarchy" }));
    store.seedMilestone(createMilestone({ id: "ms-1", projectId: "project-1", name: "M1", goalIds: ["goal-1"] }));
    store.seedGoal(createGoal({
      id: "goal-1", projectId: "project-1", milestoneId: "ms-1", title: "G1", taskIds: ["task-1"],
    }));
    store.seedTask(createTask({
      id: "task-1", goalId: "goal-1", title: "T1", acceptanceId: "acceptance-1", acceptanceVersion: 1,
    }));

    // parent links are the query surface, read from the child's explicit field
    assert.deepEqual(store.getMilestonesForProject("project-1").map((m) => m.id), ["ms-1"]);
    assert.deepEqual(store.getGoalsForMilestone("ms-1").map((g) => g.id), ["goal-1"]);
    assert.deepEqual(store.getGoalsForProject("project-1").map((g) => g.id), ["goal-1"]);
    assert.deepEqual(store.getTasksForGoal("goal-1").map((task) => task.id), ["task-1"]);
    assert.deepEqual(store.getMilestonesForProject("project-2"), []);

    // versioned mutation with command identity: a replay is not a second mutation
    const first = store.updateGoal("goal-1", 1, { status: GoalStatus.IN_PROGRESS }, { commandId: "cmd-goal" });
    const replay = store.updateGoal("goal-1", 1, { status: GoalStatus.IN_PROGRESS }, { commandId: "cmd-goal" });
    assert.equal(first.version, 2);
    assert.equal(replay.version, 2);
    assert.equal(store.getGoal("goal-1").version, 2);
    assert.equal(count("goal.updated"), 1);

    // a stale writer conflicts instead of overwriting
    assert.throws(
      () => store.updateGoal("goal-1", 1, { status: GoalStatus.READY }, { commandId: "cmd-stale" }),
      (error) => error instanceof ConflictError,
    );

    // a scope-level decision is recorded under its own event name
    store.updateGoal("goal-1", 2, { status: GoalStatus.ACCEPTED }, { commandId: "cmd-accept" });
    assert.equal(count("goal.accepted"), 1);
    store.updateMilestone("ms-1", 1, { status: MilestoneStatus.COMPLETED }, { commandId: "cmd-ms" });
    assert.equal(count("milestone.completed"), 1);
    store.updateProject("project-1", 1, { status: ProjectStatus.COMPLETED }, { commandId: "cmd-pr" });
    assert.equal(count("project.completed"), 1);

    // …with the right aggregate identity and version on the event
    const accepted = store.getEvents().find((event) => event.type === "goal.accepted");
    assert.equal(accepted.aggregateType, "goal");
    assert.equal(accepted.aggregateId, "goal-1");
    assert.equal(accepted.aggregateVersion, 3);
    assert.equal(accepted.commandId, "cmd-accept");
  });

  test(`${name}: child parent links are the relationship fact and dangling links fail closed`, { skip }, (t) => {
    const store = backend.make(t);
    store.seedProject(createProject({ id: "project-1", name: "P" }));

    // E/F: a milestone must point at an existing project
    assert.throws(
      () => store.seedMilestone(createMilestone({ id: "ms-x", projectId: "ghost-project", name: "M" })),
      (error) => error instanceof InvariantError && /references project ghost-project/.test(error.message),
    );
    store.seedMilestone(createMilestone({ id: "ms-1", projectId: "project-1", name: "M1", goalIds: [] }));

    // C/D: a goal must point at an existing milestone
    assert.throws(
      () => store.seedGoal(createGoal({ id: "goal-x", milestoneId: "ghost-ms", title: "G" })),
      (error) => error instanceof InvariantError && /references milestone ghost-ms/.test(error.message),
    );
    store.seedGoal(createGoal({ id: "goal-1", milestoneId: "ms-1", title: "G1", taskIds: [] }));

    // A/B: a task must point at an existing goal
    assert.throws(
      () => store.seedTask(createTask({
        id: "task-x", goalId: "ghost-goal", title: "T", acceptanceId: "acceptance-1", acceptanceVersion: 1,
      })),
      (error) => error instanceof InvariantError && /references goal ghost-goal/.test(error.message),
    );
    store.seedTask(createTask({
      id: "task-1", goalId: "goal-1", title: "T1", acceptanceId: "acceptance-1", acceptanceVersion: 1,
    }));

    // a refused seed wrote nothing at all
    assert.throws(() => store.getMilestone("ms-x"), /milestone not found/);
    assert.throws(() => store.getGoal("goal-x"), /goal not found/);
    assert.throws(() => store.getTask("task-x"), /task not found/);

    // re-parenting is validated exactly like a seed, and writes nothing on failure
    assert.throws(
      () => store.updateGoal("goal-1", 1, { milestoneId: "ghost-ms" }, { commandId: "cmd-move" }),
      (error) => error instanceof InvariantError && /references milestone ghost-ms/.test(error.message),
    );
    assert.equal(store.getGoal("goal-1").milestoneId, "ms-1", "a refused re-parent left the goal untouched");
    assert.equal(store.getGoal("goal-1").version, 1, "a refused re-parent wrote nothing");

    // an explicitly unattached child (null link) is always allowed
    store.seedGoal(createGoal({ id: "goal-free", projectId: "project-1", milestoneId: null, title: "G2" }));
    store.seedTask(createTask({
      id: "task-free", goalId: null, title: "T2", acceptanceId: "acceptance-1", acceptanceVersion: 1,
    }));
    assert.equal(store.getGoal("goal-free").milestoneId, null);
    assert.equal(store.getTask("task-free").goalId, null);

    // membership follows the child links, never the derived lists
    assert.deepEqual(store.getTasksForGoal("goal-1").map((task) => task.id), ["task-1"]);
    assert.deepEqual(store.getGoalsForMilestone("ms-1").map((goal) => goal.id), ["goal-1"]);
    assert.deepEqual(store.getMilestonesForProject("project-1").map((milestone) => milestone.id), ["ms-1"]);
    assert.deepEqual(store.getTasksForGoal("goal-free"), []);
  });

  test(`${name}: goal project hierarchy consistency is enforced on seed and re-parent`, { skip }, (t) => {
    const store = backend.make(t);
    const count = (type) => store.getEvents().filter((event) => event.type === type).length;

    store.seedProject(createProject({ id: "project-A", name: "A" }));
    store.seedProject(createProject({ id: "project-B", name: "B" }));
    store.seedMilestone(createMilestone({ id: "ms-A", projectId: "project-A", name: "MS-A" }));
    store.seedMilestone(createMilestone({ id: "ms-B", projectId: "project-B", name: "MS-B" }));

    // A: a direct Goal declares an existing project
    store.seedGoal(createGoal({ id: "goal-direct", projectId: "project-A", milestoneId: null, title: "direct" }));
    // C/I: a nested Goal whose project matches its milestone's project
    store.seedGoal(createGoal({ id: "goal-nested", projectId: "project-A", milestoneId: "ms-A", title: "nested" }));

    // H/I: both are visible through their declared project; the nested one also
    // through its milestone
    assert.deepEqual(
      store.getGoalsForProject("project-A").map((goal) => goal.id).sort(),
      ["goal-direct", "goal-nested"],
    );
    assert.deepEqual(store.getGoalsForMilestone("ms-A").map((goal) => goal.id), ["goal-nested"]);
    assert.deepEqual(store.getGoalsForProject("project-B"), []);

    // B: a dangling project is refused and nothing is stored
    assert.throws(
      () => store.seedGoal(createGoal({ id: "goal-ghost-project", projectId: "ghost-project", title: "x" })),
      (error) => error instanceof InvariantError && /references project ghost-project/.test(error.message),
    );
    assert.equal(store.getRecord("goal", "goal-ghost-project"), null, "a refused seed stored nothing");

    // D: a dangling milestone is refused
    assert.throws(
      () => store.seedGoal(createGoal({ id: "goal-ghost-ms", projectId: "project-A", milestoneId: "ghost-ms", title: "x" })),
      (error) => error instanceof InvariantError && /references milestone ghost-ms/.test(error.message),
    );
    assert.equal(store.getRecord("goal", "goal-ghost-ms"), null);

    // E: a Goal may not contradict the project its milestone belongs to
    assert.throws(
      () => store.seedGoal(createGoal({ id: "goal-mismatch", projectId: "project-A", milestoneId: "ms-B", title: "x" })),
      (error) =>
        error instanceof InvariantError &&
        /declares project project-A but its milestone ms-B belongs to project project-B/.test(error.message),
    );
    assert.equal(store.getRecord("goal", "goal-mismatch"), null);

    // F: re-parenting the project away from the milestone's project is refused
    const before = store.getGoal("goal-nested");
    assert.throws(
      () => store.updateGoal("goal-nested", before.version, { projectId: "project-B" }, { commandId: "cmd-f" }),
      (error) =>
        error instanceof InvariantError &&
        /declares project project-B but its milestone ms-A belongs to project project-A/.test(error.message),
    );
    assert.equal(store.getGoal("goal-nested").projectId, "project-A", "the refused re-parent changed nothing");
    assert.equal(store.getGoal("goal-nested").version, before.version, "the refused re-parent wrote nothing");

    // G: re-parenting onto a milestone of another project is refused too
    assert.throws(
      () => store.updateGoal("goal-nested", before.version, { milestoneId: "ms-B" }, { commandId: "cmd-g" }),
      (error) =>
        error instanceof InvariantError &&
        /declares project project-A but its milestone ms-B belongs to project project-B/.test(error.message),
    );
    assert.equal(store.getGoal("goal-nested").milestoneId, "ms-A");
    assert.equal(store.getGoal("goal-nested").version, before.version);
    assert.equal(count("goal.updated"), 0, "no goal.updated from a refused re-parent");

    // J: the child link is still the membership fact, derived list or not
    assert.deepEqual(store.getGoal("goal-nested").taskIds, []);
    store.seedTask(createTask({
      id: "task-1", projectId: "project-A", goalId: "goal-nested", title: "T", acceptanceId: "acceptance-1", acceptanceVersion: 1,
    }));
    assert.deepEqual(store.getTasksForGoal("goal-nested").map((task) => task.id), ["task-1"]);

    // and a legal re-parent still works: moving a direct goal into its own project's milestone
    const moved = store.updateGoal("goal-direct", 1, { milestoneId: "ms-A" }, { commandId: "cmd-move-ok" });
    assert.equal(moved.milestoneId, "ms-A");
    assert.equal(moved.projectId, "project-A");
    assert.equal(moved.version, 2);
    assert.equal(count("goal.updated"), 1);
  });
}

test("both backends enforce goal project hierarchy consistency identically", { skip: sqliteSkip }, (t) => {
  const run = (store) => {
    const outcomes = [];
    const attempt = (label, fn) => {
      try {
        fn();
        outcomes.push([label, "ok"]);
      } catch (error) {
        outcomes.push([label, error.name, error.code, error.message]);
      }
    };

    store.seedProject(createProject({ id: "project-A", name: "A" }));
    store.seedProject(createProject({ id: "project-B", name: "B" }));
    store.seedMilestone(createMilestone({ id: "ms-A", projectId: "project-A", name: "MS-A" }));
    store.seedMilestone(createMilestone({ id: "ms-B", projectId: "project-B", name: "MS-B" }));

    attempt("direct goal", () => store.seedGoal(createGoal({ id: "g-direct", projectId: "project-A", title: "d" })));
    attempt("nested goal", () => store.seedGoal(createGoal({
      id: "g-nested", projectId: "project-A", milestoneId: "ms-A", title: "n",
    })));
    attempt("dangling project", () => store.seedGoal(createGoal({ id: "g-p", projectId: "ghost", title: "x" })));
    attempt("dangling milestone", () => store.seedGoal(createGoal({
      id: "g-m", projectId: "project-A", milestoneId: "ghost", title: "x",
    })));
    attempt("project mismatch", () => store.seedGoal(createGoal({
      id: "g-x", projectId: "project-A", milestoneId: "ms-B", title: "x",
    })));
    attempt("re-parent project", () => store.updateGoal("g-nested", 1, { projectId: "project-B" }, { commandId: "c1" }));
    attempt("re-parent milestone", () => store.updateGoal("g-nested", 1, { milestoneId: "ms-B" }, { commandId: "c2" }));

    return {
      outcomes,
      stored: ["g-direct", "g-nested", "g-p", "g-m", "g-x"].map((id) => {
        const goal = store.getRecord("goal", id);
        return goal ? [goal.id, goal.projectId, goal.milestoneId, goal.version] : [id, null];
      }),
      byProject: store.getGoalsForProject("project-A").map((goal) => [goal.id, goal.version]).sort(),
      events: store.getEvents().map(({ occurredAt, ...rest }) => rest),
    };
  };

  const memory = new MemoryStore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-goal-parity-"));
  const sqlite = new SqliteStore(path.join(dir, "project-control.db"));
  t.after(() => {
    try {
      sqlite.close();
    } catch {
      // already closed
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const fromMemory = run(memory);
  const fromSqlite = run(sqlite);

  assert.deepEqual(fromSqlite, fromMemory);
  // …and the shared outcome really is the enforcing one
  assert.deepEqual(fromMemory.outcomes.map((entry) => entry[1]), [
    "ok",
    "ok",
    "InvariantError",
    "InvariantError",
    "InvariantError",
    "InvariantError",
    "InvariantError",
  ]);
});

test("both backends reject duplicate acceptance with identical semantics", { skip: sqliteSkip }, (t) => {
  const memory = new MemoryStore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-contract-dup-"));
  const sqlite = new SqliteStore(path.join(dir, "project-control.db"));
  t.after(() => {
    try {
      sqlite.close();
    } catch {
      // already closed
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const stableFields = ({ acceptanceUpdatedAtBefore, acceptanceUpdatedAtAfter, ...rest }) => rest;

  const fromMemory = stableFields(acceptScenario(memory));
  // parity is not enough: the contract itself must be the rejecting one
  assert.equal(fromMemory.errorName, "InvariantError");
  assert.equal(fromMemory.status, TaskStatus.ACCEPTED);
  assert.equal(fromMemory.version, 2);
  assert.equal(fromMemory.acceptedEventCount, 1);
  assert.deepEqual(stableFields(acceptScenario(sqlite)), fromMemory);
});

test("the acceptable-source-state whitelist is exactly the documented set", () => {
  assert.deepEqual([...ACCEPTABLE_SOURCE_TASK_STATES], ACCEPTABLE_SOURCE_STATES);
});

test("both backends agree on every acceptance source state", { skip: sqliteSkip }, () => {
  const stableFields = ({ acceptanceUpdatedAtBefore, acceptanceUpdatedAtAfter, ...rest }) => rest;

  for (const startStatus of [...ACCEPTABLE_SOURCE_STATES, ...REFUSED_SOURCE_STATES]) {
    const sqlite = new SqliteStore(":memory:");
    let fromSqlite;
    try {
      fromSqlite = stableFields(acceptanceAttempt(sqlite, { startStatus }));
    } finally {
      sqlite.close();
    }
    const fromMemory = stableFields(acceptanceAttempt(new MemoryStore(), { startStatus }));

    assert.deepEqual(fromSqlite, fromMemory, `backends disagree for ${startStatus}`);

    // parity is not enough: the contract must be the one refusing illegal states
    assert.equal(
      fromMemory.errorName,
      REFUSED_SOURCE_STATES.includes(startStatus) ? "InvariantError" : null,
      `${startStatus}: both backends must apply the same rule`,
    );
  }
});

// ── the approval collection, as a backend contract ───────────────────────────

/**
 * An Approval is a first-class collection, so a future backend must persist it
 * with the same primitives and the same compare-and-set as everything else. The
 * projected columns are the backend's business; what a backend must NOT do is
 * enforce approval rules of its own — the shared semantics own those.
 */
test("both backends persist the approval collection the same way", { skip: sqliteSkip }, (t) => {
  const run = (store) => {
    const inserted = store.insertRecord(Collection.APPROVAL, "approval-1", { id: "approval-1", version: 1 });
    const duplicate = store.insertRecord(Collection.APPROVAL, "approval-1", { id: "approval-1", version: 9 });
    const missing = store.getRecord(Collection.APPROVAL, "approval-404");
    const staleCas = store.updateRecord(Collection.APPROVAL, "approval-1", { id: "approval-1", version: 2 }, 99);
    const cas = store.updateRecord(Collection.APPROVAL, "approval-1", { id: "approval-1", version: 2 }, 1);
    const byId = store.recordsMatching(Collection.APPROVAL, "id", "approval-1").map((record) => record.id);
    const byUnknown = store.recordsMatching(Collection.APPROVAL, "id", "approval-9");
    return {
      inserted,
      duplicate,
      missing,
      staleCas,
      cas,
      version: store.getRecord(Collection.APPROVAL, "approval-1").version,
      all: store.allRecords(Collection.APPROVAL).map((record) => record.id),
      byId,
      byUnknown,
    };
  };

  const memory = new MemoryStore();
  const sqlite = new SqliteStore(":memory:");
  let fromSqlite;
  try {
    fromSqlite = run(sqlite);
  } finally {
    sqlite.close();
  }
  const fromMemory = run(memory);

  assert.deepEqual(fromSqlite, fromMemory);
  assert.deepEqual(fromMemory, {
    inserted: true,
    duplicate: false,
    missing: null,
    staleCas: false,
    cas: true,
    version: 2,
    all: ["approval-1"],
    byId: ["approval-1"],
    byUnknown: [],
  });
});

test("approval lookups resolve from the record, identically on both backends", { skip: sqliteSkip }, () => {
  const seed = (store) => {
    store.seedProject(createProject({ id: "project-1", name: "Contract project" }));
    seedAcceptance(store);
    seedTask(store);
    store.seedGoal(createGoal({ id: "goal-1", projectId: "project-1", title: "G1" }));
    store.requestApproval({
      id: "approval-live",
      targetType: ApprovalTargetType.TASK,
      targetId: "task-1",
      action: "deploy",
      capability: "deploy.production",
      scope: "production",
      requestedBy: "requester-1",
    });
    store.decideApproval("approval-live", 1, { decision: ApprovalDecision.APPROVE, decidedBy: "alice" });
    // a HISTORICAL grant: it was approved once, and its deadline has since passed
    store.seedApproval({
      ...createApproval({
        id: "approval-old",
        targetType: ApprovalTargetType.TASK,
        targetId: "task-1",
        targetVersion: 1,
        action: "deploy",
        capability: "deploy.production",
        scope: "production",
        requestedBy: "requester-1",
        expiresAt: "2020-01-01T00:00:00.000Z",
      }),
      decision: {
        status: ApprovalStatus.APPROVED,
        decidedBy: "alice",
        decidedAt: "2019-12-31T00:00:00.000Z",
        reason: null,
      },
    });
    store.requestApproval({
      id: "approval-goal",
      targetType: ApprovalTargetType.GOAL,
      targetId: "goal-1",
      action: "archive",
      capability: "goal.archive",
      scope: "default",
      requestedBy: "requester-1",
    });
    return {
      aboutTask: store.getApprovalsForTarget(ApprovalTargetType.TASK, "task-1").map((record) => record.id),
      aboutGoal: store.getApprovalsForTarget(ApprovalTargetType.GOAL, "goal-1").map((record) => record.id),
      approvedNow: store.getApprovalsInStatus(ApprovalStatus.APPROVED).map((record) => record.id),
      // the deadline already passed, so it is not APPROVED "now" even though that
      // is the status stored in the record
      storedStatus: store.getApproval("approval-old").decision.status,
      requested: store.getApprovalsInStatus(ApprovalStatus.PENDING).map((record) => record.id),
    };
  };

  const memory = new MemoryStore();
  const sqlite = new SqliteStore(":memory:");
  let fromSqlite;
  try {
    fromSqlite = seed(sqlite);
  } finally {
    sqlite.close();
  }
  const fromMemory = seed(memory);

  assert.deepEqual(fromSqlite, fromMemory);
  assert.deepEqual(fromMemory, {
    aboutTask: ["approval-live", "approval-old"],
    aboutGoal: ["approval-goal"],
    approvedNow: ["approval-live"],
    storedStatus: ApprovalStatus.APPROVED,
    requested: ["approval-goal"],
  });
});
