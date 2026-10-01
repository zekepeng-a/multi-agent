// Parent acceptance: Goal and Milestone acceptance against their OWN contract.
//
// A parent with an Acceptance Contract may not be accepted by aggregation. Child
// completion is the INPUT to acceptance; the decision itself is
//
//   contract revision → Aggregate Evidence → Verification → Acceptance
//
// exactly as it is for a Task, one level up. This file proves that flow against
// EVERY backend, because the rules live in the shared store semantics — the
// backends only store.
//
// Two properties are load-bearing and are tested from several directions:
//
//   Current Reality > Historical Evidence   evidence that describes a state the
//                                           aggregate has left cannot accept it
//   One observation, one verdict            the same snapshot is reused rather
//                                           than re-recorded or re-asked
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Collection } from "../../project-control/store.mjs";
import { MemoryStore } from "../../project-control/memory-store.mjs";
import {
  SqliteStore,
  isSqliteAvailable,
  SQLITE_REQUIREMENT,
} from "../../project-control/sqlite-store.mjs";
import { Controller } from "../../project-control/controller.mjs";
import { FakeRuntime } from "../../project-control/fake-runtime.mjs";
import { FakeVerifier } from "../../project-control/fake-verifier.mjs";
import {
  AcceptanceTargetType,
  EvidenceStatus,
  GoalStatus,
  MilestoneStatus,
  ProjectStatus,
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
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-parent-"));
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

// ── shared fixtures (backend-agnostic) ───────────────────────────────────────

const GOAL_CRITERIA = [{ id: "aggregate", type: "AGGREGATE", required: true }];

/** Seeds one contract revision and returns the pin a parent has to carry. */
function seedContract(store, { id, targetType, targetId, version = 1 }) {
  store.seedAcceptance(createAcceptance({
    id,
    targetType,
    targetId,
    version,
    criteria: structuredClone(GOAL_CRITERIA),
  }));
  return { acceptanceId: id, acceptanceVersion: version };
}

/**
 * Project → Milestone → Goal → Tasks.
 *
 * Contracts are seeded BEFORE the record that pins one, because a pin that
 * cannot be resolved, or that is about another aggregate, is refused at seed
 * time — a rule this file tests directly.
 */
function seedWorld(store, {
  taskStatuses = [TaskStatus.ACCEPTED],
  goalStatus = GoalStatus.IN_PROGRESS,
  milestoneStatus = MilestoneStatus.READY,
  goalContract = null,
  milestoneContract = null,
  taskContract = null,
  goalTaskIds = [],
} = {}) {
  const taskIds = taskStatuses.map((_status, index) => `task-${index + 1}`);
  store.seedProject(createProject({ id: "project-1", name: "Parent acceptance" }));
  if (taskContract) {
    seedContract(store, {
      ...taskContract,
      targetType: AcceptanceTargetType.TASK,
      targetId: taskContract.targetId ?? taskIds[0],
    });
  }
  const milestonePin = milestoneContract
    ? seedContract(store, {
        ...milestoneContract,
        targetType: AcceptanceTargetType.MILESTONE,
        targetId: "ms-1",
      })
    : {};
  const goalPin = goalContract
    ? seedContract(store, { ...goalContract, targetType: AcceptanceTargetType.GOAL, targetId: "goal-1" })
    : {};
  store.seedMilestone(createMilestone({
    id: "ms-1",
    projectId: "project-1",
    name: "Milestone 1",
    status: milestoneStatus,
    ...milestonePin,
  }));
  store.seedGoal(createGoal({
    id: "goal-1",
    projectId: "project-1",
    milestoneId: "ms-1",
    title: "Goal 1",
    status: goalStatus,
    taskIds: goalTaskIds,
    ...goalPin,
  }));
  taskStatuses.forEach((status, index) => {
    store.seedTask(createTask({
      id: taskIds[index],
      goalId: "goal-1",
      title: taskIds[index],
      acceptanceId: "acceptance-1",
      acceptanceVersion: 1,
      status,
    }));
  });
  return { taskIds };
}

/** A complete TASK-side chain, so a task verification can be compared with a parent one. */
function seedTaskChain(store, { taskId = "task-1" } = {}) {
  seedContract(store, { id: "acceptance-1", targetType: AcceptanceTargetType.TASK, targetId: taskId });
  store.createRun(createRun({ id: "run-1", taskId, status: RunStatus.READY }));
  store.createAttempt(createAttempt({ id: "attempt-1", runId: "run-1", attemptNumber: 1 }));
  store.recordEvidence(createEvidence({
    id: "ev-task",
    targetType: AcceptanceTargetType.TASK,
    taskId,
    runId: "run-1",
    attemptId: "attempt-1",
    acceptanceId: "acceptance-1",
    acceptanceVersion: 1,
    revision: "rev-task",
  }));
  return store.recordVerification(createVerification({
    id: "v-task",
    targetType: AcceptanceTargetType.TASK,
    taskId,
    acceptanceId: "acceptance-1",
    acceptanceVersion: 1,
    evidenceIds: ["ev-task"],
    verdict: VerificationVerdict.PASS,
    revision: "rev-task",
  }));
}

function makeController(store, { verdict = VerificationVerdict.PASS } = {}) {
  let n = 0;
  const runtime = new FakeRuntime({ mode: "success" });
  const verifier = new FakeVerifier({ verdict });
  const controller = new Controller({
    store,
    runtime,
    verifier,
    idFactory: (prefix) => `${prefix}-${++n}`,
  });
  return { controller, runtime, verifier };
}

function eventTypes(store) {
  return store.getEvents().map((event) => event.type);
}

function countEvents(store, type) {
  return eventTypes(store).filter((each) => each === type).length;
}

/** A GOAL verification for aggregate evidence, on the revision the goal pins. */
function goalVerificationFor(evidence, over = {}) {
  return createVerification({
    id: "v-goal",
    targetType: AcceptanceTargetType.GOAL,
    targetId: "goal-1",
    acceptanceId: "acceptance-goal",
    acceptanceVersion: 1,
    evidenceIds: [evidence.id],
    verdict: VerificationVerdict.PASS,
    revision: evidence.revision,
    ...over,
  });
}

const withoutTimestamps = ({ createdAt, updatedAt, ...rest }) => rest;

for (const backend of BACKENDS) {
  const { name, skip } = backend;
  const label = (title) => `${name}: ${title}`;

  // ── the pin is a fact about THIS parent ────────────────────────────────────

  test(label("A a Goal pinning a MILESTONE contract is refused at seed time"), { skip }, (t) => {
    const store = backend.make(t);
    store.seedProject(createProject({ id: "project-1", name: "Parent acceptance" }));
    seedContract(store, {
      id: "acceptance-ms",
      targetType: AcceptanceTargetType.MILESTONE,
      targetId: "ms-1",
    });

    assert.throws(
      () => store.seedGoal(createGoal({
        id: "goal-1",
        projectId: "project-1",
        title: "Goal 1",
        acceptanceId: "acceptance-ms",
        acceptanceVersion: 1,
      })),
      /which targets MILESTONE ms-1/,
    );
    // nothing half-written: the goal does not exist at all
    assert.throws(() => store.getGoal("goal-1"), /goal not found/);
    assert.equal(countEvents(store, "goal.created"), 0);
  });

  test(label("B a Goal pinning another goal's contract is refused at seed time"), { skip }, (t) => {
    const store = backend.make(t);
    store.seedProject(createProject({ id: "project-1", name: "Parent acceptance" }));
    seedContract(store, { id: "acceptance-other", targetType: AcceptanceTargetType.GOAL, targetId: "goal-9" });

    assert.throws(
      () => store.seedGoal(createGoal({
        id: "goal-1",
        projectId: "project-1",
        title: "Goal 1",
        acceptanceId: "acceptance-other",
        acceptanceVersion: 1,
      })),
      /which targets GOAL goal-9/,
    );
    assert.throws(() => store.getGoal("goal-1"), /goal not found/);
  });

  test(label("C a half-pinned parent contract is refused, on seed and on update"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store, { goalContract: { id: "acceptance-goal" } });

    // a bare id is not a revision…
    assert.throws(
      () => store.seedGoal(createGoal({
        id: "goal-2",
        projectId: "project-1",
        title: "Goal 2",
        acceptanceId: "acceptance-goal",
      })),
      /without pinning a revision/,
    );
    // …and a bare version names nothing at all
    assert.throws(
      () => store.seedGoal(createGoal({
        id: "goal-3",
        projectId: "project-1",
        title: "Goal 3",
        acceptanceVersion: 1,
      })),
      /without naming a contract/,
    );
    // the same rule guards every versioned update, not just the seed
    assert.throws(
      () => store.updateGoal("goal-1", 1, { acceptanceId: "acceptance-goal", acceptanceVersion: null }, {
        commandId: "unpin",
      }),
      /without pinning a revision/,
    );
    assert.equal(store.getGoal("goal-1").acceptanceVersion, 1, "the legal pin is untouched");
    assert.equal(countEvents(store, "goal.updated"), 0);
  });

  // ── Aggregate Evidence: the Control Plane's own observation ────────────────

  test(label("D aggregate evidence is an observation of the children, with no Runtime lineage"), { skip }, (t) => {
    const store = backend.make(t);
    const { taskIds } = seedWorld(store, {
      taskStatuses: [TaskStatus.ACCEPTED, TaskStatus.ACCEPTED],
      goalContract: { id: "acceptance-goal" },
    });

    const evidence = store.ensureAggregateEvidence(Collection.GOAL, "goal-1", { commandId: "agg-1" });

    assert.equal(evidence.targetType, AcceptanceTargetType.GOAL);
    assert.equal(evidence.targetId, "goal-1");
    // a Goal has no Run and no Attempt: the evidence must not invent one
    assert.equal(evidence.taskId, null);
    assert.equal(evidence.runId, null);
    assert.equal(evidence.attemptId, null);
    assert.equal(evidence.acceptanceId, "acceptance-goal");
    assert.equal(evidence.acceptanceVersion, 1);
    assert.equal(evidence.status, EvidenceStatus.CANDIDATE);
    assert.match(evidence.revision, /^sha256:[0-9a-f]{64}$/);
    // the snapshot names the authoritative children, in a deterministic order
    assert.deepEqual(evidence.sourceRefs.map((ref) => ref.id), taskIds);
    assert.deepEqual(evidence.sourceRefs.map((ref) => ref.status), [TaskStatus.ACCEPTED, TaskStatus.ACCEPTED]);
    assert.deepEqual(evidence.sourceRefs.map((ref) => ref.version), [1, 1]);
    assert.equal(eventTypes(store).at(-1), "evidence.recorded");
    assert.equal(countEvents(store, "evidence.recorded"), 1);
    // no Run, no Attempt, no execution
    assert.equal(store.getRunsForTask("task-1").length, 0);
  });

  test(label("E the same observation is reused instead of recorded twice"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store, { goalContract: { id: "acceptance-goal" } });

    const first = store.ensureAggregateEvidence(Collection.GOAL, "goal-1", { commandId: "agg-1" });
    const again = store.ensureAggregateEvidence(Collection.GOAL, "goal-1", { commandId: "agg-2" });
    const replay = store.ensureAggregateEvidence(Collection.GOAL, "goal-1", { commandId: "agg-1" });

    assert.equal(again.id, first.id, "one observation, one Evidence record");
    assert.equal(replay.id, first.id, "a replayed command returns the same observation");
    assert.equal(countEvents(store, "evidence.recorded"), 1);
    assert.equal(countEvents(store, "evidence.superseded"), 0);
  });

  test(label("F a changed observation supersedes the record it replaces"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store, { goalContract: { id: "acceptance-goal" } });

    const before = store.ensureAggregateEvidence(Collection.GOAL, "goal-1", { commandId: "agg-1" });
    // the child state moves: the task is still ACCEPTED, but it is not the same
    // task record the observation was made about
    store.updateTask("task-1", 1, { title: "task-1 renamed" }, { commandId: "rename-task" });
    const after = store.ensureAggregateEvidence(Collection.GOAL, "goal-1", { commandId: "agg-2" });

    assert.notEqual(after.id, before.id, "a new observation is a new record");
    assert.notEqual(after.revision, before.revision);
    // the old record is history, never garbage
    const superseded = store.getEvidence(before.id);
    assert.equal(superseded.status, EvidenceStatus.SUPERSEDED);
    assert.equal(superseded.revision, before.revision, "the historical revision is preserved");
    assert.equal(store.getEvidence(after.id).status, EvidenceStatus.CANDIDATE);
    assert.equal(countEvents(store, "evidence.recorded"), 2);
    assert.equal(countEvents(store, "evidence.superseded"), 1);
    const event = store.getEvents().find((each) => each.type === "evidence.superseded");
    assert.equal(event.payload.supersededBy, after.id);
  });

  test(label("G an unfinished aggregate has no finished observation"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store, {
      taskStatuses: [TaskStatus.ACCEPTED, TaskStatus.READY],
      goalContract: { id: "acceptance-goal" },
    });

    assert.throws(
      () => store.ensureAggregateEvidence(Collection.GOAL, "goal-1", { commandId: "agg-1" }),
      /goal-1 is not finished: task-2 is READY/,
    );
    assert.equal(countEvents(store, "evidence.recorded"), 0, "nothing was recorded");
    assert.equal(store.getCommand("agg-1"), null, "no idempotency row survives a refusal");
  });

  test(label("H an aggregate without children cannot be observed"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store, { taskStatuses: [], goalContract: { id: "acceptance-goal" } });

    assert.throws(
      () => store.ensureAggregateEvidence(Collection.GOAL, "goal-1"),
      /goal-1 has no task to observe/,
    );
  });

  test(label("I evidence may not be re-labelled: task lineage and aggregate are disjoint"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store, { goalContract: { id: "acceptance-goal" } });
    const taskVerification = seedTaskChain(store);
    const evidence = store.ensureAggregateEvidence(Collection.GOAL, "goal-1");

    // an aggregate verification may not claim a task…
    assert.throws(
      () => store.recordVerification(goalVerificationFor(evidence, { id: "v-bad-task", taskId: "task-1" })),
      /must not declare a task/,
    );
    // …and a task verification may not claim an aggregate
    assert.throws(
      () => store.recordVerification(createVerification({
        id: "v-bad-goal",
        targetType: AcceptanceTargetType.TASK,
        targetId: "goal-1",
        taskId: "task-1",
        acceptanceId: "acceptance-1",
        acceptanceVersion: 1,
        evidenceIds: ["ev-task"],
        verdict: VerificationVerdict.PASS,
        revision: "rev-task",
      })),
      /names target goal-1 but task task-1/,
    );
    // task evidence can never stand behind a Goal acceptance — even when it has
    // been given the aggregate contract's identity, so the contract-match guard
    // passes and the target check is what refuses it
    store.recordEvidence(createEvidence({
      id: "ev-borrowed",
      targetType: AcceptanceTargetType.TASK,
      taskId: "task-1",
      runId: "run-1",
      attemptId: "attempt-1",
      acceptanceId: "acceptance-goal",
      acceptanceVersion: 1,
      revision: "rev-borrowed",
    }));
    assert.throws(
      () => store.recordVerification(createVerification({
        id: "v-borrowed",
        targetType: AcceptanceTargetType.GOAL,
        targetId: "goal-1",
        acceptanceId: "acceptance-goal",
        acceptanceVersion: 1,
        evidenceIds: ["ev-borrowed"],
        verdict: VerificationVerdict.PASS,
        revision: "rev-borrowed",
      })),
      /does not belong to GOAL goal-1/,
    );
    assert.equal(taskVerification.taskId, "task-1");
  });

  // ── Current Reality outranks Historical Evidence ───────────────────────────

  test(label("J evidence that no longer describes the current state cannot accept"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store, { goalContract: { id: "acceptance-goal" } });

    const evidence = store.ensureAggregateEvidence(Collection.GOAL, "goal-1");
    store.recordVerification(goalVerificationFor(evidence));
    // the verification was legal when it was recorded — then reality moved
    store.updateTask("task-1", 1, { title: "task-1 renamed" }, { commandId: "rename-task" });

    assert.throws(
      () => store.acceptGoal("goal-1", 1, { verificationId: "v-goal", commandId: "accept-goal" }),
      /no longer describes the current state of goal-1/,
    );
    assert.equal(store.getGoal("goal-1").status, GoalStatus.IN_PROGRESS, "nothing was accepted");
    assert.equal(store.getGoal("goal-1").version, 1, "and nothing was written");
    assert.equal(countEvents(store, "goal.accepted"), 0);
    assert.equal(store.getAcceptance("acceptance-goal", 1).status, "PENDING");
  });

  test(label("J2 a moved child state is re-observed and re-verified, then accepted"), { skip }, async (t) => {
    const store = backend.make(t);
    seedWorld(store, { goalContract: { id: "acceptance-goal" } });
    const { controller, verifier } = makeController(store, { verdict: VerificationVerdict.FAIL });

    // 1. the observation is made, verified and refused — the parent stays open
    const refused = await controller.reconcileGoal("goal-1");
    assert.equal(refused.action, "WAIT");
    assert.equal(refused.reason, "goal-acceptance-not-passed");
    const firstEvidenceId = refused.evidence.id;
    const firstVerificationId = refused.verification.id;
    assert.equal(store.getGoal("goal-1").status, GoalStatus.IN_PROGRESS);

    // 2. the child state moves, and the next verdict can pass
    store.updateTask("task-1", 1, { title: "task-1 renamed" }, { commandId: "rename-task" });
    verifier.verdict = VerificationVerdict.PASS;

    // 3. the new observation is a new evidence record and a NEW verification:
    //    the old verdict is never re-used for a different observation
    const accepted = await controller.reconcileGoal("goal-1");
    assert.equal(accepted.action, "ACCEPT");
    assert.notEqual(accepted.evidence.id, firstEvidenceId);
    assert.notEqual(accepted.verification.id, firstVerificationId);
    assert.equal(store.getGoal("goal-1").status, GoalStatus.ACCEPTED);

    // the replaced observation is history, and the refused verdict is still there
    assert.equal(store.getEvidence(firstEvidenceId).status, EvidenceStatus.SUPERSEDED);
    assert.equal(store.getVerification(firstVerificationId).verdict, VerificationVerdict.FAIL);
    assert.equal(countEvents(store, "evidence.recorded"), 2);
    assert.equal(countEvents(store, "evidence.superseded"), 1);
    assert.equal(countEvents(store, "verification.recorded"), 2);
    assert.equal(countEvents(store, "goal.accepted"), 1);
  });

  test(label("K accepting a parent writes state, contract decision, event and command together"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store, { goalContract: { id: "acceptance-goal" } });
    const evidence = store.ensureAggregateEvidence(Collection.GOAL, "goal-1");
    store.recordVerification(goalVerificationFor(evidence));

    const accepted = store.acceptGoal("goal-1", 1, { verificationId: "v-goal", commandId: "accept-goal" });

    assert.equal(accepted.status, GoalStatus.ACCEPTED);
    assert.equal(accepted.version, 2);
    assert.equal(accepted.acceptanceVersion, 1, "the pin never drifts onto a newer revision");
    assert.equal(store.getAcceptance("acceptance-goal", 1).status, "PASSED", "the revision records the decision");
    const event = store.getEvents().find((each) => each.type === "goal.accepted");
    assert.equal(event.aggregateId, "goal-1");
    assert.equal(event.aggregateVersion, 2);
    assert.equal(event.payload.verificationId, "v-goal");
    assert.equal(event.commandId, "accept-goal");
    assert.deepEqual(store.getCommand("accept-goal"), { operation: "acceptGoal", resultId: "goal-1" });

    // the same command replays instead of applying a second acceptance
    const replayed = store.acceptGoal("goal-1", 1, { verificationId: "v-goal", commandId: "accept-goal" });
    assert.equal(replayed.version, 2);
    assert.equal(countEvents(store, "goal.accepted"), 1);
  });

  test(label("L a BLOCKED or terminal parent is never accepted by contract"), { skip }, (t) => {
    const blocked = backend.make(t);
    seedWorld(blocked, { goalStatus: GoalStatus.BLOCKED, goalContract: { id: "acceptance-goal" } });
    const blockedEvidence = blocked.ensureAggregateEvidence(Collection.GOAL, "goal-1");
    blocked.recordVerification(goalVerificationFor(blockedEvidence));
    assert.throws(
      () => blocked.acceptGoal("goal-1", 1, { verificationId: "v-goal", commandId: "accept-blocked" }),
      /BLOCKED and may not enter ACCEPTED/,
    );
    assert.equal(blocked.getGoal("goal-1").status, GoalStatus.BLOCKED);
    assert.equal(blocked.getGoal("goal-1").version, 1);

    const open = backend.make(t);
    seedWorld(open, { goalContract: { id: "acceptance-goal" } });
    const evidence = open.ensureAggregateEvidence(Collection.GOAL, "goal-1");
    open.recordVerification(goalVerificationFor(evidence));
    open.acceptGoal("goal-1", 1, { verificationId: "v-goal", commandId: "accept-goal" });
    assert.throws(
      () => open.acceptGoal("goal-1", 2, { verificationId: "v-goal", commandId: "accept-again" }),
      /already ACCEPTED: acceptance is terminal/,
    );
    assert.equal(open.getGoal("goal-1").version, 2, "a terminal parent is not re-accepted");
  });

  test(label("M only a PASS verification of the pinned revision can accept a parent"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store, { goalContract: { id: "acceptance-goal" } });
    const taskVerification = seedTaskChain(store);
    const evidence = store.ensureAggregateEvidence(Collection.GOAL, "goal-1");
    store.recordVerification(goalVerificationFor(evidence, { id: "v-fail", verdict: VerificationVerdict.FAIL }));

    assert.throws(
      () => store.acceptGoal("goal-1", 1, { verificationId: "v-fail", commandId: "accept-fail" }),
      /cannot be accepted by a FAIL verification/,
    );
    // a verification about a TASK cannot speak for a Goal
    assert.throws(
      () => store.acceptGoal("goal-1", 1, { verificationId: taskVerification.id, commandId: "accept-task" }),
      /does not belong to GOAL goal-1/,
    );
    assert.throws(
      () => store.acceptGoal("goal-1", 1, { verificationId: "v-missing", commandId: "accept-missing" }),
      /verification not found/,
    );
    assert.equal(store.getGoal("goal-1").status, GoalStatus.IN_PROGRESS);
    assert.equal(countEvents(store, "goal.accepted"), 0);
  });

  test(label("N a revised contract does not move an existing pin"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store, { goalContract: { id: "acceptance-goal" } });
    const evidence = store.ensureAggregateEvidence(Collection.GOAL, "goal-1");
    store.recordVerification(goalVerificationFor(evidence));

    const revised = store.reviseAcceptance("acceptance-goal", {
      criteria: [{ id: "stricter", type: "AGGREGATE", required: true }],
    }, { commandId: "revise-goal-contract" });
    assert.equal(revised.version, 2);
    assert.equal(store.getAcceptance("acceptance-goal", 1).status, "PENDING", "the old revision is untouched");

    // the goal still pins v1, so a v1 verification is still the right one
    const accepted = store.acceptGoal("goal-1", 1, { verificationId: "v-goal", commandId: "accept-goal" });
    assert.equal(accepted.acceptanceVersion, 1);
    assert.equal(store.getAcceptance("acceptance-goal", 1).status, "PASSED");
    assert.equal(store.getAcceptance("acceptance-goal", 2).status, "PENDING", "v2 is not silently accepted");
  });

  test(label("O a Milestone is completed through its own contract, with its own event"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store, {
      milestoneStatus: MilestoneStatus.IN_PROGRESS,
      milestoneContract: { id: "acceptance-ms" },
      goalContract: { id: "acceptance-goal" },
      goalStatus: GoalStatus.ACCEPTED,
    });

    const evidence = store.ensureAggregateEvidence(Collection.MILESTONE, "ms-1");
    assert.equal(evidence.targetId, "ms-1");
    assert.deepEqual(evidence.sourceRefs.map((ref) => ref.id), ["goal-1"]);
    store.recordVerification(createVerification({
      id: "v-ms",
      targetType: AcceptanceTargetType.MILESTONE,
      targetId: "ms-1",
      acceptanceId: "acceptance-ms",
      acceptanceVersion: 1,
      evidenceIds: [evidence.id],
      verdict: VerificationVerdict.PASS,
      revision: evidence.revision,
    }));

    const completed = store.completeMilestone("ms-1", 1, { verificationId: "v-ms", commandId: "complete-ms" });

    assert.equal(completed.status, MilestoneStatus.COMPLETED);
    assert.equal(completed.version, 2);
    assert.equal(store.getAcceptance("acceptance-ms", 1).status, "PASSED");
    assert.equal(countEvents(store, "milestone.completed"), 1);
    assert.equal(countEvents(store, "milestone.updated"), 0, "the decision has its own event, not a generic update");
    // the milestone's decision touches its own contract and nothing else
    assert.equal(store.getAcceptance("acceptance-goal", 1).status, "PENDING");
    assert.equal(countEvents(store, "goal.accepted"), 0);
  });

  test(label("P the snapshot follows the child link, never the derived list"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store, {
      goalContract: { id: "acceptance-goal" },
      // the cached membership view is stale and wrong on purpose
      goalTaskIds: ["task-does-not-exist"],
    });

    const evidence = store.ensureAggregateEvidence(Collection.GOAL, "goal-1");

    assert.deepEqual(evidence.sourceRefs.map((ref) => ref.id), ["task-1"]);
    assert.equal(store.getGoal("goal-1").taskIds[0], "task-does-not-exist", "the cached list is not consulted");
  });

  test(label("Q evidence and verifications can be looked up by target"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store, { goalContract: { id: "acceptance-goal" } });
    const evidence = store.ensureAggregateEvidence(Collection.GOAL, "goal-1");
    store.recordVerification(goalVerificationFor(evidence));

    assert.deepEqual(
      store.recordsMatching(Collection.EVIDENCE, "targetId", "goal-1").map((each) => each.id),
      [evidence.id],
    );
    assert.deepEqual(
      store.getVerificationsForTarget("goal-1").map((each) => each.id),
      ["v-goal"],
    );
    // the lookup is by TARGET id, so a task's own evidence is not mixed in
    assert.deepEqual(store.recordsMatching(Collection.EVIDENCE, "targetId", "task-1"), []);
  });

  // ── the Controller: the only producer of a parent acceptance ───────────────

  test(label("R a corrupt pin makes parent acceptance unprovable instead of fatal"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store, { goalContract: { id: "acceptance-goal" } });
    const eventsBefore = store.getEvents().length;

    // Durable state that the rules would never have written (a hand-edited file,
    // or a row written by an older version): the pin loses its revision.
    const goal = store.getGoal("goal-1");
    store.putRecord(Collection.GOAL, "goal-1", {
      ...goal,
      acceptanceVersion: null,
      version: goal.version + 1,
    });

    const { controller } = makeController(store);
    return controller.reconcileGoal("goal-1").then((result) => {
      assert.equal(result.action, "WAIT");
      assert.equal(result.reason, "goal-acceptance-unprovable");
      assert.equal(store.getGoal("goal-1").status, GoalStatus.IN_PROGRESS);
      assert.equal(store.getEvents().length, eventsBefore, "an unprovable case writes nothing");
    });
  });

  test(label("S repeated reconciliation of a contract-bound parent is idempotent"), { skip }, async (t) => {
    const store = backend.make(t);
    seedWorld(store, { goalContract: { id: "acceptance-goal" } });
    const { controller, runtime } = makeController(store);

    const first = await controller.reconcileGoal("goal-1");
    assert.equal(first.action, "ACCEPT");
    assert.equal(first.reason, "goal-accepted");
    assert.equal(store.getGoal("goal-1").status, GoalStatus.ACCEPTED);

    const versionWhenAccepted = store.getGoal("goal-1").version;
    const evidenceWhenAccepted = countEvents(store, "evidence.recorded");
    const verificationsWhenAccepted = countEvents(store, "verification.recorded");
    assert.equal(evidenceWhenAccepted, 1, "one observation");
    assert.equal(verificationsWhenAccepted, 1, "one verdict per observation");

    for (let round = 0; round < 3; round += 1) {
      const again = await controller.reconcileGoal("goal-1");
      assert.equal(again.action, "NOOP");
    }
    assert.equal(store.getGoal("goal-1").version, versionWhenAccepted, "no version churn");
    assert.equal(countEvents(store, "goal.accepted"), 1);
    assert.equal(countEvents(store, "evidence.recorded"), evidenceWhenAccepted);
    assert.equal(countEvents(store, "verification.recorded"), verificationsWhenAccepted);
    assert.equal(runtime.started.length, 0, "no parent decision ever executes work");
  });

  test(label("T end-to-end: task acceptance → Goal contract → Milestone contract → Project"), { skip }, async (t) => {
    const store = backend.make(t);
    seedWorld(store, {
      taskStatuses: [TaskStatus.READY],
      goalStatus: GoalStatus.READY,
      milestoneStatus: MilestoneStatus.READY,
      taskContract: { id: "acceptance-1" },
      goalContract: { id: "acceptance-goal" },
      milestoneContract: { id: "acceptance-ms" },
    });
    const { controller, runtime } = makeController(store);

    // 1. the TASK goes through the real execution path
    assert.equal((await controller.reconcileTask("task-1")).action, "ACCEPT");
    assert.equal(store.getTask("task-1").status, TaskStatus.ACCEPTED);
    const afterTask = store.getEvents().length;
    const runsAfterTask = store.getRunsForTask("task-1").length;

    // 2. the parents only ever accept, on their own contracts
    assert.equal((await controller.reconcileGoal("goal-1")).action, "ACCEPT");
    assert.equal((await controller.reconcileMilestone("ms-1")).action, "ACCEPT");
    assert.equal((await controller.reconcileProject("project-1")).action, "SYNC");

    assert.equal(store.getGoal("goal-1").status, GoalStatus.ACCEPTED);
    assert.equal(store.getMilestone("ms-1").status, MilestoneStatus.COMPLETED);
    assert.equal(store.getProject("project-1").status, ProjectStatus.COMPLETED);
    assert.equal(store.getAcceptance("acceptance-goal", 1).status, "PASSED");
    assert.equal(store.getAcceptance("acceptance-ms", 1).status, "PASSED");

    // 3. the second half of the flow is exactly: observe, verify, decide
    assert.deepEqual(eventTypes(store).slice(afterTask), [
      "evidence.recorded",
      "verification.recorded",
      "goal.accepted",
      "evidence.recorded",
      "verification.recorded",
      "milestone.completed",
      "project.completed",
    ]);

    // 4. and nothing below the parents was executed again
    assert.equal(runtime.started.length, 1, "only the task ran");
    assert.equal(store.getRunsForTask("task-1").length, runsAfterTask, "no new Run");
  });

  test(label("U parent acceptance is part of the shared contract, not of a backend"), { skip }, async (t) => {
    const store = backend.make(t);
    seedWorld(store, { goalContract: { id: "acceptance-goal" } });
    const { controller } = makeController(store);

    await controller.reconcileGoal("goal-1");

    const state = parentAcceptanceState(store);
    assert.equal(state.goal.status, GoalStatus.ACCEPTED);
    assert.equal(state.evidence.length, 1);
    assert.equal(state.verifications.length, 1);
    assert.deepEqual(state.evidence[0].targetType, AcceptanceTargetType.GOAL);
    assert.deepEqual(state.verifications[0].targetType, AcceptanceTargetType.GOAL);
  });
}

