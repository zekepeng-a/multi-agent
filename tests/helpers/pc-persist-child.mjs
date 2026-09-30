// Cross-process persistence probe used by tests/integration/persistence.test.mjs.
//
// It is deliberately NOT a *.test.mjs file: it is a plain script the test runner
// spawns as a separate OS process, so a genuine process exit happens between
// "write" and "read". That is what proves the state is durable rather than
// cached inside one long-lived store object.
//
// usage: node pc-persist-child.mjs write <dbfile>
//        node pc-persist-child.mjs read  <dbfile> <json ids from the write phase>
//        node pc-persist-child.mjs parent <dbfile>
//        node pc-persist-child.mjs parent-read <dbfile> <json ids from the parent phase>
//        node pc-persist-child.mjs approval <dbfile>
//        node pc-persist-child.mjs approval-read <dbfile> <json ids from the approval phase>

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PC = path.join(HERE, "..", "..", "project-control");
const load = (name) => import(pathToFileURL(path.join(PC, name)).href);

const { SqliteStore } = await load("sqlite-store.mjs");
const { Collection } = await load("store.mjs");
const { Controller } = await load("controller.mjs");
const { FakeRuntime } = await load("fake-runtime.mjs");
const { FakeVerifier } = await load("fake-verifier.mjs");
const {
  AcceptanceTargetType,
  ApprovalDecision,
  ApprovalError,
  ApprovalTargetType,
  GoalStatus,
  RiskLevel,
  TaskStatus,
  VerificationVerdict,
  createAcceptance,
  createGoal,
  createMilestone,
  createProject,
  createTask,
  createVerification,
} = await load("domain.mjs");

const [mode, file, idsJson] = process.argv.slice(2);
if (!mode || !file) {
  console.error("usage: node pc-persist-child.mjs <write|read|parent|parent-read|approval|approval-read> <dbfile> [idsJson]");
  process.exit(2);
}

function controllerFor(store) {
  let n = 0;
  return new Controller({
    store,
    runtime: new FakeRuntime({ mode: "success" }),
    verifier: new FakeVerifier({}),
    idFactory: (prefix) => `child-${prefix}-${++n}`,
  });
}

const store = new SqliteStore(file);
let payload;

