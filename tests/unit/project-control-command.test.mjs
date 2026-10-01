// Durable Command G2 contract.
//
// The same semantic suite runs against MemoryStore and SqliteStore. G2 owns
// durable intent + authorization only; dispatch/effect states stay reserved.
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
import {
  ApprovalDecision,
  ApprovalFailureReason,
  ApprovalTargetType,
  CommandStatus,
  CommandTargetType,
  ConflictError,
  InvariantError,
  PolicyEffect,
  RiskLevel,
  createAcceptance,
  createProject,
  createTask,
} from "../../project-control/domain.mjs";

const BACKENDS = [
  {
    name: "MemoryStore",
    skip: false,
    make() { return new MemoryStore(); },
  },
  {
    name: "SqliteStore",
    skip: isSqliteAvailable() ? false : `node:sqlite is unavailable: ${SQLITE_REQUIREMENT}`,
    make(t) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-command-"));
      const store = new SqliteStore(path.join(dir, "project-control.db"));
      t.after(() => {
        try { store.close(); } catch {}
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      });
      return store;
    },
  },
];

function seed(store) {
  store.seedProject(createProject({ id: "project-1", name: "Command world" }));
  store.seedAcceptance(createAcceptance({
    id: "acceptance-1",
    targetId: "task-1",
    criteria: [{ id: "build", type: "BUILD", required: true }],
  }));
  store.seedTask(createTask({
    id: "task-1",
    projectId: "project-1",
    title: "Command target",
    acceptanceId: "acceptance-1",
    acceptanceVersion: 1,
  }));
}

function request() {
  return {
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
  };
}

function requireApprovalPolicy(store, command, id = `policy-${command.id}`) {
  return store.recordPolicyDecision(command.id, command.version, {
    id,
    effect: PolicyEffect.REQUIRE_APPROVAL,
    policyVersion: "test-v1",
    reasons: ["test requires approval"],
    matchedRuleIds: ["require-deploy"],
    context: {},
  });
}

function approve(store, commandId = "command-1") {
  const pending = store.requestApproval({
    id: "approval-1",
    targetType: ApprovalTargetType.TASK,
    targetId: "task-1",
    action: "deploy",
    capability: "deploy.production",
    scope: "production",
    riskLevel: RiskLevel.HIGH,
    requestedBy: "requester-1",
    commandId,
  });
  return store.decideApproval(
    pending.id,
    pending.version,
    { decision: ApprovalDecision.APPROVE, decidedBy: "alice" },
  );
}