/** Everything a parent acceptance run leaves behind, with timestamps removed. */
function parentAcceptanceState(store) {
  return {
    goal: withoutTimestamps(store.getGoal("goal-1")),
    acceptance: withoutTimestamps(store.getAcceptance("acceptance-goal", 1)),
    evidence: store.allRecords(Collection.EVIDENCE).map(withoutTimestamps),
    verifications: store.allRecords(Collection.VERIFICATION).map(withoutTimestamps),
    events: store.getEvents().map(({ occurredAt, ...rest }) => rest),
  };
}

test("both backends run the parent acceptance flow identically", { skip: BACKENDS[1].skip }, async (t) => {
  const memory = new MemoryStore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-parent-parity-"));
  const sqlite = new SqliteStore(path.join(dir, "project-control.db"));
  t.after(() => {
    try {
      sqlite.close();
    } catch {
      // already closed
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const run = async (store) => {
    seedWorld(store, { goalContract: { id: "acceptance-goal" } });
    const { controller } = makeController(store);
    await controller.reconcileGoal("goal-1");
    return parentAcceptanceState(store);
  };

  // node:test runs one test body at a time, so the two runs are sequential
  const fromMemory = await run(memory);
  const fromSqlite = await run(sqlite);

  assert.deepEqual(fromSqlite, fromMemory);
  assert.equal(fromMemory.goal.status, GoalStatus.ACCEPTED);
  assert.equal(fromMemory.acceptance.status, "PASSED");
});
