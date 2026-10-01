import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { SqliteStore, isSqliteAvailable, SQLITE_REQUIREMENT } from "../../project-control/sqlite-store.mjs";
import { capsules, seedCapsuleFixture, generate, dispatch } from "../helpers/pc-capsule-fixture.mjs";
import { MemoryStore } from "../../project-control/memory-store.mjs";
import { LocalProcessRuntimeAdapter } from "../../project-control/local-process-runtime.mjs";
import { DshWorkflowRuntimeAdapter } from "../../project-control/dsh-workflow-runtime.mjs";

const skip = !isSqliteAvailable() && SQLITE_REQUIREMENT;
const helper = fileURLToPath(new URL("../helpers/pc-capsule-child.mjs", import.meta.url));
function files(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "capsule-restart-"));
  const stores = [];
  t.after(() => { for (const store of stores) store.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  const artifact = path.join(dir, "reality.txt"); fs.writeFileSync(artifact, "reality-1");
  return { database: path.join(dir, "control.db"), artifact, stores };
}
function child(mode, fixture, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [helper, mode, fixture.database, fixture.artifact], { encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, expectedStatus, result.stderr || String(result.error));
  return result.stdout ? JSON.parse(result.stdout) : null;
}
test("Capsule true process restart preserves exact delivered archive, receipt, binding, history and replay", { skip }, t => {
  const f = files(t); child("prepare", f); const prepared = child("read", f);
  assert.equal(prepared.attempt.capsuleDelivery.status, "PREPARED");
  child("receive", f); const received = child("read", f), again = child("read", f);
  assert.equal(received.record.payloadJson, prepared.record.payloadJson);
  assert.equal(received.record.payloadHash, prepared.record.payloadHash);
  assert.equal(received.attempt.capsuleDelivery.status, "RECEIVED");
  assert.equal(received.attempt.capsuleDelivery.observations[0].receipt.payloadHash, prepared.record.payloadHash);
  assert.deepEqual(again, received); assert.equal(again.replayAddedEvents, 0);
  assert.equal(child("try-dispatch", f).calls, 0);
});
test("Capsule restart of DISPATCHING becomes UNKNOWN; fresh regeneration cannot overwrite Attempt input", { skip }, t => {
  const f = files(t); child("prepare", f); child("intent", f);
  assert.equal(child("read", f).attempt.capsuleDelivery.status, "DISPATCHING");
  child("recover", f); const recovered = child("read", f);
  assert.equal(recovered.attempt.capsuleDelivery.status, "UNKNOWN");
  assert.equal(recovered.attempt.status, "LOST");
  const store = new SqliteStore(f.database); f.stores.push(store);
  assert.throws(() => capsules(store).generate({ id: "new", projectId: "p", taskId: "ct", runId: "cr", attemptId: "cat" }, { commandId: "replace" }), /dispatchable|replaced/);
  assert.equal(child("try-dispatch", f).calls, 0);
});
test("Capsule restart re-observes actual filesystem; missing/corrupt archive fails closed", { skip }, t => {
  const f = files(t); child("prepare", f); const original = child("read", f);
  fs.writeFileSync(f.artifact, "reality-2");
  const drift = child("try-dispatch", f); assert.match(drift.error, /drift|unresolved/); assert.equal(drift.calls, 0);
  assert.equal(child("read", f).record.payloadJson, original.record.payloadJson);
  const store = new SqliteStore(f.database); f.stores.push(store);
  // Simulate damaged disk data independently of the immutable API.
  const { DatabaseSync } = awaitImportSqlite(); const db = new DatabaseSync(f.database);
  const record = store.getRecord("context_capsule", "capsule-1"); record.payloadJson = "{}";
  db.prepare("UPDATE context_capsules SET body = ? WHERE id = ?").run(JSON.stringify(record), "capsule-1"); db.close();
  assert.throws(() => capsules(store).history("capsule-1"), /integrity/);
  assert.throws(() => capsules(store).reserve({ capsuleId: "missing", attemptId: "cat", expectedDeliveryVersion: 1 }, { commandId: "missing" }), /missing/);
});
test("refusal transaction process death rolls back the old partial-commit window; restart never redispatches", { skip }, t => {
  const f = files(t); child("prepare", f); child("refuse-crash", f, 77);
  assert.ok(fs.existsSync(`${f.artifact}.refusal-window`));
  const interrupted = child("read", f);
  assert.equal(interrupted.attempt.capsuleDelivery.status, "DISPATCHING");
  assert.equal(interrupted.attempt.capsuleDelivery.observations?.length ?? 0, 0);
  assert.equal(interrupted.run.status, "RUNNING");
  assert.equal(interrupted.attempt.endedAt, null);
  assert.equal(interrupted.observationReplay, null);
  assert.equal(interrupted.events.filter(e => e.type === "attempt.updated" && e.aggregateId === "cat" && e.payload.status === "FAILED").length, 0);
  assert.equal(interrupted.events.filter(e => e.type === "capsule.delivery-observed").length, 0);
  child("recover", f);
  const recovered = child("read", f);
  assert.equal(recovered.attempt.capsuleDelivery.status, "UNKNOWN");
  assert.equal(recovered.attempt.status, "LOST"); assert.equal(recovered.run.status, "BLOCKED");
  child("recover", f); assert.deepEqual(child("read", f), recovered);
  assert.equal(child("try-dispatch", f).calls, 0);
  assert.equal(fs.readFileSync(`${f.artifact}.refusal-calls`, "utf8"), "call\n");
});
test("committed refusal survives lost response/restart with terminal execution and immutable delivery history", { skip }, t => {
  const f = files(t); child("prepare", f); child("refuse-commit", f, 78);
  const refused = child("read", f);
  assert.equal(refused.attempt.capsuleDelivery.status, "NOT_RECEIVED");
  assert.equal(refused.attempt.status, "FAILED"); assert.equal(refused.run.status, "FAILED");
  assert.ok(refused.attempt.endedAt && !Number.isNaN(Date.parse(refused.attempt.endedAt)));
  assert.ok(refused.observationReplay);
  assert.equal(refused.events.filter(e => e.type === "attempt.updated" && e.aggregateId === "cat" && e.payload.status === "FAILED").length, 1);
  assert.equal(refused.events.filter(e => e.type === "capsule.delivery-observed").length, 1);
  child("recover", f); assert.deepEqual(child("read", f), refused);
  child("recover", f);
  assert.deepEqual(child("replay-dispatch", f), { replay: true, calls: 0 });
  assert.deepEqual(child("replay-dispatch", f), { replay: true, calls: 0 });
  assert.deepEqual(child("read", f), refused); // timestamps/events/replay are unchanged.
  assert.equal(child("try-dispatch", f).calls, 0);
  assert.equal(fs.readFileSync(`${f.artifact}.refusal-calls`, "utf8"), "call\n");
});
// Lazy import keeps Node 20 compatibility; the SQLite tests themselves are skipped.
import { createRequire } from "node:module";
const awaitImportSqlite = () => createRequire(import.meta.url)("node:sqlite");

test("two independent SQLite processes compete for one Capsule reservation and one external call", { skip }, async t => {
  const f = files(t); child("prepare", f);
  const processes = ["a", "b"].map(tag => {
    const proc = spawn(process.execPath, [helper, "race", f.database, f.artifact, tag], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "", stderr = ""; proc.stdout.on("data", x => stdout += x); proc.stderr.on("data", x => stderr += x);
    const done = new Promise((resolve, reject) => { proc.on("error", reject); proc.on("close", code => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr))); });
    t.after(() => { if (proc.exitCode === null) proc.kill(); }); return { tag, done };
  });
  const deadline = Date.now() + 10000;
  while (!processes.every(p => fs.existsSync(`${f.artifact}.${p.tag}.ready`))) {
    assert.ok(Date.now() < deadline, "writer readiness deadline"); await new Promise(resolve => setTimeout(resolve, 10));
  }
  fs.writeFileSync(`${f.artifact}.go`, "go");
  const results = await Promise.all(processes.map(p => p.done));
  assert.equal(results.filter(r => r.won).length, 1); assert.equal(results.reduce((n, r) => n + r.calls, 0), 1);
  const stored = child("read", f);
  assert.equal(stored.events.filter(e => e.type === "capsule.dispatch-reserved").length, 1);
  assert.equal(stored.attempt.capsuleDelivery.status, "RECEIVED");
});

