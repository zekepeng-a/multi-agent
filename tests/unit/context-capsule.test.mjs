import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../../project-control/memory-store.mjs";
import { SqliteStore, isSqliteAvailable, SQLITE_REQUIREMENT } from "../../project-control/sqlite-store.mjs";
import { canonicalCapsuleJson, capsuleHash } from "../../project-control/capsule-json.mjs";
import { CapsuleInputRefusedError } from "../../project-control/capsule-receipt.mjs";
import { FakeRuntime } from "../../project-control/fake-runtime.mjs";
import { Controller } from "../../project-control/controller.mjs";
import { FakeVerifier } from "../../project-control/fake-verifier.mjs";
import { ReconcileOutcome } from "../../project-control/domain.mjs";
import { createAcceptance, createGoal, createMilestone, createAttempt, createRun, createTask } from "../../project-control/domain.mjs";
import { capsules, capsuleBoundary, seedCapsuleFixture, generate, reserve, dispatch, generateInput, fixedTime } from "../helpers/pc-capsule-fixture.mjs";
import { seedMemoryFixture, boundary, promote, candidate, inferred, decisionInput } from "../helpers/pc-memory-fixture.mjs";

for (const backend of ["MemoryStore", "SQLite"]) {
  const options = { skip: backend === "SQLite" && !isSqliteAvailable() ? SQLITE_REQUIREMENT : false };
  function fixture(t, overrides = {}, memory = false) {
    const store = backend === "SQLite" ? new SqliteStore(":memory:") : new MemoryStore();
    t.after(() => store.close?.());
    if (memory) seedMemoryFixture(store);
    seedCapsuleFixture(store);
    const control = capsules(store, overrides);
    return { store, control, runtime: control.runtime };
  }
  test(`${backend}: immutable canonical archive has typed complete sources and independent binding`, options, t => {
    const { store, control } = fixture(t), record = generate(control);
    assert.equal(capsuleHash(record.payloadJson), record.payloadHash);
    assert.equal(Buffer.byteLength(record.payloadJson, "utf8"), record.byteLength);
    assert.equal(canonicalCapsuleJson(record.payload), record.payloadJson);
    assert.equal(record.attemptId, "cat"); assert.notEqual(record.id, record.attemptId);
    assert.deepEqual(record.payload.sources.map(s => s.type).sort(), ["ACCEPTANCE", "DECISION", "POLICY", "PROJECT", "REALITY", "RUNTIME", "TASK", "WORKSPACE"]);
    for (const s of record.payload.sources) {
      assert.equal(s.projectId, ["POLICY", "RUNTIME"].includes(s.type) ? null : "p");
      if (["POLICY", "RUNTIME"].includes(s.type)) assert.equal(s.executionBinding.projectId, "p");
      assert.ok(s.id && s.pin.fingerprint && s.authority && s.provenance && s.validityObservation.observedAt);
      assert.equal(s.role, "REQUIRED");
    }
    record.payload.sources[0].content.criteria = [];
    assert.notDeepEqual(control.history(record.id).payload, record.payload);
    assert.throws(() => store.putRecord("context_capsule", record.id, record), /immutable/);
    assert.throws(() => store.updateRecord("context_capsule", record.id, record, 1), /immutable/);
    assert.throws(() => store.updateAttempt("cat", { capsuleDelivery: { status: "RECEIVED" } }), /trusted Capsule/);
    assert.equal(store.getAttempt("cat").capsuleDelivery.status, "PREPARED");
  });
  test(`${backend}: hierarchy and cross-project source admission fail closed`, options, t => {
    const { store, control, runtime } = fixture(t);
    assert.throws(() => control.generate({ ...generateInput, projectId: "other" }, { commandId: "wrong-owner" }), /binding/);
    const foreign = capsules(store, { additionalSources: () => [{ type: "PROJECT", id: "other", role: "SUPPLEMENTAL" }] });
    assert.throws(() => generate(foreign), /cross-project/);
    store.seedMilestone(createMilestone({ id: "ml", projectId: "other", name: "Foreign milestone" }));
    // Deliberately bypass the Store's relationship guard to test Capsule defense.
    store.putRecord("goal", "g", createGoal({ id: "g", projectId: "p", milestoneId: "ml", title: "Goal" }));
    store.updateTask("ct", 2, { goalId: "g" });
    assert.throws(() => generate(control), /cross-project hierarchy/);
    assert.equal(runtime.started.length, 0);
  });
  test(`${backend}: exact Task contract pin; newer unbound revision is never substituted`, options, t => {
    const { store, control } = fixture(t);
    store.seedAcceptance(createAcceptance({ id: "ca", targetId: "ct", version: 2, criteria: ["new contract"] }));
    const record = generate(control);
    assert.equal(record.payload.sources.find(s => s.type === "ACCEPTANCE").pin.version, 1);
    reserve(control);
    const wrong = fixture(t, { additionalSources: () => [{ type: "ACCEPTANCE", id: "ca", version: 2, role: "REQUIRED" }] });
    wrong.store.seedAcceptance(createAcceptance({ id: "ca", targetId: "ct", version: 2 }));
    assert.throws(() => generate(wrong.control), /wrong pinned contract/);
  });
  for (const drift of ["task", "decision-membership", "workspace-reality", "policy", "runtime"]) {
    test(`${backend}: ${drift} drift prevents start before reservation`, options, async t => {
      let reality = "reality-1", policyVersion = "1", runtimeVersion = "1";
      const { store, control, runtime } = fixture(t, {
        observeWorkspace: () => ({ status: "CURRENT", revision: reality, observationRef: "reality", observedAt: fixedTime }),
        policyContext: b => ({ id: "policy", version: policyVersion, status: "CURRENT", binding: b, restrictions: [], approvalRequests: [], provenance: {}, observationRef: "policy", observedAt: fixedTime }),
        runtimeContext: b => ({ id: "runtime", version: runtimeVersion, adapterId: "fake-runtime", status: "CURRENT", binding: b, restrictions: [], provenance: {}, observationRef: "runtime", observedAt: fixedTime }),
      });
      generate(control);
      if (drift === "task") store.updateTask("ct", 2, { title: "changed" });
      if (drift === "decision-membership") store.createProjectDecision(decisionInput({ id: "new", title: "New necessary direction" }));
      if (drift === "workspace-reality") reality = "reality-2";
      if (drift === "policy") policyVersion = "2";
      if (drift === "runtime") runtimeVersion = "2";
      await assert.rejects(dispatch(control), /drift|unresolved/);
      assert.equal(runtime.started.length, 0); assert.equal(store.getAttempt("cat").capsuleDelivery.status, "PREPARED");
      assert.equal(store.getCommand("dispatch-1"), null);
    });
  }
  test(`${backend}: unsupported/unresolved required inputs and unknown profile fail closed`, options, t => {
    const { store } = fixture(t);
    for (const override of [{ additionalSources: () => [{ type: "GRAPH", id: "x", role: "REQUIRED" }] },
      { observeWorkspace: () => ({ status: "UNRESOLVED" }) }, { policyContext: () => ({ status: "UNKNOWN" }) },
      { additionalSources: () => [{ type: "EVIDENCE", id: "missing", role: "REQUIRED" }] }]) {
      assert.throws(() => generate(capsules(store, override)), /unsupported|unresolved|missing/);
    }
    assert.throws(() => capsules(store, { profile: { id: "bad", version: "1", assemblerVersion: "1", maxBytes: 0 } }), /positive byte/);
  });
  test(`${backend}: necessary Memory validity and INFERRED opt-in; no history escape`, options, t => {
    const { store, control } = fixture(t, {}, true);
    const memoryControl = boundary(store);
    promote(memoryControl, candidate(store), "accepted-memory");
    promote(memoryControl, inferred(store), "inferred-memory");
    const first = generate(control);
    assert.deepEqual(first.payload.sources.filter(s => s.type === "MEMORY").map(s => s.id), ["accepted-memory"]);
    const opt = capsules(store, { profile: { ...control.profile, includeInferred: true } });
    const second = opt.generate({ ...generateInput, id: "capsule-2" }, { commandId: "generate-2" });
    assert.equal(second.payload.profile.includeInferred, true);
    assert.equal(second.payload.sources.filter(s => s.type === "MEMORY").length, 2);
    assert.ok(second.payload.sources.find(s => s.id === "inferred-memory").content.assumptions.length);
    assert.throws(() => capsules(store, { additionalSources: () => [{ type: "MEMORY", id: "accepted-memory", role: "REQUIRED", useScope: "HISTORY" }] }).generate(
      { ...generateInput, id: "history-escape" }, { commandId: "history-escape" }), /history/);
    memoryControl.withdraw("accepted-memory", 1, "withdrawn", { commandId: "withdraw" });
    assert.throws(() => opt.reserve({ capsuleId: "capsule-2", attemptId: "cat", expectedDeliveryVersion: 2 }, { commandId: "stale-supplemental" }), /not ADR-0008/);
    const third = opt.generate({ ...generateInput, id: "capsule-3" }, { commandId: "generate-3" });
    assert.notEqual(third.id, first.id); assert.ok(!third.payload.sources.some(s => s.id === "accepted-memory"));
  });
  test(`${backend}: UTF-8 budget includes envelope; deterministic whole-item trimming preserves required`, options, t => {
    const { store, control } = fixture(t, {}, true);
    promote(boundary(store), candidate(store, { content: "补充".repeat(2500) }), "large");
    const ample = generate(control), requiredOnly = ample.payload.sources.filter(s => s.role === "REQUIRED");
    const small = capsules(store, { profile: { ...control.profile, maxBytes: ample.byteLength - 1000 } });
    const trimmed = small.generate({ ...generateInput, id: "capsule-2" }, { commandId: "generate-2" });
    assert.equal(trimmed.payload.sources.filter(s => s.role === "SUPPLEMENTAL").length, 0);
    assert.deepEqual(trimmed.payload.sources.filter(s => s.role === "REQUIRED"), requiredOnly);
    assert.ok(trimmed.byteLength <= small.profile.maxBytes);
    assert.ok(Buffer.byteLength(trimmed.payloadJson, "utf8") > trimmed.payloadJson.length);
    const tiny = capsules(store, { profile: { ...control.profile, maxBytes: 100 } });
    assert.throws(() => tiny.generate({ ...generateInput, id: "overflow" }, { commandId: "overflow" }), /required.*budget/);
    assert.equal(store.getRecord("context_capsule", "overflow"), null); assert.equal(control.runtime.started.length, 0);
  });
  test(`${backend}: persisted, reserved and receipt are separate; replay never starts twice`, options, async t => {
    const { store, control, runtime } = fixture(t); const record = generate(control);
    assert.equal(store.getAttempt("cat").capsuleDelivery.status, "PREPARED");
    const result = await dispatch(control);
    assert.equal(result.delivery.status, "RECEIVED"); assert.equal(runtime.started.length, 1);
    const received = result.delivery.observations[0].receipt;
    assert.equal(received.payloadHash, record.payloadHash); assert.equal(received.attemptId, "cat");
    assert.equal(runtime.executions.get(received.runtimeRef.externalId).capsuleInput.payloadJson, record.payloadJson);
    const events = store.allEvents().length;
    assert.equal((await dispatch(control)).replay, true);
    assert.equal(runtime.started.length, 1); assert.equal(store.allEvents().length, events);
    assert.throws(() => control.reserve({ capsuleId: "capsule-1", attemptId: "cat", expectedDeliveryVersion: 2 }, { commandId: "dispatch-1" }), /intent mismatch/);
    assert.throws(() => control.generate({ ...generateInput, id: "replacement" }, { commandId: "replace" }), /cannot be replaced/);
    assert.equal(control.history("capsule-1").payloadHash, record.payloadHash);
  });
  for (const failure of ["refusal", "exception", "missing-receipt", "wrong-hash", "wrong-attempt"]) {
    test(`${backend}: ${failure} does not fabricate delivery`, options, async t => {
      const runtime = new FakeRuntime(), baseStart = runtime.start.bind(runtime);
      runtime.start = async args => {
        if (failure === "refusal") throw new CapsuleInputRefusedError("invalid launch config");
        if (failure === "exception") throw new Error("lost response");
        const result = await baseStart(args);
        if (failure === "missing-receipt") delete result.capsuleReceipt;
        if (failure === "wrong-hash") result.capsuleReceipt.payloadHash = "0".repeat(64);
        if (failure === "wrong-attempt") result.capsuleReceipt.attemptId = "foreign";
        return result;
      };
      const { store, control } = fixture(t, { runtime }); generate(control);
      const result = await dispatch(control);
      assert.equal(result.delivery.status, failure === "refusal" ? "NOT_RECEIVED" : "UNKNOWN");
      assert.equal(store.getRun("cr").status, failure === "refusal" ? "FAILED" : "BLOCKED");
      assert.throws(() => control.generate({ ...generateInput, id: "replacement" }, { commandId: "replace" }), /dispatchable|replaced/);
      const starts = runtime.started.length; await dispatch(control); assert.equal(runtime.started.length, starts);
    });
  }
  test(`${backend}: detached Runtime mutation and secret/live launch handles do not modify archive`, options, async t => {
    const runtime = new FakeRuntime(), baseStart = runtime.start.bind(runtime);
    runtime.start = async args => {
      const result = await baseStart(args);
      args.contextCapsule.sources[0].content = { fake: "accepted" };
      assert.equal(args.launchConfig.secret, "do-not-archive"); return result;
    };
    const { control } = fixture(t, { runtime }), record = generate(control);
    await dispatch(control, { launchConfig: { secret: "do-not-archive", parent: { run() {} } } });
    assert.equal(control.history(record.id).payloadJson, record.payloadJson);
    assert.ok(!record.payloadJson.includes("do-not-archive"));
  });
  test(`${backend}: crash intent is UNKNOWN; attributable reconciliation and terminal facts`, options, t => {
    const { store, control } = fixture(t); generate(control); reserve(control);
    assert.equal(store.getAttempt("cat").capsuleDelivery.status, "DISPATCHING");
    control.recoverInterruptedDispatch("cat", { commandId: "recover" });
    assert.equal(store.getAttempt("cat").capsuleDelivery.status, "UNKNOWN");
    assert.equal(store.getAttempt("cat").status, "LOST");
    assert.throws(() => control.reconcileDelivery("cat", { outcome: "confirmed_completed" }, { commandId: "forged", expectedDeliveryVersion: 3 }), /attributable/);
    const delivery = control.reconcileDelivery("cat", { noExecution: true, reason: "Adapter proved no launch", observationRef: "adapter:proof" },
      { commandId: "no-execution", expectedDeliveryVersion: 3 });
    assert.equal(delivery.status, "NOT_RECEIVED");
    assert.throws(() => control.reconcileDelivery("cat", { noExecution: true, reason: "rewrite", observationRef: "adapter:other" },
      { commandId: "terminal-rewrite", expectedDeliveryVersion: 4 }), /terminal/);
  });
  test(`${backend}: atomic snapshot/event/replay rollback; whole-record Attempt CAS`, options, t => {
    const { store, control } = fixture(t), original = store.getAttempt("cat"), append = store.appendEvent.bind(store);
    store.appendEvent = e => { if (e.type === "capsule.prepared") throw new Error("injected event failure"); return append(e); };
    assert.throws(() => generate(control), /injected/);
    assert.equal(store.getRecord("context_capsule", "capsule-1"), null); assert.equal(store.getCommand("generate-1"), null);
    assert.deepEqual(store.getAttempt("cat"), original);
    store.appendEvent = append; generate(control);
    const current = store.getAttempt("cat");
    assert.equal(store.compareRecord("attempt", "cat", { ...current, resultRef: "unsafe" }, original), false);
    assert.equal(store.getAttempt("cat").resultRef, null);
    assert.throws(() => control.reserve({ capsuleId: "capsule-1", attemptId: "another", expectedDeliveryVersion: 1 }, { commandId: "reuse" }), /across Attempts/);
    assert.throws(() => control.reserve({ capsuleId: "capsule-1", attemptId: "cat", expectedDeliveryVersion: 0 }, { commandId: "stale-cas" }), /stale/);
  });
  test(`${backend}: Goal/Milestone identity, pins and source drift are preserved`, options, t => {
    const { store, control } = fixture(t);
    store.seedMilestone(createMilestone({ id: "ml", projectId: "p", name: "Milestone" }));
    store.seedGoal(createGoal({ id: "g", projectId: "p", milestoneId: "ml", title: "Goal" }));
    store.updateTask("ct", 2, { goalId: "g" });
    const record = generate(control);
    assert.ok(record.payload.sources.some(s => s.type === "GOAL" && s.id === "g"));
    assert.ok(record.payload.sources.some(s => s.type === "MILESTONE" && s.id === "ml"));
    store.updateGoal("g", 1, { title: "changed" });
    assert.throws(() => reserve(control), /source drift/);
  });
  test(`${backend}: required consistency failure and launch/session fields fail closed`, options, t => {
    const { store } = fixture(t);
    assert.throws(() => generate(capsules(store, { verifyRequiredIntegrity: () => ({ complete: true, consistent: false, reason: "conflicting directions", observationRef: "review" }) })), /integrity/);
    const normal = capsuleBoundary(store).runtimeContext;
    assert.throws(() => generate(capsules(store, { runtimeContext: (b, c) => ({ ...normal(b, c), credentials: "secret" }) })), /launch\/session/);
    assert.equal(store.getRecord("context_capsule", "capsule-1"), null);
  });
  test(`${backend}: current Evidence/Verification and explicitly historical Evidence retain proof boundaries`, options, t => {
    const { store } = fixture(t, {}, true);
    const observeReality = e => ({ status: "CURRENT", revision: e.revision, observationRef: "fixture:evidence", observedAt: fixedTime });
    const control = capsules(store, { observeReality, additionalSources: () => [{ type: "EVIDENCE", id: "e", role: "REQUIRED" }, { type: "VERIFICATION", id: "v", role: "SUPPLEMENTAL" }] });
    const record = generate(control);
    assert.equal(record.payload.sources.find(s => s.id === "e").authority, "EVIDENCE_ONLY");
    assert.ok(record.payload.sources.find(s => s.id === "v").validityObservation.proof);
    const evidence = store.getRecord("evidence", "e"); store.putRecord("evidence", "e", { ...evidence, status: "STALE" });
    assert.throws(() => reserve(control), /INVALID/);
    const historical = capsules(store, { additionalSources: () => [{ type: "EVIDENCE", id: "e", role: "SUPPLEMENTAL", useScope: "HISTORY" }] });
    const history = historical.generate({ ...generateInput, id: "history-capsule" }, { commandId: "history-capsule" });
    const archived = history.payload.sources.find(s => s.id === "e");
    assert.equal(archived.useScope, "HISTORY"); assert.equal(archived.validityObservation.status, "HISTORICAL");
    assert.equal(archived.authority, "EVIDENCE_ONLY"); assert.equal(archived.content.status, "STALE");
    assert.equal(store.getTask("t").status, "ACCEPTED");
  });
  test(`${backend}: Approval uses existing target/action/capability/scope/expiry rules`, options, async t => {
    let observedTime = fixedTime;
    const { store } = fixture(t);
    const request = { id: "ap", targetType: "TASK", targetId: "ct", action: "execute", capability: "work.read", scope: "workspace:cw", riskLevel: "HIGH", requestedBy: "human", expiresAt: "2099-01-01T00:00:00.000Z" };
    store.requestApproval(request);
    store.decideApproval("ap", 1, { decision: "APPROVE", decidedBy: "human" });
    const basePolicy = capsuleBoundary(store).policyContext;
    const control = capsules(store, { clock: () => observedTime, policyContext: b => ({ ...basePolicy(b), approvalRequests: [{ approvalId: "ap", targetType: "TASK", targetId: "ct", targetVersion: 2, action: "execute", capability: "work.read", scope: "workspace:cw" }] }) });
    generate(control); observedTime = "2100-01-01T00:00:00.000Z";
    await assert.rejects(dispatch(control), /EXPIRED/); assert.equal(control.runtime.started.length, 0);
    assert.equal(store.getRecord("approval", "ap").decision.status, "APPROVED");
  });
  test(`${backend}: Controller integrates receipt-aware execution without legacy context authority`, options, async t => {
    const { store, runtime } = fixture(t);
    store.seedAcceptance(createAcceptance({ id: "fresh-contract", targetId: "fresh-task" }));
    store.seedTask(createTask({ id: "fresh-task", projectId: "p", title: "New execution", acceptanceId: "fresh-contract", acceptanceVersion: 1, status: "READY" }));
    let sequence = 0, legacyCalls = 0;
    const controller = new Controller({ store, runtime, verifier: new FakeVerifier(), capsuleBoundary: capsuleBoundary(store, { runtime }),
      runtimeContextFactory: () => { legacyCalls++; return { forged: "capsule" }; }, idFactory: kind => `${kind}-${++sequence}` });
    const outcome = await controller.reconcileTask("fresh-task");
    assert.equal(outcome.action, "ACCEPT"); assert.equal(legacyCalls, 0);
    const task = store.getTask("fresh-task"), run = store.getRun(task.currentRunId), attempt = store.getAttempt(run.currentAttemptId);
    assert.equal(attempt.capsuleDelivery.status, "RECEIVED");
    assert.equal(controller.capsules.history(attempt.capsuleDelivery.capsuleId).attemptId, attempt.id);
    assert.equal(store.getDecision("d").status, "ACTIVE");
  });
  test(`${backend}: reservation rollback does not call Runtime or persist dispatch intent`, options, async t => {
    const { store, control, runtime } = fixture(t); generate(control);
    const append = store.appendEvent.bind(store), before = store.getAttempt("cat");
    store.appendEvent = e => { if (e.type === "capsule.dispatch-reserved") throw new Error("reservation event failure"); return append(e); };
    await assert.rejects(dispatch(control), /reservation event failure/);
    assert.deepEqual(store.getAttempt("cat"), before); assert.equal(store.getCommand("dispatch-1"), null); assert.equal(runtime.started.length, 0);
  });
  test(`${backend}: matching recovery receipt is append-only and completion is not delivery proof`, options, async t => {
    const { store, control, runtime } = fixture(t); const record = generate(control); reserve(control);
    const accepted = await runtime.start({ run: store.getRun("cr"), attempt: store.getAttempt("cat"), contextCapsule: record.payload,
      capsuleBinding: { capsuleId: record.id, payloadHash: record.payloadHash, projectId: "p", taskId: "ct", runId: "cr", attemptId: "cat" } });
    control.recoverInterruptedDispatch("cat", { commandId: "recover" });
    const delivery = control.reconcileDelivery("cat", { receipt: accepted.capsuleReceipt, runtimeRef: accepted.runtimeRef }, { commandId: "recover-receipt", expectedDeliveryVersion: 3 });
    assert.equal(delivery.status, "RECEIVED"); assert.equal(delivery.observations.length, 2);
    assert.deepEqual(store.getAttempt("cat").runtimeRef, accepted.runtimeRef);
    assert.throws(() => control.reconcileDelivery("cat", { receipt: accepted.capsuleReceipt, runtimeRef: accepted.runtimeRef }, { commandId: "second-receipt", expectedDeliveryVersion: 4 }), /terminal/);
  });
  test(`${backend}: parent contract pins and PolicyDecision audit preserve original authority`, options, t => {
    const { store } = fixture(t);
    store.seedAcceptance(createAcceptance({ id: "ga", targetType: "GOAL", targetId: "g", criteria: ["parent criterion"] }));
    store.seedGoal(createGoal({ id: "g", projectId: "p", title: "Goal", acceptanceId: "ga", acceptanceVersion: 1 }));
    store.updateTask("ct", 2, { goalId: "g" });
    store.createControlCommand({ id: "cmd", projectId: "p", targetType: "TASK", targetId: "ct", action: "read", capability: "work.read", scope: "cw", requestedBy: "human", idempotencyKey: "cmd:read" });
    store.recordPolicyDecision("cmd", 1, { id: "pd", effect: "ALLOW", policyVersion: "1" });
    const basePolicy = capsuleBoundary(store).policyContext;
    const control = capsules(store, { policyContext: b => ({ ...basePolicy(b), policyDecisionIds: ["pd"] }) });
    const record = generate(control);
    assert.ok(record.payload.sources.some(s => s.type === "ACCEPTANCE" && s.id === "ga" && s.provenance.targetType === "GOAL"));
    assert.equal(record.payload.sources.find(s => s.id === "pd").authority, "POLICY_AUDIT_ONLY");
    assert.equal(store.getRecord("control_command", "cmd").status, "CREATED");
    store.recordPolicyDecision("cmd", 1, { id: "deny", effect: "DENY", policyVersion: "1" });
    assert.throws(() => capsules(store, { policyContext: b => ({ ...basePolicy(b), policyDecisionIds: ["deny"] }) }).generate({ ...generateInput, id: "deny-capsule" }, { commandId: "deny-capsule" }), /DENY/);
  });
  test(`${backend}: Memory observation time changes do not impersonate source pin drift`, options, async t => {
    const { store, control } = fixture(t, {}, true); promote(boundary(store), candidate(store), "m");
    const record = generate(control);
    assert.ok(record.payload.sources.find(s => s.id === "m").validityObservation.memoryCurrentUse.eligible);
    await new Promise(resolve => setTimeout(resolve, 10));
    const delivered = await dispatch(control);
    assert.equal(delivered.delivery.status, "RECEIVED");
    assert.ok(delivered.delivery.freshness.sourceObservations.find(s => s.id === "m").sourceChecks.every(c => c.validity === "CURRENT"));
    assert.equal(store.getRecord("memory", "m").status, "ACTIVE");
  });
  test(`${backend}: no-effect recovery does not invent Capsule non-receipt after lost receipt`, options, async t => {
    const { store } = fixture(t);
    store.updateAttempt("cat", { status: "RUNNING" });
    const runtime = new FakeRuntime({ reconcileOutcome: ReconcileOutcome.CONFIRMED_NO_EFFECT });
    const start = runtime.start.bind(runtime);
    let loseReceipt = true;
    runtime.start = async input => {
      const result = await start(input);
      if (loseReceipt) { delete result.capsuleReceipt; loseReceipt = false; }
      return result;
    };
    const control = capsules(store, { runtime }); generate(control); await dispatch(control);
    assert.equal([...runtime.executions.values()][0].capsuleInput.binding.capsuleId, "capsule-1");
    const delivery = structuredClone(store.getAttempt("cat").capsuleDelivery);
    assert.equal(delivery.status, "UNKNOWN");
    let sequence = 0;
    const controller = new Controller({ store, runtime, verifier: new FakeVerifier(),
      capsuleBoundary: capsuleBoundary(store, { runtime }), idFactory: kind => `recovery-${kind}-${++sequence}` });
    const result = await controller.reconcileTask("ct");
    assert.equal(result.reconciliation.outcome, ReconcileOutcome.CONFIRMED_NO_EFFECT);
    assert.notEqual(store.getTask("ct").currentRunId, "cr");
    assert.equal(runtime.started.length, 2); // Recovery executes only the new Run.
    assert.deepEqual(store.getAttempt("cat").capsuleDelivery, delivery);
    assert.equal(store.allEvents().filter(e => e.type === "capsule.delivery-observed" && e.payload.status === "NOT_RECEIVED").length, 0);
  });
  test(`${backend}: refusal delivery, terminal execution, event and replay roll back together`, options, async t => {
    const { store, control, runtime } = fixture(t);
    store.updateAttempt("cat", { status: "RUNNING" }); generate(control);
    runtime.start = async () => { throw new CapsuleInputRefusedError("explicit input refusal"); };
    const updateRun = store.updateRun.bind(store);
    store.updateRun = (...args) => { if (args[2]?.status === "FAILED") throw new Error("terminal write interrupted"); return updateRun(...args); };
    await assert.rejects(dispatch(control), /terminal write interrupted/);
    store.updateRun = updateRun;
    assert.equal(store.getAttempt("cat").capsuleDelivery.status, "DISPATCHING");
    assert.equal(store.getAttempt("cat").status, "RUNNING");
    assert.equal(store.getRun("cr").status, "RUNNING");
    assert.equal(store.getCommand("dispatch-1:observation"), null);
    assert.equal(store.allEvents().filter(e => e.type === "capsule.delivery-observed").length, 0);
    control.recoverInterruptedDispatch("cat", { commandId: "recover-refusal-interruption" });
    assert.equal(store.getAttempt("cat").capsuleDelivery.status, "UNKNOWN");
    assert.equal(store.getAttempt("cat").status, "LOST");
    assert.equal(store.getRun("cr").status, "BLOCKED");
  });
  test(`${backend}: inactive Decision has no historical escape; unselected supplemental change is harmless`, options, t => {
    const { store, control } = fixture(t, {}, true); generate(control);
    promote(boundary(store), candidate(store), "unselected-new-memory");
    reserve(control); // New supplemental content was not necessary or included.
    store.revokeDecision("d", 1, { revokedBy: { type: "HUMAN", actorId: "human" }, reason: "withdraw direction" });
    const separate = fixture(t);
    separate.store.revokeDecision("d", 1, { revokedBy: { type: "HUMAN", actorId: "human" }, reason: "withdraw" });
    const record = generate(separate.control); assert.ok(!record.payload.sources.some(s => s.id === "d"));
    assert.throws(() => capsules(separate.store, { additionalSources: () => [{ type: "DECISION", id: "d", role: "REQUIRED", useScope: "HISTORY" }] }).generate(
      { ...generateInput, id: "inactive-history" }, { commandId: "inactive-history" }), /history/);
  });
}

test("finite JSON rejects live values, cycles, accessors, sparse arrays and ambiguous values", () => {
  const cycle = {}; cycle.self = cycle;
  for (const value of [undefined, NaN, Infinity, 1n, new Date(), () => {}, cycle, Array(2), { get value() { return "secret"; } }, { value: Symbol() }]) {
    assert.throws(() => canonicalCapsuleJson(value), /JSON|accessors|arrays/);
  }
  assert.equal(canonicalCapsuleJson({ b: 2, a: "中文" }), '{"a":"中文","b":2}');
});
