// Durable Effect G3 contract.
//
// The same store semantics run against MemoryStore and SqliteStore. Controller
// tests exercise the persist-before-dispatch and reconciliation boundary.
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
import { FakeEffectDriver } from "../../project-control/fake-effect-driver.mjs";
import {
  ApprovalDecision,
  ApprovalTargetType,
  CommandTargetType,
  EffectObservation,
  EffectReconciliationStatus,
  EffectStatus,
  InvariantError,
  RiskLevel,
  TaskStatus,
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
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-effect-"));
      const store = new SqliteStore(path.join(dir, "project-control.db"));
      t.after(() => {
        try { store.close(); } catch {}
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      });
      return store;
    },
  },
];

function seedWorld(store) {
  store.seedProject(createProject({ id: "project-1", name: "Effect world" }));
  store.seedAcceptance(createAcceptance({
    id: "acceptance-1",
    targetId: "task-1",
    criteria: [{ id: "build", type: "BUILD", required: true }],
  }));
  store.seedTask(createTask({
    id: "task-1",
    projectId: "project-1",
    title: "Effect target",
    acceptanceId: "acceptance-1",
    acceptanceVersion: 1,
  }));
}

function createAuthorizedCommand(store, id = "command-1") {
  const command = store.createControlCommand({
    id,
    targetType: CommandTargetType.TASK,
    targetId: "task-1",
    action: "deploy",
    capability: "deploy.production",
    scope: "production",
    riskLevel: RiskLevel.HIGH,
    requestedBy: "requester-1",
    expectedVersion: 1,
    parameters: { environment: "production" },
    idempotencyKey: `deploy:task-1:v1:${id}`,
  });
  const pending = store.requestApproval({
    id: `approval-${id}`,
    targetType: ApprovalTargetType.TASK,
    targetId: "task-1",
    action: "deploy",
    capability: "deploy.production",
    scope: "production",
    riskLevel: RiskLevel.HIGH,
    requestedBy: "requester-1",
    commandId: command.id,
  });
  store.decideApproval(pending.id, pending.version, {
    decision: ApprovalDecision.APPROVE,
    decidedBy: "alice",
  });
  return store.authorizeControlCommand(command.id, command.version, { approvalId: pending.id }).command;
}

function controllerFor(store, effectDriver) {
  return new Controller({
    store,
    runtime: new FakeRuntime({ mode: "success" }),
    verifier: new FakeVerifier({ verdict: VerificationVerdict.PASS }),
    effectDriver,
  });
}