for (const mode of ["snapshot-put", "snapshot-insert"]) test(`${mode}: independent SQLite writers cannot replace the winning immutable payload`, { skip }, async t => {
  const f = files(t); child("prepare", f);
  const processes = ["a", "b"].map(tag => {
    const proc = spawn(process.execPath, [helper, mode, f.database, f.artifact, tag], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "", stderr = ""; proc.stdout.on("data", x => stdout += x); proc.stderr.on("data", x => stderr += x);
    const done = new Promise((resolve, reject) => { proc.on("error", reject); proc.on("close", code => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr))); });
    t.after(() => { if (proc.exitCode === null) proc.kill(); }); return { tag, done };
  });
  const deadline = Date.now() + 10000;
  while (!processes.every(p => fs.existsSync(`${f.artifact}.${p.tag}.ready`))) {
    assert.ok(Date.now() < deadline, "immutable writer readiness deadline"); await new Promise(resolve => setTimeout(resolve, 10));
  }
  fs.writeFileSync(`${f.artifact}.go`, "go");
  const results = await Promise.all(processes.map(p => p.done));
  assert.equal(results.filter(r => r.won).length, 1);
  assert.match(results.find(r => !r.won).error, /immutable|conflict/);
  const winner = results.find(r => r.won), loser = results.find(r => !r.won);
  const store = new SqliteStore(f.database); f.stores.push(store);
  const committed = store.getRecord("context_capsule", "writer-capsule");
  assert.equal(committed.payloadHash, winner.payloadHash);
  assert.notEqual(committed.payloadHash, loser.payloadHash);
  assert.equal(JSON.parse(committed.payloadJson).assemblerVersion, winner.tag);
  const losingPayload = { ...committed, payloadJson: "different payload" };
  assert.throws(() => store.putRecord("context_capsule", committed.id, losingPayload), /immutable/);
  assert.equal(store.insertRecord("context_capsule", committed.id, losingPayload), false);
  assert.deepEqual(store.getRecord("context_capsule", committed.id), committed);
});