for (const backend of BACKENDS) {
  const label = (name) => `${backend.name}: ${name}`;

  test(label("creation pins current target version and persists immutable intent"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seed(store);

    const command = store.createControlCommand(request(), { mutationId: "mutation-create-1" });

    assert.equal(command.status, CommandStatus.CREATED);
    assert.equal(command.version, 1);
    assert.equal(command.targetVersion, 1);
    assert.equal(command.projectId, "project-1");
    assert.equal(command.action, "deploy");
    assert.equal(command.capability, "deploy.production");
    assert.equal(command.scope, "production");
    assert.deepEqual(command.parameters, { environment: "production" });
    assert.equal(store.getControlCommand(command.id).idempotencyKey, "deploy:task-1:v1");
    assert.equal(store.getEvents().filter((e) => e.type === "command.created").length, 1);

    const replay = store.createControlCommand(request(), { mutationId: "mutation-create-1" });
    assert.equal(replay.id, command.id);
    assert.equal(store.getEvents().filter((e) => e.type === "command.created").length, 1);
  });

  test(label("caller cannot invent a target version"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seed(store);

    assert.throws(
      () => store.createControlCommand({ ...request(), targetVersion: 7 }),
      (error) => error instanceof InvariantError && /is v1, not v7/.test(error.message),
    );
    assert.equal(store.allRecords(Collection.COMMAND).length, 0);
  });

  test(label("missing or pending approval returns WAIT without mutation"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seed(store);
    const command = store.createControlCommand(request());
    const eventsBefore = store.getEvents().length;

    assert.throws(
      () => store.authorizeControlCommand(command.id, 1),
      (error) => error instanceof InvariantError && /without a PolicyDecision/.test(error.message),
    );
    const policy = requireApprovalPolicy(store, command);
    const withoutApproval = store.authorizeControlCommand(command.id, 1, {
      policyDecisionId: policy.id,
    });
    assert.equal(withoutApproval.action, "WAIT");
    assert.equal(withoutApproval.reason, "approval-required");
    assert.equal(withoutApproval.command.id, command.id);
    assert.equal(store.getControlCommand(command.id).version, 1);
    assert.equal(
      store.getEvents().filter((event) => event.type === "policy.decided").length,
      1,
      "WAIT records the policy audit fact but does not mutate Command",
    );
    assert.equal(store.getEvents().length, eventsBefore + 1);

    store.requestApproval({
      id: "approval-1",
      targetType: ApprovalTargetType.TASK,
      targetId: "task-1",
      action: "deploy",
      capability: "deploy.production",
      scope: "production",
      requestedBy: "requester-1",
      commandId: command.id,
    });
    const pending = store.authorizeControlCommand(command.id, 1, {
      policyDecisionId: policy.id,
      approvalId: "approval-1",
    });
    assert.equal(pending.action, "WAIT");
    assert.equal(pending.reason, "approval-pending");
    assert.equal(pending.approvalReason, ApprovalFailureReason.PENDING);
    assert.equal(store.getControlCommand(command.id).version, 1);
  });

  test(label("usable approval transitions CREATED to AUTHORIZED once"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seed(store);
    const command = store.createControlCommand(request());
    approve(store, command.id);
    const policy = requireApprovalPolicy(store, command);

    const result = store.authorizeControlCommand(
      command.id,
      1,
      { policyDecisionId: policy.id, approvalId: "approval-1" },
      { mutationId: "mutation-authorize-1" },
    );

    assert.equal(result.action, "AUTHORIZE");
    assert.equal(result.command.status, CommandStatus.AUTHORIZED);
    assert.equal(result.command.version, 2);
    assert.equal(result.command.authorization.approvalId, "approval-1");
    assert.equal(store.getEvents().filter((e) => e.type === "command.authorized").length, 1);

    const replay = store.authorizeControlCommand(
      command.id,
      1,
      { policyDecisionId: policy.id, approvalId: "approval-1" },
      { mutationId: "mutation-authorize-1" },
    );
    assert.equal(replay.action, "AUTHORIZE");
    assert.equal(replay.command.version, 2);
    assert.equal(store.getEvents().filter((e) => e.type === "command.authorized").length, 1);
  });

  test(label("target movement rejects instead of rebinding the command"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seed(store);
    const command = store.createControlCommand(request());
    store.updateTask("task-1", 1, { status: "IN_PROGRESS" }, { commandId: "move-task" });

    const result = store.authorizeControlCommand(command.id, 1, { approvalId: "approval-missing" });

    assert.equal(result.action, "REJECT");
    assert.equal(result.reason, "target-stale");
    assert.equal(result.command.status, CommandStatus.REJECTED);
    assert.equal(result.command.targetVersion, 1);
    assert.equal(result.command.version, 2);
  });

  test(label("approval mismatch is a durable rejection, not caller substitution"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seed(store);
    const command = store.createControlCommand(request());

    const pending = store.requestApproval({
      id: "approval-1",
      targetType: ApprovalTargetType.TASK,
      targetId: "task-1",
      action: "deploy",
      capability: "delete.production",
      scope: "production",
      requestedBy: "requester-1",
      commandId: command.id,
    });
    store.decideApproval(pending.id, pending.version, {
      decision: ApprovalDecision.APPROVE,
      decidedBy: "alice",
    });

    const policy = requireApprovalPolicy(store, command);
    const result = store.authorizeControlCommand(command.id, 1, {
      policyDecisionId: policy.id,
      approvalId: pending.id,
    });

    assert.equal(result.action, "REJECT");
    assert.equal(result.reason, "approval-capability-mismatch");
    assert.equal(result.approvalReason, ApprovalFailureReason.CAPABILITY_MISMATCH);
    assert.equal(result.command.status, CommandStatus.REJECTED);
    assert.equal(result.command.capability, "deploy.production");
  });

  test(label("command optimistic concurrency is independent"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seed(store);
    const command = store.createControlCommand(request());

    assert.throws(
      () => store.authorizeControlCommand(command.id, 9),
      (error) => error instanceof ConflictError && /expected v9, current v1/.test(error.message),
    );
    assert.equal(store.getControlCommand(command.id).status, CommandStatus.CREATED);
  });

  test(label("G2 rules never write reserved dispatch/effect states"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seed(store);
    const command = store.createControlCommand(request());

    // There is intentionally no public transition API for these states.
    for (const status of [
      CommandStatus.DISPATCHED,
      CommandStatus.EXECUTING,
      CommandStatus.SUCCEEDED,
      CommandStatus.FAILED,
      CommandStatus.UNKNOWN,
    ]) {
      assert.notEqual(store.getControlCommand(command.id).status, status);
    }
    assert.equal(typeof store.dispatchControlCommand, "undefined");
    assert.equal(typeof store.completeControlCommand, "undefined");
  });
}
