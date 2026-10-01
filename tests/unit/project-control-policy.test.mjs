// Policy / Approval composition G4 contract.
//
// Policy decides whether a durable Command is ALLOW / DENY / REQUIRE_APPROVAL.
// Approval is only the human permission fact that may satisfy REQUIRE_APPROVAL.
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
import { StaticPolicyEngine } from "../../project-control/policy-engine.mjs";
import { FakeRuntime } from "../../project-control/fake-runtime.mjs";
import { FakeVerifier } from "../../project-control/fake-verifier.mjs";
import {
  ApprovalDecision,
  ApprovalTargetType,
  CommandStatus,
  CommandTargetType,
  InvariantError,
  PolicyEffect,
  RiskLevel,
  VerificationVerdict,
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
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-policy-"));
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
  store.seedProject(createProject({ id: "project-1", name: "Policy world" }));
  store.seedAcceptance(createAcceptance({
    id: "acceptance-1",
    targetId: "task-1",
    criteria: [{ id: "build", type: "BUILD", required: true }],
  }));
  store.seedTask(createTask({
    id: "task-1",
    projectId: "project-1",
    title: "Policy target",
    acceptanceId: "acceptance-1",
    acceptanceVersion: 1,
  }));
}

function command(store, over = {}) {
  return store.createControlCommand({
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
    ...over,
  });
}

function approval(store, commandId = "command-1", { decide = true } = {}) {
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
  if (!decide) return pending;
  return store.decideApproval(pending.id, pending.version, {
    decision: ApprovalDecision.APPROVE,
    decidedBy: "alice",
  });
}

function controllerFor(store, policyEngine) {
  const runtime = new FakeRuntime({ mode: "success" });
  let n = 0;
  const controller = new Controller({
    store,
    runtime,
    verifier: new FakeVerifier({ verdict: VerificationVerdict.PASS }),
    policyEngine,
    idFactory: (prefix) => `${prefix}-${++n}`,
  });
  return { controller, runtime };
}

function engine(effect, {
  version = "policy-v1",
  id = "rule-1",
  extraRules = [],
} = {}) {
  return new StaticPolicyEngine({
    version,
    rules: [{
      id,
      effect,
      targetType: CommandTargetType.TASK,
      action: "deploy",
      capability: "deploy.production",
      scope: "production",
      riskLevel: RiskLevel.HIGH,
      reason: `${effect} deploy`,
    }, ...extraRules],
  });
}

test("StaticPolicyEngine defaults to DENY when no rule matches", () => {
  const store = new MemoryStore();
  seed(store);
  const cmd = command(store);
  const target = store.getTask("task-1");
  const policy = new StaticPolicyEngine({ version: "default-deny-v1" });

  const result = policy.evaluate({ command: cmd, target });

  assert.equal(result.effect, PolicyEffect.DENY);
  assert.equal(result.policyVersion, "default-deny-v1");
  assert.deepEqual(result.matchedRuleIds, []);
  assert.match(result.reasons[0], /default/i);
});

test("StaticPolicyEngine composes DENY > REQUIRE_APPROVAL > ALLOW independent of rule order", () => {
  const store = new MemoryStore();
  seed(store);
  const cmd = command(store);
  const target = store.getTask("task-1");

  const effects = [PolicyEffect.ALLOW, PolicyEffect.REQUIRE_APPROVAL, PolicyEffect.DENY];
  for (const order of [effects, [...effects].reverse()]) {
    const policy = new StaticPolicyEngine({
      version: "precedence-v1",
      rules: order.map((effect, index) => ({
        id: `${effect}-${index}`,
        effect,
        action: "deploy",
        capability: "deploy.production",
      })),
    });
    assert.equal(policy.evaluate({ command: cmd, target }).effect, PolicyEffect.DENY);
  }
});