for (const kind of ["LocalProcess", "DSH"]) test(`${kind} Adapter accepts exact Capsule bytes and separate live launch config`, async () => {
  const store = new MemoryStore(); seedCapsuleFixture(store);
  let workflowArgs;
  const runtime = kind === "LocalProcess" ? new LocalProcessRuntimeAdapter() : new DshWorkflowRuntimeAdapter({ workflowEngine: { start: args => {
    workflowArgs = args; return { id: "workflow", result: Promise.resolve({ stopReason: "completed", value: "done" }), cancel() {}, dispose() {} };
  } } });
  const control = capsules(store, { runtime }), record = generate(control);
  const launchConfig = kind === "LocalProcess" ? { process: { command: process.execPath, args: ["-e", "process.stdout.write('done')"], env: { PRIVATE_TEST_SECRET: "never-archive" } } } :
    { dshWorkflow: { script: "return 'done'", meta: { name: "bounded", description: "Capsule seam" }, parent: { liveHandle() {} } } };
  const result = await dispatch(control, { launchConfig });
  assert.equal(result.delivery.status, "RECEIVED");
  const execution = runtime.executions.get(result.started.runtimeRef.externalId);
  assert.equal(execution.capsuleInput.payloadJson, record.payloadJson);
  assert.equal(result.started.capsuleReceipt.payloadHash, record.payloadHash);
  const completed = await runtime.collectResult(result.started.runtimeRef); assert.equal(completed.outcome, "COMPLETED");
  assert.ok(!record.payloadJson.includes("never-archive"));
  if (kind === "DSH") assert.equal(workflowArgs.parent, launchConfig.dshWorkflow.parent);
  assert.equal(control.history(record.id).payloadJson, record.payloadJson);
});