for (const backend of BACKENDS) {
  const label = (name) => `${backend.name}: ${name}`;

  test(label("Effect cannot be created from a non-AUTHORIZED Command"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    const command = store.createControlCommand({
      id: "command-1",
      targetType: CommandTargetType.TASK,
      targetId: "task-1",
      action: "deploy",
      capability: "deploy.production",
      scope: "production",
      requestedBy: "requester-1",
      expectedVersion: 1,
      idempotencyKey: "deploy:task-1:v1",
    });

    assert.throws(
      () => store.createEffectFromCommand({
        id: "effect-1",
        commandId: command.id,
        destination: "production",
      }),
      (error) => error instanceof InvariantError && /requires an AUTHORIZED command/.test(error.message),
    );
    assert.equal(store.allRecords(Collection.EFFECT).length, 0);
  });

  test(label("Effect copies action/capability from stored Command"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    const command = createAuthorizedCommand(store);

    const effect = store.createEffectFromCommand({
      id: "effect-1",
      commandId: command.id,
      destination: "production",
    });

    assert.equal(effect.status, EffectStatus.REQUESTED);
    assert.equal(effect.version, 1);
    assert.equal(effect.commandId, command.id);
    assert.equal(effect.action, "deploy");
    assert.equal(effect.capability, "deploy.production");
    assert.equal(effect.idempotencyKey, command.idempotencyKey);
    assert.equal(effect.reconciliation.status, EffectReconciliationStatus.NOT_REQUIRED);
    assert.equal(store.getEffectsForCommand(command.id).length, 1);
    assert.equal(store.getEvents().filter((e) => e.type === "effect.requested").length, 1);
  });

  test(label("DISPATCHED is durable uncertainty, not success"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    const command = createAuthorizedCommand(store);
    const effect = store.createEffectFromCommand({
      id: "effect-1",
      commandId: command.id,
      destination: "production",
    });

    const dispatched = store.markEffectDispatched(effect.id, effect.version);

    assert.equal(dispatched.status, EffectStatus.DISPATCHED);
    assert.equal(dispatched.dispatchCount, 1);
    assert.equal(dispatched.reconciliation.status, EffectReconciliationStatus.REQUIRED);
    assert.equal(store.getEffect(effect.id).status, EffectStatus.DISPATCHED);
  });

  test(label("explicit observations distinguish success, no-effect and unknown"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);

    const successCommand = createAuthorizedCommand(store, "command-success");
    let effect = store.createEffectFromCommand({
      id: "effect-success",
      commandId: successCommand.id,
      destination: "production",
    });
    effect = store.markEffectDispatched(effect.id, effect.version);
    effect = store.recordEffectOutcome(effect.id, effect.version, {
      outcome: EffectObservation.CONFIRMED_SUCCEEDED,
      observationRef: "provider-query://success",
      receipt: { provider: "fake", receiptId: "r-1", resultRef: "result://1" },
    });
    assert.equal(effect.status, EffectStatus.SUCCEEDED);
    assert.equal(effect.reconciliation.status, EffectReconciliationStatus.NOT_REQUIRED);

    const noCommand = createAuthorizedCommand(store, "command-no-effect");
    let noEffect = store.createEffectFromCommand({
      id: "effect-no-effect",
      commandId: noCommand.id,
      destination: "production",
    });
    noEffect = store.markEffectDispatched(noEffect.id, noEffect.version);
    noEffect = store.recordEffectOutcome(noEffect.id, noEffect.version, {
      outcome: EffectObservation.CONFIRMED_NO_EFFECT,
      observationRef: "provider-query://not-found",
    });
    assert.equal(noEffect.status, EffectStatus.FAILED_NO_EFFECT);

    const unknownCommand = createAuthorizedCommand(store, "command-unknown");
    let unknown = store.createEffectFromCommand({
      id: "effect-unknown",
      commandId: unknownCommand.id,
      destination: "production",
    });
    unknown = store.markEffectDispatched(unknown.id, unknown.version);
    unknown = store.recordEffectOutcome(unknown.id, unknown.version, {
      outcome: EffectObservation.UNKNOWN,
    });
    assert.equal(unknown.status, EffectStatus.UNKNOWN);
    assert.equal(unknown.reconciliation.status, EffectReconciliationStatus.REQUIRED);
  });

  test(label("UNKNOWN cannot be redispatched; FAILED_NO_EFFECT can be re-requested"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);

    const c1 = createAuthorizedCommand(store, "command-unknown");
    let unknown = store.createEffectFromCommand({ id: "effect-unknown", commandId: c1.id, destination: "production" });
    unknown = store.markEffectDispatched(unknown.id, unknown.version);
    unknown = store.recordEffectOutcome(unknown.id, unknown.version, { outcome: EffectObservation.UNKNOWN });

    assert.throws(
      () => store.rerequestEffect(unknown.id, unknown.version),
      (error) => error instanceof InvariantError && /may not perform rerequestEffect/.test(error.message),
    );

    const c2 = createAuthorizedCommand(store, "command-no-effect");
    let noEffect = store.createEffectFromCommand({ id: "effect-no-effect", commandId: c2.id, destination: "production" });
    noEffect = store.markEffectDispatched(noEffect.id, noEffect.version);
    noEffect = store.recordEffectOutcome(noEffect.id, noEffect.version, {
      outcome: EffectObservation.CONFIRMED_NO_EFFECT,
      observationRef: "provider-query://absent",
    });
    const retriable = store.rerequestEffect(noEffect.id, noEffect.version);
    assert.equal(retriable.status, EffectStatus.REQUESTED);
    assert.equal(retriable.dispatchCount, 1, "history count is not erased");
  });

  test(label("reconciliation resolves UNKNOWN only from typed observation"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    const command = createAuthorizedCommand(store);
    let effect = store.createEffectFromCommand({ id: "effect-1", commandId: command.id, destination: "production" });
    effect = store.markEffectDispatched(effect.id, effect.version);
    effect = store.recordEffectOutcome(effect.id, effect.version, { outcome: EffectObservation.UNKNOWN });

    const started = store.beginEffectReconciliation(effect.id, effect.version);
    assert.equal(started.status, EffectStatus.UNKNOWN);
    assert.equal(started.reconciliation.status, EffectReconciliationStatus.IN_PROGRESS);

    assert.throws(
      () => store.applyEffectReconciliation(started.id, started.version, {
        outcome: EffectObservation.CONFIRMED_SUCCEEDED,
        receipt: { provider: "fake", receiptId: "r-1" },
      }),
      /cannot resolve without an observation reference/,
    );

    const resolved = store.applyEffectReconciliation(started.id, started.version, {
      outcome: EffectObservation.CONFIRMED_SUCCEEDED,
      observationRef: "provider-query://effect-1",
      receipt: { provider: "fake", receiptId: "r-1" },
    });
    assert.equal(resolved.status, EffectStatus.SUCCEEDED);
    assert.equal(resolved.reconciliation.status, EffectReconciliationStatus.RESOLVED);
    assert.equal(resolved.reconciliation.observationRef, "provider-query://effect-1");
  });
}