try {
  if (mode === "write") {
    store.seedAcceptance(createAcceptance({
      id: "acceptance-1",
      targetId: "task-1",
      criteria: [{ id: "build", type: "BUILD", required: true }],
    }));
    store.seedTask(createTask({
      id: "task-1", title: "process-restart task", acceptanceId: "acceptance-1", acceptanceVersion: 1,
    }));

    const result = await controllerFor(store).reconcileTask("task-1");

    // revise the contract AFTER the task exists, then pin a second task to v2
    store.reviseAcceptance("acceptance-1", { criteria: [{ id: "lint", type: "LINT", required: true }] });
    store.seedTask(createTask({
      id: "task-2", title: "pinned to v2", acceptanceId: "acceptance-1", acceptanceVersion: 2,
    }));

    payload = {
      action: result.action,
      taskStatus: store.getTask("task-1").status,
      acceptanceVersion: store.getTask("task-1").acceptanceVersion,
      acceptanceV1: store.getAcceptance("acceptance-1", 1).status,
      acceptanceV2: store.getAcceptance("acceptance-1", 2).status,
      task2AcceptanceVersion: store.getTask("task-2").acceptanceVersion,
      eventCount: store.getEvents().length,
      ids: {
        runId: result.run.id,
        attemptId: result.attempt.id,
        evidenceId: result.evidence.id,
        verificationId: result.verification.id,
      },
    };
  } else if (mode === "read") {
    const ids = JSON.parse(idsJson ?? "{}");
    const evidence = store.getEvidence(ids.evidenceId);
    payload = {
      taskStatus: store.getTask("task-1").status,
      acceptanceVersion: store.getTask("task-1").acceptanceVersion,
      acceptanceV1: store.getAcceptance("acceptance-1", 1).status,
      acceptanceV2: store.getAcceptance("acceptance-1", 2).status,
      task2AcceptanceVersion: store.getTask("task-2").acceptanceVersion,
      runStatus: store.getRun(ids.runId).status,
      attemptStatus: store.getAttempt(ids.attemptId).status,
      evidenceRunId: evidence.runId,
      evidenceAttemptId: evidence.attemptId,
      verificationTaskId: store.getVerification(ids.verificationId).taskId,
      eventCount: store.getEvents().length,
      // re-prove the whole lineage from durable rows only
      reproof: store.recordVerification(createVerification({
        id: "child-verification-reproof",
        taskId: "task-1",
        acceptanceId: "acceptance-1",
        acceptanceVersion: 1,
        evidenceIds: [evidence.id],
        verdict: VerificationVerdict.PASS,
        revision: evidence.revision,
      })).verdict,
    };
  } else if (mode === "parent") {
    // A parent acceptance decided in THIS process, against a contract, with the
    // child state already durable.
    store.seedProject(createProject({ id: "project-1", name: "Parent restart" }));
    store.seedAcceptance(createAcceptance({
      id: "acceptance-goal",
      targetType: AcceptanceTargetType.GOAL,
      targetId: "goal-1",
      criteria: [{ id: "aggregate", type: "AGGREGATE", required: true }],
    }));
    store.seedMilestone(createMilestone({ id: "ms-1", projectId: "project-1", name: "M1" }));
    store.seedGoal(createGoal({
      id: "goal-1",
      projectId: "project-1",
      milestoneId: "ms-1",
      title: "G1",
      status: GoalStatus.IN_PROGRESS,
      acceptanceId: "acceptance-goal",
      acceptanceVersion: 1,
    }));
    store.seedTask(createTask({
      id: "task-1",
      goalId: "goal-1",
      title: "T1",
      acceptanceId: "acceptance-1",
      acceptanceVersion: 1,
      status: TaskStatus.ACCEPTED,
    }));

    const result = await controllerFor(store).reconcileGoal("goal-1");
    const accepted = store.getEvents().find((event) => event.type === "goal.accepted");

    payload = {
      action: result.action,
      reason: result.reason,
      goalStatus: store.getGoal("goal-1").status,
      goalVersion: store.getGoal("goal-1").version,
      contractStatus: store.getAcceptance("acceptance-goal", 1).status,
      evidenceId: result.evidence.id,
      evidenceRevision: result.evidence.revision,
      acceptCommandId: accepted?.commandId ?? null,
      eventCount: store.getEvents().length,
      ids: { evidenceId: result.evidence.id, verificationId: result.verification.id },
    };
  } else if (mode === "parent-read") {
    const ids = JSON.parse(idsJson ?? "{}");
    const evidence = store.getEvidence(ids.evidenceId);
    // Re-deriving the observation from durable child rows only must land on the
    // SAME evidence identity — that is what makes the snapshot revision real
    // rather than an in-process cache.
    const reobserved = store.ensureAggregateEvidence(Collection.GOAL, "goal-1");
    // …and the original acceptance command replays instead of applying twice.
    const replayed = store.acceptGoal("goal-1", 1, {
      verificationId: ids.verificationId,
      commandId: ids.acceptCommandId,
    });

    payload = {
      goalStatus: store.getGoal("goal-1").status,
      goalVersion: store.getGoal("goal-1").version,
      contractStatus: store.getAcceptance("acceptance-goal", 1).status,
      evidenceTargetType: evidence.targetType,
      evidenceTargetId: evidence.targetId,
      evidenceTaskId: evidence.taskId,
      evidenceRunId: evidence.runId,
      evidenceRevision: evidence.revision,
      reobservedId: reobserved.id,
      replayedVersion: replayed.version,
      acceptedEvents: store.getEvents().filter((event) => event.type === "goal.accepted").length,
      eventCount: store.getEvents().length,
    };
  } else if (mode === "approval") {
    // A human decision written in THIS process, as a durable control fact.
    store.seedProject(createProject({ id: "project-1", name: "Approval restart" }));
    store.seedAcceptance(createAcceptance({
      id: "acceptance-1",
      targetId: "task-1",
      criteria: [{ id: "build", type: "BUILD", required: true }],
    }));
    store.seedTask(createTask({
      id: "task-1",
      title: "approval-restart task",
      acceptanceId: "acceptance-1",
      acceptanceVersion: 1,
    }));

    const requested = store.requestApproval({
      id: "approval-1",
      targetType: ApprovalTargetType.TASK,
      targetId: "task-1",
      action: "deploy",
      capability: "deploy.production",
      scope: "production",
      riskLevel: RiskLevel.HIGH,
      requestedBy: "requester-1",
      commandId: "C1",
    }, { commandId: "child-request-approval" });
    const approved = store.decideApproval("approval-1", requested.version, {
      decision: ApprovalDecision.APPROVE,
      decidedBy: "alice",
      reason: "rollout window agreed",
    }, { commandId: "child-approve" });

    payload = {
      status: approved.decision.status,
      version: approved.version,
      targetVersion: approved.request.targetVersion,
      decidedBy: approved.decision.decidedBy,
      boundCommandId: approved.commandId,
      eventCount: store.getEvents().length,
      ids: { approvalId: "approval-1" },
    };
  } else if (mode === "approval-read") {
    const ids = JSON.parse(idsJson ?? "{}");
    const approval = store.getApproval(ids.approvalId);
    // the durable permission still authorizes in a process that never saw it
    const usable = store.assertApprovalUsable({
      approvalId: ids.approvalId,
      targetType: ApprovalTargetType.TASK,
      targetId: "task-1",
      targetVersion: 1,
      action: "deploy",
      capability: "deploy.production",
      scope: "production",
      commandId: "C1",
    });
    // the ORIGINAL approval command replays instead of deciding again
    const replayed = store.decideApproval(ids.approvalId, 1, {
      decision: ApprovalDecision.APPROVE,
      decidedBy: "alice",
    }, { commandId: "child-approve" });

    // the CAPABILITY is part of the durable permission in the new process too
    let capabilityReason = null;
    try {
      store.assertApprovalUsable({
        approvalId: ids.approvalId,
        targetType: ApprovalTargetType.TASK,
        targetId: "task-1",
        targetVersion: 1,
        action: "deploy",
        capability: "delete.production",
        scope: "production",
        commandId: "C1",
      });
    } catch (error) {
      capabilityReason = error instanceof ApprovalError ? error.approvalReason : error.name;
    }

    // …and once the target moves, the same record stops applying
    store.updateTask("task-1", 1, { status: TaskStatus.IN_PROGRESS }, { commandId: "child-move-task" });
    let staleReason = null;
    try {
      store.assertApprovalUsable({
        approvalId: ids.approvalId,
        targetType: ApprovalTargetType.TASK,
        targetId: "task-1",
        targetVersion: 1,
        action: "deploy",
        capability: "deploy.production",
        scope: "production",
        commandId: "C1",
      });
    } catch (error) {
      staleReason = error instanceof ApprovalError ? error.approvalReason : error.name;
    }

    payload = {
      status: approval.decision.status,
      decidedBy: approval.decision.decidedBy,
      version: approval.version,
      targetVersion: approval.request.targetVersion,
      usableId: usable.id,
      replayedVersion: replayed.version,
      replayedStatus: replayed.decision.status,
      approvedEvents: store.getEvents().filter((event) => event.type === "approval.approved").length,
      taskVersion: store.getTask("task-1").version,
      staleReason,
      capabilityReason,
      eventCount: store.getEvents().length,
    };
  } else {
    throw new Error(`unknown mode: ${mode}`);
  }
} finally {
  store.close();
}

console.log("RESULT " + JSON.stringify(payload));