for (const backend of BACKENDS) {
  const label = (name) => `${backend.name}: ${name}`;

  test(label("authorization without PolicyDecision is impossible"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seed(store);
    const cmd = command(store);
    approval(store, cmd.id);

    assert.throws(
      () => store.authorizeControlCommand(cmd.id, cmd.version, { approvalId: "approval-1" }),
      (error) => error instanceof InvariantError && /without a PolicyDecision/.test(error.message),
    );
    assert.equal(store.getControlCommand(cmd.id).status, CommandStatus.CREATED);
  });

  test(label("PolicyDecision request is bound to stored Command facts"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seed(store);
    const cmd = command(store);

    assert.throws(
      () => store.recordPolicyDecision(cmd.id, cmd.version, {
        id: "policy-1",
        effect: PolicyEffect.ALLOW,
        policyVersion: "policy-v1",
        reasons: ["allow"],
        matchedRuleIds: ["allow-1"],
        request: {
          subject: { id: cmd.requestedBy },
          command: {
            id: cmd.id,
            version: cmd.version,
            targetType: cmd.targetType,
            targetId: cmd.targetId,
            targetVersion: cmd.targetVersion,
            action: "delete",
            capability: cmd.capability,
            scope: cmd.scope,
            riskLevel: cmd.riskLevel,
          },
        },
      }),
      (error) => error instanceof InvariantError && /mismatches stored action/.test(error.message),
    );
    assert.equal(store.allRecords(Collection.POLICY_DECISION).length, 0);
  });

  test(label("DENY rejects even when a valid Approval exists"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seed(store);
    const cmd = command(store);
    approval(store, cmd.id);
    const decision = store.recordPolicyDecision(cmd.id, cmd.version, {
      id: "policy-deny",
      effect: PolicyEffect.DENY,
      policyVersion: "policy-v1",
      reasons: ["production deploy denied"],
      matchedRuleIds: ["deny-production"],
    });

    const result = store.authorizeControlCommand(cmd.id, cmd.version, {
      policyDecisionId: decision.id,
      approvalId: "approval-1",
    });

    assert.equal(result.action, "REJECT");
    assert.equal(result.reason, "policy-denied");
    assert.equal(result.command.status, CommandStatus.REJECTED);
    assert.equal(result.command.authorization.policyDecisionId, decision.id);
    assert.equal(result.command.authorization.approvalId, null, "Approval cannot override DENY");
  });

  test(label("ALLOW authorizes without manufacturing Approval"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seed(store);
    const cmd = command(store);
    const decision = store.recordPolicyDecision(cmd.id, cmd.version, {
      id: "policy-allow",
      effect: PolicyEffect.ALLOW,
      policyVersion: "policy-v1",
      reasons: ["explicit allow"],
      matchedRuleIds: ["allow-deploy"],
    });

    const result = store.authorizeControlCommand(cmd.id, cmd.version, {
      policyDecisionId: decision.id,
    });

    assert.equal(result.action, "AUTHORIZE");
    assert.equal(result.command.status, CommandStatus.AUTHORIZED);
    assert.equal(result.command.authorization.policyDecisionId, decision.id);
    assert.equal(result.command.authorization.approvalId, null);
    assert.equal(store.allRecords(Collection.APPROVAL).length, 0);
  });

  test(label("REQUIRE_APPROVAL waits, then usable Approval authorizes"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seed(store);
    const cmd = command(store);
    const decision = store.recordPolicyDecision(cmd.id, cmd.version, {
      id: "policy-require",
      effect: PolicyEffect.REQUIRE_APPROVAL,
      policyVersion: "policy-v1",
      reasons: ["human permission required"],
      matchedRuleIds: ["require-prod"],
    });

    const noApproval = store.authorizeControlCommand(cmd.id, cmd.version, {
      policyDecisionId: decision.id,
    });
    assert.equal(noApproval.action, "WAIT");
    assert.equal(noApproval.reason, "approval-required");
    assert.equal(store.getControlCommand(cmd.id).version, 1);

    approval(store, cmd.id, { decide: false });
    const pending = store.authorizeControlCommand(cmd.id, cmd.version, {
      policyDecisionId: decision.id,
      approvalId: "approval-1",
    });
    assert.equal(pending.action, "WAIT");
    assert.equal(pending.reason, "approval-pending");
    assert.equal(store.getControlCommand(cmd.id).status, CommandStatus.CREATED);

    store.decideApproval("approval-1", 1, {
      decision: ApprovalDecision.APPROVE,
      decidedBy: "alice",
    });
    const authorized = store.authorizeControlCommand(cmd.id, cmd.version, {
      policyDecisionId: decision.id,
      approvalId: "approval-1",
    });
    assert.equal(authorized.action, "AUTHORIZE");
    assert.equal(authorized.command.authorization.policyDecisionId, decision.id);
    assert.equal(authorized.command.authorization.approvalId, "approval-1");
  });

  test(label("PolicyDecision is immutable audit history"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seed(store);
    const cmd = command(store);
    const first = store.recordPolicyDecision(cmd.id, cmd.version, {
      id: "policy-1",
      effect: PolicyEffect.REQUIRE_APPROVAL,
      policyVersion: "policy-v1",
      reasons: ["first decision"],
      matchedRuleIds: ["r1"],
    });

    assert.throws(
      () => store.recordPolicyDecision(cmd.id, cmd.version, {
        id: "policy-1",
        effect: PolicyEffect.ALLOW,
        policyVersion: "policy-v2",
        reasons: ["rewrite"],
        matchedRuleIds: ["r2"],
      }),
      /policy decision already exists/,
    );
    assert.deepEqual(store.getPolicyDecision("policy-1"), first);
    assert.equal(typeof store.updatePolicyDecision, "undefined");
  });
}