test("Controller persists DISPATCHED before crossing the driver boundary", async () => {
  const store = new MemoryStore();
  seedWorld(store);
  const command = createAuthorizedCommand(store);
  const driver = new FakeEffectDriver({ mode: "success" });
  const controller = controllerFor(store, driver);

  const result = await controller.dispatchEffect({
    id: "effect-1",
    commandId: command.id,
    destination: "production",
  }, { mutationId: "dispatch-op-1" });

  assert.equal(driver.dispatched.length, 1);
  assert.equal(driver.dispatched[0].status, EffectStatus.DISPATCHED);
  assert.equal(driver.dispatched[0].dispatchCount, 1);
  assert.equal(result.status, EffectStatus.SUCCEEDED);
  assert.equal(store.getEvents().filter((e) => e.type === "effect.dispatched").length, 1);
  assert.equal(store.getTask("task-1").status, TaskStatus.READY, "Effect never accepts the Task");
  assert.equal(store.allRecords(Collection.EVIDENCE).length, 0, "Effect receipt is not Evidence");
});

test("Controller turns a throwing/ambiguous dispatch into UNKNOWN and blocks retry", async () => {
  const store = new MemoryStore();
  seedWorld(store);
  const command = createAuthorizedCommand(store);
  const driver = new FakeEffectDriver({ mode: "throw" });
  const controller = controllerFor(store, driver);

  const unknown = await controller.dispatchEffect({
    id: "effect-1",
    commandId: command.id,
    destination: "production",
  });

  assert.equal(unknown.status, EffectStatus.UNKNOWN);
  assert.equal(unknown.reconciliation.status, EffectReconciliationStatus.REQUIRED);
  await assert.rejects(
    () => controller.retryEffect(unknown.id, unknown.version),
    /may not perform rerequestEffect/,
  );
  assert.equal(driver.dispatched.length, 1, "UNKNOWN was never blindly redispatched");
});

test("Controller reconciles UNKNOWN by observation, not retry", async () => {
  const store = new MemoryStore();
  seedWorld(store);
  const command = createAuthorizedCommand(store);
  const driver = new FakeEffectDriver({
    mode: "unknown",
    reconcileOutcome: EffectObservation.CONFIRMED_SUCCEEDED,
  });
  const controller = controllerFor(store, driver);

  const unknown = await controller.dispatchEffect({
    id: "effect-1",
    commandId: command.id,
    destination: "production",
  });
  assert.equal(unknown.status, EffectStatus.UNKNOWN);
  assert.equal(driver.dispatched.length, 1);

  const resolved = await controller.reconcileEffect(unknown.id, unknown.version, { mutationId: "reconcile-1" });

  assert.equal(resolved.status, EffectStatus.SUCCEEDED);
  assert.equal(resolved.reconciliation.status, EffectReconciliationStatus.RESOLVED);
  assert.ok(resolved.reconciliation.observationRef);
  assert.equal(driver.dispatched.length, 1, "reconciliation did not re-dispatch");
  assert.equal(driver.reconciled.length, 1);
});

test("whole dispatch operation is replay-safe with a mutation identity", async () => {
  const store = new MemoryStore();
  seedWorld(store);
  const command = createAuthorizedCommand(store);
  const driver = new FakeEffectDriver({ mode: "success" });
  const controller = controllerFor(store, driver);

  const first = await controller.dispatchEffect({
    id: "effect-1",
    commandId: command.id,
    destination: "production",
  }, { mutationId: "effect-op-1" });
  const second = await controller.dispatchEffect({
    id: "effect-1",
    commandId: command.id,
    destination: "production",
  }, { mutationId: "effect-op-1" });

  assert.equal(first.status, EffectStatus.SUCCEEDED);
  assert.equal(second.status, EffectStatus.SUCCEEDED);
  assert.equal(driver.dispatched.length, 1, "replaying the control operation does not call the provider twice");
  assert.equal(store.getEvents().filter((e) => e.type === "effect.dispatched").length, 1);
  assert.equal(store.getEvents().filter((e) => e.type === "effect.succeeded").length, 1);
});
