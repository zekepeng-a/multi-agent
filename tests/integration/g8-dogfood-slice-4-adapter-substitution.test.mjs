import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { MemoryStore } from "../../project-control/memory-store.mjs";
import { SqliteStore, isSqliteAvailable, SQLITE_REQUIREMENT } from "../../project-control/sqlite-store.mjs";
import { assertCapability } from "../../project-control/runtime-adapter.mjs";
import { createSubstitutionSlice, workflowScript } from "../helpers/g8-adapter-substitution.mjs";
import { substitutionVerifier } from "../helpers/g8-substitution-verifier.mjs";
const source = fileURLToPath(new URL("../../", import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "g8-substitution-repo-"));
for (const f of execFileSync("git", ["ls-files", "-z"], { cwd: source, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean)) {
  const target = path.join(root, f); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(source, f), target);
}
after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
function fixture(t, backend, kind, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "g8-substitution-control-"));
  const store = backend === "sqlite" ? new SqliteStore(path.join(dir, "control.db")) : new MemoryStore();
  t.after(() => { store.close?.(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  return createSubstitutionSlice({ store, root, isolationRoot: path.join(dir, "overlays"), kind, ...options });
}
function permit(s) { s.approve(); assert.equal(s.authorize().action, "AUTHORIZE"); }
function states(s) { return [s.store.getTask("g8-task").status, s.store.getGoal("g8-goal").status, s.store.getMilestone("g8-milestone").status, s.store.getProject("g8-project").status]; }
for (const backend of ["memory", "sqlite"]) {
  const skip = backend === "sqlite" && !isSqliteAvailable() ? SQLITE_REQUIREMENT : false;
  const check = (name, fn) => test(`G8 substitution ${backend}: ${name}`, { skip }, fn);
  check("independent equivalent workloads preserve control semantics across adapters", async t => {
    const a = fixture(t, backend, "local"), b = fixture(t, backend, "dsh");
    assert.deepEqual(states(a), states(b)); assert.equal(a.store.allRecords("run").length, 0); assert.equal(b.store.allRecords("run").length, 0);
    assert.deepEqual(a.store.getAcceptance("g8-contract", 1).criteria, b.store.getAcceptance("g8-contract", 1).criteria);
    assert.notEqual(a.command.id, b.command.id);
    permit(a); permit(b);
    const ra = await a.execute(), rb = await b.execute();
    for (const [s, r, kind] of [[a, ra, "local-process"], [b, rb, "dsh-workflow"]]) {
      assert.equal(r.action, "ACCEPT", JSON.stringify(s.verifierFacts)); assert.equal(r.verification.verdict, "PASS");
      assert.equal(r.evidence.status, "CANDIDATE"); assert.equal(s.runtime.startCalls, 1);
      assert.deepEqual(states(s), ["ACCEPTED", "ACCEPTED", "COMPLETED", "COMPLETED"]);
      assert.equal(r.attempt.runtimeRef.runtimeKind, kind);
      assert.notEqual(r.attempt.runtimeRef.externalId, r.run.id); assert.notEqual(r.attempt.runtimeRef.externalId, r.attempt.id);
      for (const cap of ["resume", "reconcile", "pause", "sendMessage", "eventStream"]) {
        assert.equal(s.runtime.capabilities()[cap], false); assert.throws(() => assertCapability(s.runtime, cap), /does not support/);
      }
      const capsule = s.controller.capsules.history(r.attempt.capsuleDelivery.capsuleId);
      const receipt = r.attempt.capsuleDelivery.observations[0].receipt;
      assert.equal(receipt.capsuleId, capsule.id); assert.equal(receipt.payloadHash, capsule.payloadHash);
      assert.equal(receipt.attemptId, r.attempt.id); assert.deepEqual(receipt.runtimeRef, r.attempt.runtimeRef);
      assert.ok(!capsule.payloadJson.includes("liveHandle")); assert.ok(!capsule.payloadJson.includes(JSON.stringify(workflowScript)));
      assert.throws(() => s.manager.writeFile("g8-workspace", "forbidden.txt", "bad"), /READ_ONLY/);
      assert.equal(s.store.allRecords("effect").length, 0);
      const events = s.store.allEvents(); assert.equal((await s.execute()).action, "NOOP"); assert.deepEqual(s.store.allEvents(), events);
    }
    assert.notEqual(ra.run.id, rb.run.id); assert.notEqual(ra.attempt.id, rb.attempt.id);
    assert.notEqual(ra.attempt.capsuleDelivery.capsuleId, rb.attempt.capsuleDelivery.capsuleId);
    assert.notDeepEqual(ra.attempt.runtimeRef, rb.attempt.runtimeRef);
    assert.deepEqual(a.verifierFacts[0].semantic, b.verifierFacts[0].semantic);
    const sourceMeaning = s => s.controller.capsules.history(s.store.allRecords("attempt")[0].capsuleDelivery.capsuleId).payload.sources.map(item => ({ type: item.sourceRef.type, role: item.role, authority: item.authority, useScope: item.useScope }));
    assert.deepEqual(sourceMeaning(a), sourceMeaning(b));
    for (const key of ["action", "capability", "scope", "riskLevel", "requestedBy"]) assert.equal(a.command[key], b.command[key]);
    assert.deepEqual(a.store.allEvents().map(e => e.type), b.store.allEvents().map(e => e.type));
    assert.equal(b.engine.calls.length, 1); assert.equal(b.engine.calls[0].parent, b.parent); assert.equal(b.engine.disposed, 1);
    assert.equal(rb.attempt.runtimeRef.workflowId, rb.attempt.runtimeRef.externalId);
    await b.runtime.collectResult(rb.attempt.runtimeRef); assert.equal(b.engine.disposed, 1);
    t.diagnostic(JSON.stringify({ local: { runtimeRef: ra.attempt.runtimeRef, evidence: ra.evidence, verification: ra.verification }, dsh: { runtimeRef: rb.attempt.runtimeRef, evidence: rb.evidence, verification: rb.verification }, semantic: a.verifierFacts[0].semantic }));
  });
  for (const kind of ["local", "dsh"]) {
    check(`${kind} COMPLETED with wrong semantic facts cannot accept`, async t => {
      const s = fixture(t, backend, kind, { mode: "wrong" }); permit(s); const r = await s.execute();
      assert.equal(r.attempt.status, "COMPLETED"); assert.equal(r.action, "REVIEW"); assert.equal(r.verification.verdict, "FAIL");
      assert.equal(r.task.status, "NEEDS_REVIEW"); assert.notEqual(s.store.getProject("g8-project").status, "COMPLETED");
      if (kind === "dsh") assert.equal(s.engine.disposed, 1);
    });
    check(`${kind} FAILED has no Evidence or Acceptance`, async t => {
      const s = fixture(t, backend, kind, { mode: "fail" }); permit(s); const r = await s.execute();
      assert.equal(r.action, "FAILED"); assert.equal(s.store.allRecords("evidence").length, 0); assert.equal(s.store.allRecords("verification").length, 0);
      assert.notEqual(r.task.status, "ACCEPTED"); if (kind === "dsh") assert.equal(s.engine.disposed, 1);
    });
    check(`${kind} receipt mismatch preserves UNKNOWN and never repeats start`, async t => {
      const s = fixture(t, backend, kind, { receiptFault: true }); permit(s); await s.execute();
      const attempt = s.store.allRecords("attempt")[0]; assert.equal(attempt.capsuleDelivery.status, "UNKNOWN");
      assert.equal(s.store.allRecords("evidence").length, 0); await s.execute(); assert.equal(s.runtime.startCalls, 1);
      // Release the test-owned completed provider result, without fabricating receipt.
      const ref = [...s.runtime.executions.values()][0].runtimeRef; await s.runtime.collectResult(ref);
      assert.equal(s.store.getAttempt(attempt.id).capsuleDelivery.status, "UNKNOWN");
    });
    for (const fault of ["unapproved", "stale", "wrong-command"]) check(`${kind} ${fault} authorization prevents execution`, async t => {
      const s = fixture(t, backend, kind);
      if (fault !== "unapproved") permit(s);
      if (fault === "stale") s.store.updateProject("g8-project", 1, { description: "changed" });
      await assert.rejects(s.execute(fault === "wrong-command" ? "foreign-command" : s.command.id));
      assert.equal(s.runtime.startCalls, 0); assert.equal(s.engine.calls.length, 0); assert.equal(s.store.allRecords("run").length, 0);
    });
    for (const fault of kind === "local" ? ["process"] : ["script", "meta", "parent"]) check(`${kind} wrong ${fault} launch binding refused`, async t => {
      const s = fixture(t, backend, kind, { launchFault: fault }); permit(s); await s.execute();
      assert.equal(s.runtime.startCalls, 0); assert.equal(s.engine.calls.length, 0); assert.equal(s.store.allRecords("evidence").length, 0);
      assert.equal(s.store.allRecords("attempt")[0].capsuleDelivery.status, "NOT_RECEIVED");
    });
  }
  check("DSH cancel maps public cancel/result/dispose without Acceptance", async t => {
    const s = fixture(t, backend, "dsh", { mode: "cancel" }); permit(s);
    const pending = s.execute(); pending.catch(() => {});
    const deadline = Date.now() + 2000;
    while (!s.runtime.executions.size && Date.now() < deadline) await new Promise(r => setTimeout(r, 5));
    assert.equal(s.runtime.executions.size, 1, "bounded wait for live WorkflowRun");
    await s.runtime.cancel([...s.runtime.executions.values()][0].runtimeRef, "test cancellation");
    const r = await pending;
    assert.equal(r.action, "CANCELLED"); assert.equal(s.engine.cancelled, 1); assert.equal(s.engine.disposed, 1);
    assert.equal(s.store.allRecords("evidence").length, 0); assert.equal(s.store.allRecords("verification").length, 0);
  });
  check("common verifier rejects decoder, revision and lineage corruption", async t => {
    for (const kind of ["local", "dsh"]) {
      const s = fixture(t, backend, kind); permit(s); const r = await s.execute();
      const original = s.results.get(r.evidence.contentRef);
      for (const fault of ["decoder", "revision", "runtime", "receipt"]) {
        const result = structuredClone(original), evidence = structuredClone(r.evidence);
        if (fault === "decoder") { if (kind === "local") result.details.stdout = "invalid-json"; else result.details.value = null; }
        if (fault === "revision") evidence.revision = "wrong";
        if (fault === "runtime") result.runtimeRef.externalId = "other";
        if (fault === "receipt") evidence.attemptId = "missing";
        const facts = [], before = s.store.getTask("g8-task");
        const v = substitutionVerifier({ store: s.store, root, results: new Map([[evidence.contentRef, result]]), facts }).verify({ task: r.task, run: r.run, acceptance: s.store.getAcceptance("g8-contract", 1), evidence });
        assert.equal(v.verdict, "FAIL"); assert.deepEqual(s.store.getTask("g8-task"), before);
      }
    }
  });
}