test("Controller derives PolicyRequest from durable Command and ALLOW needs no Approval", () => {
  const store = new MemoryStore();
  seed(store);
  const cmd = command(store);
  const { controller, runtime } = controllerFor(store, engine(PolicyEffect.ALLOW));

  const result = controller.authorizeCommand(cmd.id, cmd.version, {
    // no action/capability/scope are accepted by this API
    policyContext: { source: "unit-test" },
  });

  assert.equal(result.action, "AUTHORIZE");
  assert.equal(result.command.authorization.approvalId, null);
  assert.ok(result.command.authorization.policyDecisionId);
  const decision = store.getPolicyDecision(result.command.authorization.policyDecisionId);
  assert.equal(decision.commandId, cmd.id);
  assert.equal(decision.subjectId, "requester-1");
  assert.equal(decision.effect, PolicyEffect.ALLOW);
  assert.equal(decision.context.source, "unit-test");
  assert.equal(runtime.started.length, 0, "policy authorization is not runtime execution");
  assert.equal(store.allRecords(Collection.EFFECT).length, 0, "policy authorization creates no Effect");
});

test("Controller DENY cannot be overridden by presenting an Approval", () => {
  const store = new MemoryStore();
  seed(store);
  const cmd = command(store);
  approval(store, cmd.id);
  const { controller } = controllerFor(store, engine(PolicyEffect.DENY));

  const result = controller.authorizeCommand(cmd.id, cmd.version, {
    approvalId: "approval-1",
  });

  assert.equal(result.action, "REJECT");
  assert.equal(result.reason, "policy-denied");
  assert.equal(result.command.authorization.approvalId, null);
});

test("Controller re-evaluates policy after WAIT instead of reusing old decision", () => {
  const store = new MemoryStore();
  seed(store);
  const cmd = command(store);
  const { controller } = controllerFor(store, engine(PolicyEffect.REQUIRE_APPROVAL, {
    version: "policy-v1",
  }));

  const first = controller.authorizeCommand(cmd.id, cmd.version);
  assert.equal(first.action, "WAIT");
  assert.equal(store.getControlCommand(cmd.id).status, CommandStatus.CREATED);

  controller.policyEngine = engine(PolicyEffect.ALLOW, {
    version: "policy-v2",
    id: "allow-v2",
  });
  const second = controller.authorizeCommand(cmd.id, cmd.version);

  assert.equal(second.action, "AUTHORIZE");
  const decisions = store.getPolicyDecisionsForCommand(cmd.id);
  assert.equal(decisions.length, 2);
  assert.deepEqual(decisions.map((d) => d.policyVersion), ["policy-v1", "policy-v2"]);
  assert.equal(second.command.authorization.policyDecisionId, decisions[1].id);
});
