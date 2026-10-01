// Real external-runtime integration, deterministic Node process, no DSH host.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { MemoryStore } from "../../project-control/memory-store.mjs";
import { SqliteStore, isSqliteAvailable, SQLITE_REQUIREMENT } from "../../project-control/sqlite-store.mjs";
import { createProject, createTask, createAcceptance } from "../../project-control/domain.mjs";
import { capsuleHash, canonicalCapsuleJson } from "../../project-control/capsule-json.mjs";
import { createDogfoodSlice } from "../helpers/g8-dogfood-slice-1.mjs";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
// Other legacy regression files write ignored .ai fixtures concurrently. Give
// this READ_ONLY integration an actual tracked-file repository snapshot, not a
// fabricated package/Blueprint, so those unrelated writes cannot alter its pin.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "g8-repository-snapshot-"));
const sourceHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: sourceRoot, encoding: "utf8", windowsHide: true }).trim();
for (const relative of execFileSync("git", ["ls-files", "-z"], { cwd: sourceRoot, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean)) {
  const destination = path.join(root, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(sourceRoot, relative), destination);
}
after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
const backends = ["memory", "sqlite"];
function setup(t, backend, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g8-dogfood-"));
  const db = path.join(dir, "control.db");
  const store = backend === "sqlite" ? new SqliteStore(db) : new MemoryStore();
  t.after(() => { store.close?.(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  return { ...createDogfoodSlice({ store, root, isolationRoot: path.join(dir, "overlays"), ...options }), db };
}
function permit(slice) { slice.approve(); assert.equal(slice.authorize().action, "AUTHORIZE"); }
function rawCommand(slice, patch) {
  const record = slice.store.getControlCommand(slice.command.id);
  // Corruption/incorrect trusted-input fault injection, never normal API use.
  slice.store.putRecord("control_command", record.id, { ...record, ...patch });
}
for (const backend of backends) {
  const skip = backend === "sqlite" && !isSqliteAvailable() ? SQLITE_REQUIREMENT : false;
  const check = (name, fn) => test(`G8 real read-only slice ${backend}: ${name}`, { skip }, fn);
  check("Policy/Approval gate, actual input/result, Acceptance, hierarchy and replay", async t => {
    const s = setup(t, backend);
    assert.equal(s.authorize(null).action, "WAIT");
    assert.equal(s.store.getControlCommand(s.command.id).status, "CREATED");
    await assert.rejects(s.execute(), /not AUTHORIZED/);
    assert.equal(s.runtime.startCalls, 0);
    assert.equal(s.store.allRecords("run").length, 0);
    permit(s);
    assert.throws(() => s.manager.writeFile(s.workspace.id, "g8-forbidden-write.txt", "forbidden"), /READ_ONLY/);
    assert.equal(fs.existsSync(path.join(root, "g8-forbidden-write.txt")), false);
    const result = await s.execute();
    assert.equal(result.action, "ACCEPT", result.error);
    assert.equal(s.runtime.startCalls, 1);
    assert.equal(result.task.status, "ACCEPTED");
    assert.equal(s.store.getGoal("g8-goal").status, "ACCEPTED");
    assert.equal(s.store.getMilestone("g8-milestone").status, "COMPLETED");
    assert.equal(s.store.getProject("g8-project").status, "COMPLETED");
    const attempt = result.attempt;
    const capsule = s.controller.capsules.history(attempt.capsuleDelivery.capsuleId);
    const receipt = attempt.capsuleDelivery.observations.find(observation => observation.status === "RECEIVED").receipt;
    const input = s.runtime.inputs[0];
    assert.equal(input.launchConfig.process.cwd, path.resolve(root));
    assert.equal(capsuleHash(canonicalCapsuleJson(input.contextCapsule)), capsule.payloadHash);
    assert.equal(capsule.payloadHash, receipt.payloadHash);
    assert.equal(receipt.attemptId, attempt.id);
    assert.deepEqual(receipt.runtimeRef, attempt.runtimeRef);
    const policySource = capsule.payload.sources.find(source => source.type === "POLICY" || source.sourceRef.type === "POLICY");
    assert.equal(policySource.content.provenance.commandId, s.command.id);
    assert.equal(s.store.getControlCommand(s.command.id).authorization.approvalId, "g8-approval");
    assert.equal(s.store.getControlCommand(s.command.id).status, "AUTHORIZED");
    assert.equal(result.evidence.runId, result.run.id);
    assert.equal(result.evidence.attemptId, attempt.id);
    assert.equal(result.evidence.acceptanceVersion, 1);
    assert.equal(result.evidence.contentRef, s.results.keys().next().value);
    assert.deepEqual(s.verifierFacts[0].checks, { exit: true, output: true, revision: true, lineage: true, input: true });
    assert.equal(result.verification.verdict, "PASS");
    const events = s.store.allEvents();
    for (const type of ["command.authorized", "capsule.prepared", "capsule.delivery-observed", "task.accepted", "goal.accepted", "milestone.completed", "project.completed"]) {
      assert.ok(events.some(event => event.type === type), `missing ${type}`);
    }
    assert.equal(s.store.allRecords("effect").length, 0, "Runtime is not an Effect");
    const eventsBefore = events.length;
    assert.equal((await s.execute()).action, "NOOP");
    assert.equal(s.runtime.startCalls, 1);
    assert.equal(s.store.allEvents().length, eventsBefore);
    const dispatchReplay = await s.controller.capsules.dispatch({ capsuleId: capsule.id, attemptId: attempt.id, expectedDeliveryVersion: 1,
      launchConfig: { process: s.processSpec } }, { commandId: `capsule-dispatch:${attempt.id}` });
    assert.equal(dispatchReplay.replay, true);
    assert.equal(s.runtime.startCalls, 1);
    assert.equal(s.store.allEvents().length, eventsBefore);
    t.diagnostic(JSON.stringify({ sourceHead, projectId: result.task.projectId, taskId: result.task.id, commandId: s.command.id,
      policyDecisionId: s.store.getControlCommand(s.command.id).authorization.policyDecisionId, approvalId: "g8-approval",
      runId: result.run.id, attemptId: attempt.id, capsuleId: capsule.id, payloadHash: capsule.payloadHash,
      runtimeRef: { adapterId: attempt.runtimeRef.adapterId, externalId: attempt.runtimeRef.externalId },
      workspaceId: s.workspace.id, workspaceRevision: s.workspace.currentRevision,
      evidenceId: result.evidence.id, resultRef: result.evidence.contentRef, resultRevision: result.evidence.revision,
      verificationId: result.verification.id, verdict: result.verification.verdict,
      events: events.map(event => ({ id: event.id, type: event.type, aggregateId: event.aggregateId })) }));
    // Same-process SQLite reopen proves durable linkage only, not whole-chain
    // recovery or durable availability of process-output:// content.
    if (backend === "sqlite") {
      s.store.close();
      const reopened = new SqliteStore(s.db);
      try {
        assert.deepEqual(reopened.getAttempt(attempt.id), attempt);
        assert.deepEqual(reopened.getEvidence(result.evidence.id), result.evidence);
        assert.deepEqual(reopened.getVerification(result.verification.id), result.verification);
        assert.equal(reopened.getRecord("context_capsule", capsule.id).payloadHash, capsule.payloadHash);
        assert.deepEqual(reopened.allEvents(), events);
      } finally { reopened.close(); }
    }
  });
  for (const [name, mutate] of [
    ["wrong project", s => rawCommand(s, { projectId: "other" })],
    ["wrong target", s => rawCommand(s, { targetType: "TASK", targetId: "g8-task" })],
    ["wrong selected Command", s => {}],
    ["stale Project authorization", s => s.store.updateProject("g8-project", 1, { description: "new direction observation" })],
    ["stale Task binding", s => s.store.updateTask("g8-task", 1, { title: "changed objective" })],
    ["revoked Approval", s => s.store.revokeApproval("g8-approval", 2, { revokedBy: "human-dogfood", reason: "withdraw permission" })],
    ["Workspace binding mismatch", s => s.store.putRecord("workspace", "g8-workspace", { ...s.workspace, rootRef: os.tmpdir() })],
  ]) {
    check(`${name} invokes no real process`, async t => {
      const s = setup(t, backend); permit(s); mutate(s);
      await assert.rejects(s.execute(name === "wrong selected Command" ? "other-command" : s.command.id));
      assert.equal(s.runtime.startCalls, 0);
      assert.equal(s.store.allRecords("run").length, 0);
      assert.notEqual(s.store.getTask("g8-task").status, "ACCEPTED");
    });
  }
  check("Capsule required freshness fails before real Runtime call", async t => {
    const s = setup(t, backend); permit(s);
    const generate = s.controller.capsules.generate.bind(s.controller.capsules);
    s.controller.capsules.generate = (...args) => {
      const capsule = generate(...args);
      s.store.updateGoal("g8-goal", 1, { description: "required source drift" });
      return capsule;
    };
    const outcome = await s.execute();
    assert.equal(outcome.reason, "capsule-preparation-refused");
    assert.match(outcome.error, /drift/);
    assert.equal(s.runtime.startCalls, 0);
    assert.equal(s.store.allRecords("context_capsule").length, 1);
    assert.notEqual(s.store.getTask("g8-task").status, "ACCEPTED");
    await s.execute(); assert.equal(s.runtime.startCalls, 0);
  });
  check("launch cwd substitution rejected at the input seam", async t => {
    const s = setup(t, backend); permit(s);
    s.controller.runtimeLaunchConfigFactory = () => ({ process: { ...s.processSpec, cwd: os.tmpdir() } });
    await s.execute();
    assert.equal(s.runtime.startCalls, 0);
    const attempt = s.store.allRecords("attempt")[0];
    assert.equal(attempt.capsuleDelivery.status, "NOT_RECEIVED");
    assert.equal(attempt.status, "FAILED");
    await s.execute(); assert.equal(s.runtime.startCalls, 0);
  });
  check("Approval revoked after Capsule generation blocks dispatch", async t => {
    const s = setup(t, backend); permit(s);
    const generate = s.controller.capsules.generate.bind(s.controller.capsules);
    s.controller.capsules.generate = (...args) => {
      const capsule = generate(...args);
      s.store.revokeApproval("g8-approval", 2, { revokedBy: "human-dogfood", reason: "withdraw before dispatch" });
      return capsule;
    };
    const result = await s.execute();
    assert.equal(result.reason, "capsule-preparation-refused");
    assert.equal(s.runtime.startCalls, 0);
    assert.notEqual(s.store.getTask("g8-task").status, "ACCEPTED");
  });
  check("real nonzero process cannot be accepted", async t => {
    const s = setup(t, backend, { mode: "fail" }); permit(s);
    const result = await s.execute();
    assert.equal(result.action, "FAILED");
    assert.equal(s.runtime.startCalls, 1);
    assert.equal([...s.results.values()][0].details.exitCode, 7);
    assert.equal(result.attempt.status, "FAILED");
    assert.equal(s.store.allRecords("evidence").length, 0);
    assert.equal(s.verifierFacts.length, 0, "failed execution is not candidate completed Evidence");
    assert.notEqual(s.store.getTask("g8-task").status, "ACCEPTED");
    await s.execute(); assert.equal(s.runtime.startCalls, 1);
  });
  check("zero exit with a contract mismatch produces real verifier FAIL", async t => {
    const s = setup(t, backend, { expectedMarker: "UNSATISFIED_CONTRACT_MARKER" }); permit(s);
    const result = await s.execute();
    assert.equal(result.action, "REVIEW");
    assert.equal(s.runtime.startCalls, 1);
    assert.equal(s.verifierFacts[0].checks.exit, true);
    assert.equal(s.verifierFacts[0].checks.output, false);
    assert.equal(result.verification.verdict, "FAIL");
    assert.equal(result.task.status, "NEEDS_REVIEW");
    assert.equal(s.store.getProject("g8-project").status, "ACTIVE");
    await s.execute(); assert.equal(s.runtime.startCalls, 1);
  });
  check("cross-project containment remains rejected by Store before Capsule", t => {
    const s = setup(t, backend);
    s.store.seedProject(createProject({ id: "other", name: "Other project" }));
    s.store.seedAcceptance(createAcceptance({ id: "wrong-contract", targetId: "wrong" }));
    assert.throws(() => s.store.seedTask(createTask({ id: "wrong", projectId: "other", goalId: "g8-goal", title: "Bad membership",
      acceptanceId: "wrong-contract", acceptanceVersion: 1 })), /project/);
    assert.equal(s.runtime.startCalls, 0);
  });
}
