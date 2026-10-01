import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { MemoryStore } from "../../project-control/memory-store.mjs";
import { SqliteStore, isSqliteAvailable, SQLITE_REQUIREMENT } from "../../project-control/sqlite-store.mjs";
import { canonicalCapsuleJson } from "../../project-control/capsule-json.mjs";
import { durableLiveSlice, freshResultController } from "../helpers/g8-durable-result-fixture.mjs";
import { encodeResultArtifact, persistResultArtifact, resolveRuntimeResult, sha256 } from "../helpers/g8-durable-local-process-runtime.mjs";

// Snapshot tracked repository files to isolate READ_ONLY pins from legacy tests.
const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "g8-durable-repository-"));
for (const relative of execFileSync("git", ["ls-files", "-z"], { cwd: sourceRoot, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean)) {
  const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(sourceRoot, relative), target);
}
after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
function files(t) {
  const control = fs.mkdtempSync(path.join(os.tmpdir(), "g8-durable-control-"));
  const resultDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "g8-durable-provider-"));
  const stores = [];
  t.after(() => { for (const store of stores) store.close?.(); for (const dir of [control, resultDirectory]) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  return { root, control, resultDirectory, database: path.join(control, "control.db"), stores };
}
function setup(t, backend, options = {}) {
  const f = files(t), store = backend === "sqlite" ? new SqliteStore(f.database) : new MemoryStore();
  f.stores.push(store);
  const s = durableLiveSlice({ ...f, store, isolationRoot: path.join(f.control, "overlays"), ...options });
  s.approve(); assert.equal(s.authorize().action, "AUTHORIZE");
  return { ...f, ...s };
}
function artifactPath(ref) { const uri = new URL(ref); uri.hash = ""; return fileURLToPath(uri); }
function expected(store, evidence) {
  const attempt = store.getAttempt(evidence.attemptId), capsule = store.getRecord("context_capsule", attempt.capsuleDelivery.capsuleId);
  return { runtimeRef: attempt.runtimeRef, runId: evidence.runId, attemptId: attempt.id, capsuleId: capsule.id,
    payloadHash: capsule.payloadHash, processFingerprint: store.getAcceptance("g8-contract", 1).criteria[0].processFingerprint, revision: evidence.revision };
}
for (const backend of ["memory", "sqlite"]) {
  const skip = backend === "sqlite" && !isSqliteAvailable() ? SQLITE_REQUIREMENT : false;
  const check = (name, fn) => test(`G8 durable result ${backend}: ${name}`, { skip }, fn);
  check("live verifier uses only durable resolver; artifact cannot silently overwrite", async t => {
    const s = setup(t, backend), result = await s.execute();
    assert.equal(result.action, "ACCEPT", JSON.stringify(s.verifierFacts));
    assert.equal(s.runtime.startCalls, 1); assert.equal(s.results.size, 0);
    assert.equal(result.attempt.resultRef, result.evidence.contentRef);
    assert.equal(result.verification.verdict, "PASS");
    const resolved = resolveRuntimeResult(s.resultDirectory, result.evidence.contentRef, expected(s.store, result.evidence));
    assert.equal(resolved.revision, result.evidence.revision);
    const target = artifactPath(resolved.resultRef), bytes = fs.readFileSync(target), stat = fs.statSync(target);
    assert.equal(resolved.artifactHash, sha256(bytes));
    assert.equal(bytes.toString(), canonicalCapsuleJson(JSON.parse(bytes)));
    assert.equal(persistResultArtifact(s.resultDirectory, resolved.artifactContent).resultRef, resolved.resultRef);
    assert.throws(() => persistResultArtifact(s.resultDirectory, { ...resolved.artifactContent, stdout: "replacement" }), /immutable/);
    assert.deepEqual(fs.readFileSync(target), bytes); assert.equal(fs.statSync(target).mtimeMs, stat.mtimeMs);
    s.runtime.executions.clear(); // Neither verifier nor resolver can use live execution memory now.
    assert.equal(resolveRuntimeResult(s.resultDirectory, resolved.resultRef, expected(s.store, result.evidence)).revision, resolved.revision);
    assert.equal(s.store.allRecords("effect").length, 0);
    t.diagnostic(JSON.stringify({ resultRef: resolved.resultRef, revision: resolved.revision, artifactHash: resolved.artifactHash,
      taskId: result.task.id, evidenceId: result.evidence.id, verificationId: result.verification.id, checks: s.verifierFacts }));
  });
  check("valid review checkpoint can reverify without Runtime or duplicate lineage", async t => {
    const s = setup(t, backend, { reviewRequired: true }), first = await s.execute();
    assert.equal(first.action, "REVIEW"); assert.equal(first.task.status, "NEEDS_REVIEW");
    assert.equal(first.verification.verdict, "INCONCLUSIVE"); assert.equal(first.evidence.status, "CANDIDATE");
    assert.ok(Object.values(s.verifierFacts[0].checks).every(Boolean));
    assert.equal(s.verifierFacts[0].reason, "requires independent durable-result reproof");
    assert.equal(s.results.size, 0);
    const counts = ["run", "attempt", "evidence"].map(type => s.store.allRecords(type).length);
    const fresh = freshResultController({ store: s.store, root, resultDirectory: s.resultDirectory });
    const result = await fresh.controller.reconcileTask("g8-task");
    assert.equal(result.action, "ACCEPT", JSON.stringify(fresh.facts));
    assert.equal(fresh.runtime.executions.size, 0); assert.equal(fresh.runtime.startCalls, 0);
    assert.deepEqual(["run", "attempt", "evidence"].map(type => s.store.allRecords(type).length), counts);
    assert.deepEqual(s.store.allRecords("verification").map(v => v.verdict), ["INCONCLUSIVE", "PASS"]);
    const events = s.store.allEvents();
    assert.equal((await fresh.controller.reconcileTask("g8-task")).action, "NOOP");
    assert.deepEqual(s.store.allEvents(), events);
  });
  for (const corruption of ["missing", "corrupt-bytes", "runtimeRef", "runId", "attemptId", "wrong-resultRef", "wrong-revision", "schema"]) {
    check(`${corruption} fails closed from recorded Evidence`, async t => {
      const s = setup(t, backend, { reviewRequired: true }), first = await s.execute();
      assert.equal(first.action, "REVIEW", JSON.stringify(s.verifierFacts));
      let evidence = s.store.getEvidence(first.evidence.id), attempt = s.store.getAttempt(first.attempt.id);
      const target = artifactPath(evidence.contentRef);
      if (corruption === "missing") fs.unlinkSync(target);
      else if (corruption === "corrupt-bytes") fs.appendFileSync(target, "tampered");
      else if (corruption === "wrong-resultRef") {
        const other = path.join(s.resultDirectory, "00000000-0000-0000-0000-000000000000.json");
        fs.copyFileSync(target, other); evidence.contentRef = `${pathToFileURL(other).href}#sha256=${sha256(fs.readFileSync(other))}`;
      } else if (corruption === "wrong-revision") evidence.revision = "0".repeat(64);
      else {
        const record = JSON.parse(fs.readFileSync(target));
        if (corruption === "runtimeRef") record.content.runtimeRef.externalId = "00000000-0000-0000-0000-000000000000";
        else if (corruption === "schema") record.content.extra = "unsupported";
        else record.content[corruption] = "other-lineage";
        const altered = encodeResultArtifact(record.content);
        // Raw fault injection: valid new hash/revision cannot disguise wrong lineage/schema.
        fs.writeFileSync(target, altered.bytes);
        evidence.contentRef = `${pathToFileURL(target).href}#sha256=${altered.hash}`; evidence.revision = altered.revision;
        attempt.resultRef = evidence.contentRef; s.store.putRecord("attempt", attempt.id, attempt);
      }
      s.store.putRecord("evidence", evidence.id, evidence);
      const before = fs.existsSync(target) ? fs.readFileSync(target) : null;
      const fresh = freshResultController({ store: s.store, root, resultDirectory: s.resultDirectory });
      const result = await fresh.controller.reconcileTask("g8-task");
      assert.equal(result.action, "REVIEW"); assert.equal(result.verification.verdict, "FAIL");
      assert.equal(result.task.status, "NEEDS_REVIEW");
      assert.equal(fresh.runtime.startCalls, 0); assert.equal(fresh.runtime.executions.size, 0);
      assert.equal(s.store.allRecords("run").length, 1); assert.equal(s.store.allRecords("attempt").length, 1); assert.equal(s.store.allRecords("evidence").length, 1);
      assert.ok(fresh.facts[0].reason);
      if (before) assert.deepEqual(fs.readFileSync(target), before); else assert.equal(fs.existsSync(target), false);
      const again = await fresh.controller.reconcileTask("g8-task");
      assert.equal(again.verification.verdict, "FAIL"); assert.equal(s.store.allRecords("verification").length, 3);
      assert.equal(fresh.runtime.startCalls, 0);
    });
  }
  check("resolver rejects foreign schemes/roots/traversal and missing hash pins", async t => {
    const s = setup(t, backend, { reviewRequired: true }), first = await s.execute();
    const pin = expected(s.store, first.evidence), ref = first.evidence.contentRef;
    for (const bad of ["https://example.invalid/result", pathToFileURL(path.join(s.control, "outside.json")).href + "#sha256=" + "0".repeat(64),
      ref.split("#")[0], ref.replace(/[^/]+\.json/, "../outside.json"), ref.replace(/[^/]+\.json/, "%2e%2e%2foutside.json")]) {
      assert.throws(() => resolveRuntimeResult(s.resultDirectory, bad, pin));
    }
  });
  check("nonzero Runtime archives output but creates no candidate Evidence or Acceptance", async t => {
    const s = setup(t, backend, { mode: "fail" }), result = await s.execute();
    assert.equal(result.action, "FAILED"); assert.equal(result.attempt.status, "FAILED");
    assert.equal(s.store.allRecords("evidence").length, 0); assert.equal(s.store.allRecords("verification").length, 0);
    assert.equal(s.store.getTask("g8-task").status, "IN_PROGRESS");
    const artifact = JSON.parse(fs.readFileSync(artifactPath(result.attempt.resultRef)));
    assert.equal(artifact.content.exitCode, 7); assert.equal(artifact.content.outcome, "FAILED");
  });
}

for (const fault of ["none", "missing", "corrupt"]) test(`fresh process durable reproof: ${fault}`, { skip: !isSqliteAvailable() && SQLITE_REQUIREMENT }, t => {
  const f = files(t), helper = fileURLToPath(new URL("../helpers/g8-durable-result-child.mjs", import.meta.url));
  const child = mode => {
    const result = spawnSync(process.execPath, [helper, mode, f.database, root, f.resultDirectory],
      { encoding: "utf8", windowsHide: true, timeout: 30000, killSignal: "SIGKILL" });
    assert.equal(result.error, undefined, String(result.error)); assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const a = child("checkpoint");
  assert.equal(a.result.action, "REVIEW", JSON.stringify(a.facts));
  assert.equal(a.result.task.status, "NEEDS_REVIEW"); assert.equal(a.result.verification.verdict, "INCONCLUSIVE");
  assert.equal(a.resultMapSize, 0); assert.equal(a.startCalls, 1);
  const target = artifactPath(a.result.evidence.contentRef), bytes = fs.readFileSync(target), stat = fs.statSync(target);
  const reader = new SqliteStore(f.database);
  try { assert.deepEqual(reader.getEvidence(a.result.evidence.id), a.result.evidence); assert.deepEqual(reader.getAttempt(a.result.attempt.id), a.result.attempt); }
  finally { reader.close(); }
  if (fault === "missing") fs.unlinkSync(target);
  if (fault === "corrupt") fs.appendFileSync(target, "tampered");
  const b = child("reprove");
  if (fault !== "none") {
    assert.equal(b.result.action, "REVIEW"); assert.equal(b.result.task.status, "NEEDS_REVIEW");
    assert.equal(b.startCalls, 0); assert.equal(b.runtimeMapSize, 0);
    assert.deepEqual(b.verifications.map(v => v.verdict), ["INCONCLUSIVE", "FAIL", "FAIL"]);
    assert.equal(b.runs.length, 1); assert.equal(b.attempts.length, 1); assert.equal(b.evidence.length, 1);
    assert.ok(b.facts.every(f => f.verdict === "FAIL" && f.reason));
    return;
  }
  assert.equal(b.result.action, "ACCEPT", JSON.stringify(b.facts)); assert.equal(b.result.replayAction, "NOOP");
  assert.equal(b.startCalls, 0); assert.equal(b.runtimeMapSize, 0); assert.equal(b.resultMapSize, null);
  assert.equal(b.result.evidence.id, a.result.evidence.id); assert.equal(b.runs.length, 1); assert.equal(b.attempts.length, 1); assert.equal(b.evidence.length, 1);
  assert.deepEqual(b.verifications.map(v => v.verdict), ["INCONCLUSIVE", "PASS"]);
  assert.deepEqual(b.events.slice(0, a.events.length), a.events);
  assert.deepEqual(fs.readFileSync(target), bytes); assert.equal(fs.statSync(target).mtimeMs, stat.mtimeMs);
  const reopened = new SqliteStore(f.database);
  try { assert.equal(reopened.getTask("g8-task").status, "ACCEPTED"); assert.equal(reopened.getAttempt(a.result.attempt.id).resultRef, a.result.evidence.contentRef); }
  finally { reopened.close(); }
  t.diagnostic(JSON.stringify({ resultRef: a.result.evidence.contentRef, revision: a.result.evidence.revision, artifactHash: sha256(bytes), processA: a, processB: b }));
});
