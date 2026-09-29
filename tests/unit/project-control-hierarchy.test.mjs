// Lifecycle reconciliation: Project → Milestone → Goal → Task.
//
// The whole state matrix in this file runs against EVERY backend, so the parent
// lifecycle rules are proven to live in the shared store semantics rather than in
// one storage implementation. Nothing here may execute work: the parent reconcile
// methods only aggregate state that already exists.
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
import { Controller } from "../../project-control/controller.mjs";
import { FakeRuntime } from "../../project-control/fake-runtime.mjs";
import { FakeVerifier } from "../../project-control/fake-verifier.mjs";
import {
  GoalStatus,
  MilestoneStatus,
  ProjectStatus,
  TaskStatus,
  VerificationVerdict,
  createAcceptance,
  createGoal,
  createMilestone,
  createProject,
  createTask,
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
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-hierarchy-"));
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

// ── backend-agnostic fixtures ────────────────────────────────────────────────

function makeController(store) {
  let n = 0;
  const runtime = new FakeRuntime({ mode: "success" });
  const verifier = new FakeVerifier({ verdict: VerificationVerdict.PASS });
  const controller = new Controller({
    store,
    runtime,
    verifier,
    idFactory: (prefix) => `${prefix}-${++n}`,
  });
  return { controller, runtime, verifier };
}

function seedHierarchy(store, {
  projectStatus = ProjectStatus.ACTIVE,
  milestoneStatus = MilestoneStatus.READY,
  goalStatus = GoalStatus.READY,
  milestoneAcceptanceId = null,
  goalAcceptanceId = null,
  goalIds = ["goal-1"],
  taskIds = [],
  withMilestone = true,
  withGoal = true,
} = {}) {
  store.seedProject(createProject({ id: "project-1", name: "Hierarchy project", status: projectStatus }));
  if (!withMilestone) return;
  store.seedMilestone(createMilestone({
    id: "ms-1",
    projectId: "project-1",
    name: "Milestone 1",
    status: milestoneStatus,
    goalIds,
    acceptanceId: milestoneAcceptanceId,
  }));
  if (!withGoal) return;
  store.seedGoal(createGoal({
    id: "goal-1",
    projectId: "project-1",
    milestoneId: "ms-1",
    title: "Goal 1",
    status: goalStatus,
    taskIds,
    acceptanceId: goalAcceptanceId,
  }));
}

/** Seeds tasks that belong to goal-1 through the explicit child link. */
function seedGoalTasks(store, statuses) {
  const ids = statuses.map((_status, index) => `task-${index + 1}`);
  statuses.forEach((status, index) => {
    store.seedTask(createTask({
      id: ids[index],
      goalId: "goal-1",
      title: ids[index],
      acceptanceId: "acceptance-1",
      acceptanceVersion: 1,
      status,
    }));
  });
  return ids;
}

function eventCount(store, type) {
  return store.getEvents().filter((event) => event.type === type).length;
}

const withoutTimestamps = ({ createdAt, updatedAt, ...rest }) => rest;

function snapshot(store) {
  return {
    project: withoutTimestamps(store.getProject("project-1")),
    milestone: withoutTimestamps(store.getMilestone("ms-1")),
    goal: withoutTimestamps(store.getGoal("goal-1")),
    tasks: store.getTasksForGoal("goal-1").map(withoutTimestamps).sort((a, b) => a.id.localeCompare(b.id)),
    events: store.getEvents().map(({ occurredAt, ...rest }) => rest),
  };
}

// ── Goal lifecycle matrix ────────────────────────────────────────────────────

const GOAL_CASES = [
  {
    label: "A all tasks READY keeps the goal READY",
    goal: GoalStatus.READY,
    tasks: [TaskStatus.READY, TaskStatus.READY],
    action: "NOOP",
    status: GoalStatus.READY,
    reason: "goal-ready",
  },
  {
    label: "B a started task moves the goal IN_PROGRESS",
    goal: GoalStatus.READY,
    tasks: [TaskStatus.ACCEPTED, TaskStatus.IN_PROGRESS],
    action: "SYNC",
    status: GoalStatus.IN_PROGRESS,
    reason: "goal-in-progress",
  },
  {
    label: "C a NEEDS_REVIEW task moves the goal IN_PROGRESS",
    goal: GoalStatus.READY,
    tasks: [TaskStatus.ACCEPTED, TaskStatus.NEEDS_REVIEW],
    action: "SYNC",
    status: GoalStatus.IN_PROGRESS,
    reason: "goal-in-progress",
  },
  {
    label: "D a BLOCKED task blocks the goal",
    goal: GoalStatus.IN_PROGRESS,
    tasks: [TaskStatus.ACCEPTED, TaskStatus.BLOCKED],
    action: "SYNC",
    status: GoalStatus.BLOCKED,
    reason: "goal-blocked",
  },
  {
    label: "E all tasks accepted accepts the goal",
    goal: GoalStatus.IN_PROGRESS,
    tasks: [TaskStatus.ACCEPTED, TaskStatus.ACCEPTED],
    action: "SYNC",
    status: GoalStatus.ACCEPTED,
    reason: "goal-accepted",
  },
  {
    label: "F a REJECTED task is never an aggregation decision",
    goal: GoalStatus.READY,
    tasks: [TaskStatus.READY, TaskStatus.REJECTED],
    action: "WAIT",
    status: GoalStatus.READY,
    reason: "goal-task-decision-required",
  },
  {
    label: "F a CANCELLED task is never an aggregation decision",
    goal: GoalStatus.IN_PROGRESS,
    tasks: [TaskStatus.READY, TaskStatus.CANCELLED],
    action: "WAIT",
    status: GoalStatus.IN_PROGRESS,
    reason: "goal-task-decision-required",
  },
  {
    label: "G a goal without tasks waits",
    goal: GoalStatus.READY,
    tasks: [],
    action: "WAIT",
    status: GoalStatus.READY,
    reason: "goal-without-tasks",
  },
  {
    label: "D2 a BLOCKED task blocks a READY goal",
    goal: GoalStatus.READY,
    tasks: [TaskStatus.READY, TaskStatus.BLOCKED],
    action: "SYNC",
    status: GoalStatus.BLOCKED,
    reason: "goal-blocked",
  },
  {
    label: "U a BLOCKED goal does not accept even when every task is accepted",
    goal: GoalStatus.BLOCKED,
    tasks: [TaskStatus.ACCEPTED, TaskStatus.ACCEPTED],
    action: "WAIT",
    status: GoalStatus.BLOCKED,
    reason: "goal-blocked-awaiting-resolution",
  },
  {
    label: "U a BLOCKED goal is not walked back to IN_PROGRESS",
    goal: GoalStatus.BLOCKED,
    tasks: [TaskStatus.IN_PROGRESS, TaskStatus.READY],
    action: "WAIT",
    status: GoalStatus.BLOCKED,
    reason: "goal-blocked-awaiting-resolution",
  },
  {
    label: "U a BLOCKED goal stays blocked even without tasks",
    goal: GoalStatus.BLOCKED,
    tasks: [],
    action: "WAIT",
    status: GoalStatus.BLOCKED,
    reason: "goal-blocked-awaiting-resolution",
  },
  {
    label: "E/H a goal with its own acceptance contract does not fake acceptance",
    goal: GoalStatus.IN_PROGRESS,
    tasks: [TaskStatus.ACCEPTED, TaskStatus.ACCEPTED],
    goalAcceptanceId: "acceptance-1",
    action: "WAIT",
    status: GoalStatus.IN_PROGRESS,
    reason: "goal-acceptance-required",
  },
];

// ── Milestone lifecycle matrix (goal states are seeded directly) ─────────────

const MILESTONE_CASES = [
  {
    label: "I all goals READY keeps the milestone READY",
    milestone: MilestoneStatus.READY,
    goals: [GoalStatus.READY, GoalStatus.READY],
    action: "NOOP",
    status: MilestoneStatus.READY,
    reason: "milestone-ready",
  },
  {
    label: "J a goal IN_PROGRESS moves the milestone IN_PROGRESS",
    milestone: MilestoneStatus.READY,
    goals: [GoalStatus.ACCEPTED, GoalStatus.IN_PROGRESS],
    action: "SYNC",
    status: MilestoneStatus.IN_PROGRESS,
    reason: "milestone-in-progress",
  },
  {
    label: "K a BLOCKED goal blocks the milestone",
    milestone: MilestoneStatus.IN_PROGRESS,
    goals: [GoalStatus.ACCEPTED, GoalStatus.BLOCKED],
    action: "SYNC",
    status: MilestoneStatus.BLOCKED,
    reason: "milestone-blocked",
  },
  {
    label: "L all goals ACCEPTED completes the milestone",
    milestone: MilestoneStatus.IN_PROGRESS,
    goals: [GoalStatus.ACCEPTED, GoalStatus.ACCEPTED],
    action: "SYNC",
    status: MilestoneStatus.COMPLETED,
    reason: "milestone-completed",
  },
  {
    label: "M a REJECTED goal is never an aggregation decision",
    milestone: MilestoneStatus.READY,
    goals: [GoalStatus.READY, GoalStatus.REJECTED],
    action: "WAIT",
    status: MilestoneStatus.READY,
    reason: "milestone-goal-decision-required",
  },
  {
    label: "M a CANCELLED goal is never an aggregation decision",
    milestone: MilestoneStatus.IN_PROGRESS,
    goals: [GoalStatus.READY, GoalStatus.CANCELLED],
    action: "WAIT",
    status: MilestoneStatus.IN_PROGRESS,
    reason: "milestone-goal-decision-required",
  },
  {
    label: "N a milestone without goals waits",
    milestone: MilestoneStatus.READY,
    goals: [],
    action: "WAIT",
    status: MilestoneStatus.READY,
    reason: "milestone-without-goals",
  },
  {
    label: "K2 a BLOCKED goal blocks a READY milestone",
    milestone: MilestoneStatus.READY,
    goals: [GoalStatus.READY, GoalStatus.BLOCKED],
    action: "SYNC",
    status: MilestoneStatus.BLOCKED,
    reason: "milestone-blocked",
  },
  {
    label: "U a BLOCKED milestone does not complete even when every goal is accepted",
    milestone: MilestoneStatus.BLOCKED,
    goals: [GoalStatus.ACCEPTED, GoalStatus.ACCEPTED],
    action: "WAIT",
    status: MilestoneStatus.BLOCKED,
    reason: "milestone-blocked-awaiting-resolution",
  },
  {
    label: "U a BLOCKED milestone is not walked back to IN_PROGRESS",
    milestone: MilestoneStatus.BLOCKED,
    goals: [GoalStatus.IN_PROGRESS, GoalStatus.READY],
    action: "WAIT",
    status: MilestoneStatus.BLOCKED,
    reason: "milestone-blocked-awaiting-resolution",
  },
  {
    label: "O a milestone with its own acceptance contract does not fake completion",
    milestone: MilestoneStatus.IN_PROGRESS,
    goals: [GoalStatus.ACCEPTED],
    milestoneAcceptanceId: "acceptance-1",
    action: "WAIT",
    status: MilestoneStatus.IN_PROGRESS,
    reason: "milestone-acceptance-required",
  },
];

// ── Project lifecycle matrix (milestone states are seeded directly) ──────────

const PROJECT_CASES = [
  {
    label: "P ACTIVE with an unfinished milestone stays ACTIVE",
    project: ProjectStatus.ACTIVE,
    milestones: [MilestoneStatus.IN_PROGRESS],
    action: "NOOP",
    status: ProjectStatus.ACTIVE,
    reason: "project-active",
  },
  {
    label: "Q all milestones COMPLETED completes the project",
    project: ProjectStatus.ACTIVE,
    milestones: [MilestoneStatus.COMPLETED],
    action: "SYNC",
    status: ProjectStatus.COMPLETED,
    reason: "project-completed",
  },
  {
    label: "R a BLOCKED milestone cannot block a project (no such project status)",
    project: ProjectStatus.ACTIVE,
    milestones: [MilestoneStatus.BLOCKED],
    action: "WAIT",
    status: ProjectStatus.ACTIVE,
    reason: "project-blocked-by-milestone",
  },
  {
    label: "S a project without milestones waits",
    project: ProjectStatus.ACTIVE,
    milestones: [],
    action: "WAIT",
    status: ProjectStatus.ACTIVE,
    reason: "project-without-milestones",
  },
  {
    label: "T PAUSED is never resumed by aggregation",
    project: ProjectStatus.PAUSED,
    milestones: [MilestoneStatus.COMPLETED],
    action: "NOOP",
    status: ProjectStatus.PAUSED,
    reason: "project-paused",
  },
  {
    label: "T COMPLETED is never re-aggregated",
    project: ProjectStatus.COMPLETED,
    milestones: [MilestoneStatus.IN_PROGRESS],
    action: "NOOP",
    status: ProjectStatus.COMPLETED,
    reason: "project-completed",
  },
  {
    label: "T ARCHIVED is never re-aggregated",
    project: ProjectStatus.ARCHIVED,
    milestones: [MilestoneStatus.COMPLETED],
    action: "NOOP",
    status: ProjectStatus.ARCHIVED,
    reason: "project-archived",
  },
];

for (const backend of BACKENDS) {
  const { name, skip } = backend;

  for (const testCase of GOAL_CASES) {
    test(`${name} goal ${testCase.label}`, { skip }, async (t) => {
      const store = backend.make(t);
      seedHierarchy(store, { goalStatus: testCase.goal, goalAcceptanceId: testCase.goalAcceptanceId ?? null });
      seedGoalTasks(store, testCase.tasks);
      const { controller, runtime } = makeController(store);

      const result = await controller.reconcileGoal("goal-1");

      assert.equal(result.action, testCase.action, testCase.label);
      assert.equal(result.reason, testCase.reason, testCase.label);
      assert.equal(result.goal.status, testCase.status, testCase.label);
      assert.equal(store.getGoal("goal-1").status, testCase.status);
      assert.equal(runtime.started.length, 0, "parent reconciliation never executes work");
      assert.equal(store.getRunsForTask("task-1").length, 0, "no Run may be created");
      // a WAIT/NOOP never churns the aggregate; a SYNC writes exactly once
      assert.equal(store.getGoal("goal-1").version, testCase.action === "SYNC" ? 2 : 1, "version churn");
      assert.equal(
        eventCount(store, "goal.updated") + eventCount(store, "goal.accepted"),
        testCase.action === "SYNC" ? 1 : 0,
        "no redundant goal event",
      );
    });
  }

  for (const testCase of MILESTONE_CASES) {
    test(`${name} milestone ${testCase.label}`, { skip }, async (t) => {
      const store = backend.make(t);
      const goalIds = testCase.goals.map((_status, index) => `goal-${index + 1}`);
      seedHierarchy(store, {
        milestoneStatus: testCase.milestone,
        milestoneAcceptanceId: testCase.milestoneAcceptanceId ?? null,
        goalIds,
        withGoal: testCase.goals.length > 0,
      });
      testCase.goals.forEach((status, index) => {
        if (index === 0) {
          store.updateGoal("goal-1", 1, { status, milestoneId: "ms-1" }, { commandId: `seed-goal-${index}` });
        } else {
          store.seedGoal(createGoal({
            id: `goal-${index + 1}`,
            projectId: "project-1",
            milestoneId: "ms-1",
            title: `Goal ${index + 1}`,
            status,
          }));
        }
      });
      const { controller, runtime } = makeController(store);

      const result = await controller.reconcileMilestone("ms-1");

      assert.equal(result.action, testCase.action, testCase.label);
      assert.equal(result.reason, testCase.reason, testCase.label);
      assert.equal(result.milestone.status, testCase.status, testCase.label);
      assert.equal(store.getMilestone("ms-1").status, testCase.status);
      assert.equal(runtime.started.length, 0, "parent reconciliation never executes work");
      assert.equal(store.getMilestone("ms-1").version, testCase.action === "SYNC" ? 2 : 1, "version churn");
      assert.equal(
        eventCount(store, "milestone.updated") + eventCount(store, "milestone.completed"),
        testCase.action === "SYNC" ? 1 : 0,
        "no redundant milestone event",
      );
    });
  }

  for (const testCase of PROJECT_CASES) {
    test(`${name} project ${testCase.label}`, { skip }, async (t) => {
      const store = backend.make(t);
      seedHierarchy(store, {
        projectStatus: testCase.project,
        withMilestone: testCase.milestones.length > 0,
        withGoal: false,
      });
      testCase.milestones.forEach((status, index) => {
        if (index === 0) {
          // the seeded milestone is re-stated at the status under test
          store.updateMilestone("ms-1", 1, { status }, { commandId: `seed-ms-${index}` });
        } else {
          store.seedMilestone(createMilestone({
            id: `ms-${index + 1}`,
            projectId: "project-1",
            name: `Milestone ${index + 1}`,
            status,
          }));
        }
      });
      const { controller, runtime } = makeController(store);

      const result = await controller.reconcileProject("project-1");

      assert.equal(result.action, testCase.action, testCase.label);
      assert.equal(result.reason, testCase.reason, testCase.label);
      assert.equal(result.project.status, testCase.status, testCase.label);
      assert.equal(store.getProject("project-1").status, testCase.status);
      assert.equal(runtime.started.length, 0, "parent reconciliation never executes work");
      assert.equal(store.getProject("project-1").version, testCase.action === "SYNC" ? 2 : 1, "version churn");
      assert.equal(
        eventCount(store, "project.updated") + eventCount(store, "project.completed"),
        testCase.action === "SYNC" ? 1 : 0,
        "no redundant project event",
      );
    });
  }

  test(`${name}: hierarchy end-to-end — accepted tasks complete goal, milestone and project`, { skip }, async (t) => {
    const store = backend.make(t);
    store.seedAcceptance(createAcceptance({
      id: "acceptance-1",
      targetId: "task-1",
      criteria: [{ id: "build", type: "BUILD", required: true }],
    }));
    seedHierarchy(store, { taskIds: ["task-1", "task-2"] });
    seedGoalTasks(store, [TaskStatus.READY, TaskStatus.READY]);
    const { controller, runtime } = makeController(store);

    // drive both tasks through the REAL task path (evidence → verification → acceptance)
    assert.equal((await controller.reconcileTask("task-1")).action, "ACCEPT");
    assert.equal((await controller.reconcileTask("task-2")).action, "ACCEPT");
    assert.equal(store.getTask("task-1").status, TaskStatus.ACCEPTED);
    assert.equal(store.getTask("task-2").status, TaskStatus.ACCEPTED);

    const runsBefore = store.getRunsForTask("task-1").length + store.getRunsForTask("task-2").length;
    const evidenceBefore = eventCount(store, "evidence.recorded");
    const attemptsBefore = store.getRunsForTask("task-1").concat(store.getRunsForTask("task-2"))
      .reduce((total, run) => total + run.attemptIds.length, 0);
    const startsBefore = runtime.started.length;

    const goal = await controller.reconcileGoal("goal-1");
    const milestone = await controller.reconcileMilestone("ms-1");
    const project = await controller.reconcileProject("project-1");

    assert.equal(goal.action, "SYNC");
    assert.equal(goal.goal.status, GoalStatus.ACCEPTED);
    assert.equal(milestone.action, "SYNC");
    assert.equal(milestone.milestone.status, MilestoneStatus.COMPLETED);
    assert.equal(project.action, "SYNC");
    assert.equal(project.project.status, ProjectStatus.COMPLETED);

    // the parent only aggregated: nothing new was executed or recorded
    assert.equal(runtime.started.length, startsBefore, "no runtime.start()");
    assert.equal(
      store.getRunsForTask("task-1").length + store.getRunsForTask("task-2").length,
      runsBefore,
      "no new Run",
    );
    assert.equal(
      store.getRunsForTask("task-1").concat(store.getRunsForTask("task-2"))
        .reduce((total, run) => total + run.attemptIds.length, 0),
      attemptsBefore,
      "no new Attempt",
    );
    assert.equal(eventCount(store, "evidence.recorded"), evidenceBefore, "no new Evidence");

    // and the lifecycle events are the dedicated ones, in order
    assert.deepEqual(
      store.getEvents().map((event) => event.type).slice(-3),
      ["goal.accepted", "milestone.completed", "project.completed"],
    );
  });

  test(`${name}: repeated reconciliation is stable and never churns versions`, { skip }, async (t) => {
    const store = backend.make(t);
    seedHierarchy(store, { taskIds: ["task-1"] });
    seedGoalTasks(store, [TaskStatus.ACCEPTED]);
    const { controller } = makeController(store);

    // READY → ACCEPTED on the first pass, no-op afterwards
    const first = await controller.reconcileGoal("goal-1");
    assert.equal(first.action, "SYNC");
    const goalVersion = store.getGoal("goal-1").version;
    const goalUpdatedEvents = eventCount(store, "goal.updated");
    const goalAcceptedEvents = eventCount(store, "goal.accepted");

    const second = await controller.reconcileGoal("goal-1");
    const third = await controller.reconcileGoal("goal-1");
    assert.equal(second.action, "NOOP");
    assert.equal(third.action, "NOOP");
    assert.equal(store.getGoal("goal-1").version, goalVersion, "no version churn");
    assert.equal(eventCount(store, "goal.updated"), goalUpdatedEvents);
    assert.equal(eventCount(store, "goal.accepted"), goalAcceptedEvents);

    // milestone and project are stable too
    await controller.reconcileMilestone("ms-1");
    const milestoneVersion = store.getMilestone("ms-1").version;
    await controller.reconcileMilestone("ms-1");
    assert.equal(store.getMilestone("ms-1").version, milestoneVersion);
    assert.equal(eventCount(store, "milestone.completed"), 1);

    await controller.reconcileProject("project-1");
    const projectVersion = store.getProject("project-1").version;
    await controller.reconcileProject("project-1");
    assert.equal(store.getProject("project-1").version, projectVersion);
    assert.equal(eventCount(store, "project.completed"), 1);
  });

  test(`${name}: READY → IN_PROGRESS is applied once and then stable`, { skip }, async (t) => {
    const store = backend.make(t);
    seedHierarchy(store, { taskIds: ["task-1"] });
    seedGoalTasks(store, [TaskStatus.IN_PROGRESS]);
    const { controller } = makeController(store);

    const first = await controller.reconcileGoal("goal-1");
    assert.equal(first.action, "SYNC");
    assert.equal(store.getGoal("goal-1").status, GoalStatus.IN_PROGRESS);
    const versionAfterFirst = store.getGoal("goal-1").version;
    const updatedEventsAfterFirst = eventCount(store, "goal.updated");

    const second = await controller.reconcileGoal("goal-1");
    assert.equal(second.action, "NOOP");
    assert.equal(second.reason, "goal-in-progress");
    assert.equal(store.getGoal("goal-1").version, versionAfterFirst, "no second mutation");
    assert.equal(eventCount(store, "goal.updated"), updatedEventsAfterFirst, "no second goal.updated");
  });

  test(`${name}: a BLOCKED goal is not cleared by a recovering child, up to the project`, { skip }, async (t) => {
    const store = backend.make(t);
    seedHierarchy(store, { taskIds: ["task-1", "task-2"] });
    const taskIds = seedGoalTasks(store, [TaskStatus.BLOCKED, TaskStatus.ACCEPTED]);
    const { controller, runtime } = makeController(store);

    // 1. a blocked child puts the goal INTO blocked
    const blocked = await controller.reconcileGoal("goal-1");
    assert.equal(blocked.action, "SYNC");
    assert.equal(blocked.goal.status, GoalStatus.BLOCKED);
    const versionWhenBlocked = store.getGoal("goal-1").version;

    // 2. the child recovers — that recovery is not a decision to unblock
    store.updateTask(taskIds[0], 1, { status: TaskStatus.ACCEPTED }, { commandId: "cmd-recover" });
    assert.equal(store.getTask(taskIds[0]).status, TaskStatus.ACCEPTED);

    // 3. the goal must neither accept nor be walked back
    const afterRecovery = await controller.reconcileGoal("goal-1");
    assert.equal(afterRecovery.action, "WAIT");
    assert.equal(afterRecovery.reason, "goal-blocked-awaiting-resolution");
    assert.equal(afterRecovery.goal.status, GoalStatus.BLOCKED);
    assert.equal(store.getGoal("goal-1").version, versionWhenBlocked, "no churn while blocked");
    assert.equal(eventCount(store, "goal.accepted"), 0);

    // 4. the milestone observes a BLOCKED goal and enters BLOCKED itself
    const milestoneBlocked = await controller.reconcileMilestone("ms-1");
    assert.equal(milestoneBlocked.milestone.status, MilestoneStatus.BLOCKED);
    assert.notEqual(milestoneBlocked.milestone.status, MilestoneStatus.COMPLETED);

    // 5. …and cannot leave BLOCKED on its own either
    const milestoneAfter = await controller.reconcileMilestone("ms-1");
    assert.equal(milestoneAfter.action, "WAIT");
    assert.equal(milestoneAfter.reason, "milestone-blocked-awaiting-resolution");
    assert.equal(store.getMilestone("ms-1").status, MilestoneStatus.BLOCKED);
    assert.notEqual(store.getMilestone("ms-1").status, MilestoneStatus.COMPLETED);
    assert.equal(eventCount(store, "milestone.completed"), 0);

    // 6. the project reports the block without inventing a project state
    const project = await controller.reconcileProject("project-1");
    assert.equal(project.action, "WAIT");
    assert.equal(project.reason, "project-blocked-by-milestone");
    assert.equal(store.getProject("project-1").status, ProjectStatus.ACTIVE);

    assert.equal(runtime.started.length, 0, "nothing was executed");
  });

  test(`${name}: membership follows the child link, never the derived list`, { skip }, async (t) => {
    const store = backend.make(t);
    // deliberately inconsistent: the derived lists are empty/stale and wrong
    seedHierarchy(store, { goalIds: ["goal-does-not-exist"], taskIds: ["task-does-not-exist"] });
    seedGoalTasks(store, [TaskStatus.ACCEPTED]);

    assert.deepEqual(store.getTasksForGoal("goal-1").map((task) => task.id), ["task-1"]);
    assert.deepEqual(store.getGoalsForMilestone("ms-1").map((goal) => goal.id), ["goal-1"]);
    assert.equal(store.getMilestone("ms-1").goalIds[0], "goal-does-not-exist", "the derived list is not rewritten");
    assert.equal(store.getGoal("goal-1").taskIds[0], "task-does-not-exist");

    const { controller } = makeController(store);
    const goal = await controller.reconcileGoal("goal-1");
    assert.equal(goal.action, "SYNC");
    assert.equal(goal.goal.status, GoalStatus.ACCEPTED, "aggregation used the child link, not the stale list");
    assert.equal((await controller.reconcileMilestone("ms-1")).milestone.status, MilestoneStatus.COMPLETED);
  });

  test(`${name}: repeated reconciliation of BLOCKED aggregates never churns`, { skip }, async (t) => {
    const store = backend.make(t);
    seedHierarchy(store, { goalStatus: GoalStatus.BLOCKED, milestoneStatus: MilestoneStatus.BLOCKED });
    seedGoalTasks(store, [TaskStatus.ACCEPTED, TaskStatus.ACCEPTED]);
    const { controller } = makeController(store);

    const goalVersion = store.getGoal("goal-1").version;
    const milestoneVersion = store.getMilestone("ms-1").version;
    const events = store.getEvents().length;

    for (let round = 0; round < 3; round += 1) {
      const goal = await controller.reconcileGoal("goal-1");
      assert.equal(goal.action, "WAIT");
      assert.equal(goal.reason, "goal-blocked-awaiting-resolution");
      const milestone = await controller.reconcileMilestone("ms-1");
      assert.equal(milestone.action, "WAIT");
      assert.equal(milestone.reason, "milestone-blocked-awaiting-resolution");
    }

    assert.equal(store.getGoal("goal-1").version, goalVersion, "no goal version churn");
    assert.equal(store.getMilestone("ms-1").version, milestoneVersion, "no milestone version churn");
    assert.equal(store.getEvents().length, events, "no event while blocked");
    assert.equal(eventCount(store, "goal.accepted"), 0);
    assert.equal(eventCount(store, "milestone.completed"), 0);
  });
}

test("ProjectStatus has no BLOCKED state, so a blocked milestone can never become one", () => {
  assert.deepEqual([...Object.values(ProjectStatus)].sort(), ["ACTIVE", "ARCHIVED", "COMPLETED", "PAUSED"]);
  assert.equal(ProjectStatus.BLOCKED, undefined);
});

test("both backends aggregate the same hierarchy identically", { skip: BACKENDS[1].skip }, (t) => {
  const memory = new MemoryStore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-hierarchy-parity-"));
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
    seedHierarchy(store, { taskIds: ["task-1", "task-2"] });
    seedGoalTasks(store, [TaskStatus.ACCEPTED, TaskStatus.ACCEPTED]);
    const { controller } = makeController(store);
    await controller.reconcileGoal("goal-1");
    await controller.reconcileMilestone("ms-1");
    await controller.reconcileProject("project-1");
    return snapshot(store);
  };

  // node:test runs one test body at a time, so the two runs are sequential
  return run(memory).then(async (fromMemory) => {
    const fromSqlite = await run(sqlite);
    assert.deepEqual(fromSqlite, fromMemory);
    assert.equal(fromMemory.project.status, ProjectStatus.COMPLETED);
    assert.equal(fromMemory.milestone.status, MilestoneStatus.COMPLETED);
    assert.equal(fromMemory.goal.status, GoalStatus.ACCEPTED);
  });
});
