// Real filesystem provider integration; no Workspace writes or Runtime execution.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { MemoryStore } from "../../project-control/memory-store.mjs";
import { SqliteStore, isSqliteAvailable, SQLITE_REQUIREMENT } from "../../project-control/sqlite-store.mjs";
import { markerHash, ACTION, CAPABILITY } from "../helpers/g8-local-file-effect-driver.mjs";
import { seedEffectWorld, effectController, authorizeEffectCommand } from "../helpers/g8-effect-fixture.mjs";

function fixture(t, backend, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "g8-effect-provider-"));
  const controlDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "g8-effect-control-"));
  const database = backend === "sqlite" ? path.join(controlDirectory, "control.db") : null;
  const store = database ? new SqliteStore(database) : new MemoryStore();
  t.after(() => { store.close?.(); for (const dir of [directory, controlDirectory]) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  assert.ok(!path.resolve(directory).startsWith(path.resolve(fileURLToPath(new URL("../../", import.meta.url)))));
  assert.notEqual(path.dirname(database ?? controlDirectory), directory);
  seedEffectWorld(store);
  const slice = effectController(store, directory, { ...options, database });
  const originalParents = Object.fromEntries(["project", "milestone", "goal", "task", "acceptance"].map(type => [type, store.allRecords(type)]));
  return { store, directory, database, originalParents, ...slice };
}
function separated(s) {
  for (const type of ["project", "milestone", "goal", "task", "acceptance"]) assert.deepEqual(s.store.allRecords(type), s.originalParents[type]);
  for (const type of ["evidence", "verification", "run", "attempt", "workspace"]) assert.equal(s.store.allRecords(type).length, 0);
  assert.equal(s.store.getControlCommand("command-2").status, "AUTHORIZED");
}
function verifyFile(s) {
  const bytes = fs.readFileSync(s.driver.target);
  assert.deepEqual(bytes, s.driver.expectedMarker());
  const marker = JSON.parse(bytes);
  assert.equal(marker.payloadHash, markerHash(Buffer.from(JSON.stringify(marker.payload))));
  return { bytes: bytes.toString(), hash: markerHash(bytes) };
}
function trace(t, s, effect) {
  t.diagnostic(JSON.stringify({ providerDirectory: s.directory, destination: effect.destination,
    effect, file: fs.existsSync(s.driver.target) ? verifyFile(s) : null,
    dispatchCalls: s.driver.dispatchCalls, writes: s.driver.writes,
    command: s.store.getControlCommand("command-2"),
    events: s.store.allEvents().filter(event => event.aggregateId === effect.id) }));
}
for (const backend of ["memory", "sqlite"]) {
  const skip = backend === "sqlite" && !isSqliteAvailable() ? SQLITE_REQUIREMENT : false;
  const check = (name, fn) => test(`G8 real Effect ${backend}: ${name}`, { skip }, fn);
  check("direct success has committed intent, exact bytes and no Acceptance authority", async t => {
    const s = fixture(t, backend); authorizeEffectCommand(s.store, s.controller);
    assert.equal(fs.existsSync(s.driver.target), false);
    const effect = await s.controller.dispatchEffect({ ...s.input, action: "caller-forged", capability: "caller-forged" }, { mutationId: "op-direct" });
    assert.equal(effect.action, ACTION); assert.equal(effect.capability, CAPABILITY);
    assert.equal(effect.status, "SUCCEEDED"); assert.equal(effect.dispatchCount, 1);
    assert.equal(effect.reconciliation.status, "NOT_REQUIRED");
    const file = verifyFile(s);
    assert.equal(effect.externalReceipt.receiptId, `sha256:${file.hash}`);
    assert.equal(effect.externalReceipt.resultRef, `${pathToFileURL(s.driver.target).href}#sha256=${file.hash}`);
    assert.ok(effect.reconciliation.observationRef.endsWith(file.hash));
    assert.equal(s.driver.dispatchCalls, 1); assert.equal(s.driver.writes, 1);
    const before = s.store.allEvents(), stat = fs.statSync(s.driver.target);
    assert.deepEqual(await s.controller.dispatchEffect(s.input, { mutationId: "op-direct" }), effect);
    assert.deepEqual(s.store.allEvents(), before); assert.equal(s.driver.dispatchCalls, 1);
    assert.equal(s.driver.writes, 1); assert.equal(fs.statSync(s.driver.target).mtimeMs, stat.mtimeMs);
    assert.notEqual(effect.id, "op-direct"); assert.notEqual(effect.id, effect.idempotencyKey);
    assert.ok(s.store.getCommand("op-direct:request"));
    separated(s); trace(t, s, effect);
  });
  check("after-write lost response is UNKNOWN until new driver observes Reality", async t => {
    const s = fixture(t, backend, { modes: ["after-write"] }); authorizeEffectCommand(s.store, s.controller);
    const unknown = await s.controller.dispatchEffect(s.input, { mutationId: "op-lost" });
    assert.equal(unknown.status, "UNKNOWN"); assert.equal(unknown.reconciliation.status, "REQUIRED");
    const file = verifyFile(s), stat = fs.statSync(s.driver.target), events = s.store.allEvents();
    await assert.rejects(s.controller.retryEffect(unknown.id, unknown.version), /FAILED_NO_EFFECT|UNKNOWN/);
    assert.deepEqual(s.store.allEvents(), events);
    assert.deepEqual(await s.controller.dispatchEffect(s.input, { mutationId: "op-lost" }), unknown);
    assert.equal(s.driver.dispatchCalls, 1); assert.equal(s.driver.writes, 1);
    const fresh = effectController(s.store, s.directory, { database: s.database, modes: ["before-write"] });
    const resolved = await fresh.controller.reconcileEffect(unknown.id, unknown.version, { mutationId: "op-observe" });
    assert.equal(resolved.status, "SUCCEEDED"); assert.equal(resolved.dispatchCount, 1);
    assert.equal(resolved.reconciliation.status, "RESOLVED");
    assert.equal(fresh.driver.dispatchCalls, 0); assert.equal(fresh.driver.writes, 0);
    assert.equal(resolved.externalReceipt.receiptId, `sha256:${file.hash}`);
    assert.equal(fs.statSync(s.driver.target).mtimeMs, stat.mtimeMs);
    verifyFile(s); separated(s); trace(t, s, resolved);
  });
  check("before-write uncertainty requires positive empty-provider observation before retry", async t => {
    const s = fixture(t, backend, { modes: ["before-write", "success"] }); authorizeEffectCommand(s.store, s.controller);
    const unknown = await s.controller.dispatchEffect(s.input, { mutationId: "op-empty" });
    assert.equal(unknown.status, "UNKNOWN"); assert.equal(unknown.dispatchCount, 1);
    assert.equal(s.driver.writes, 0); assert.deepEqual(fs.readdirSync(s.directory), []);
    await assert.rejects(s.controller.retryEffect(unknown.id, unknown.version), /FAILED_NO_EFFECT|UNKNOWN/);
    const noEffect = await s.controller.reconcileEffect(unknown.id, unknown.version, { mutationId: "op-empty-observation" });
    assert.equal(noEffect.status, "FAILED_NO_EFFECT"); assert.equal(noEffect.reconciliation.status, "RESOLVED");
    assert.match(noEffect.reconciliation.observationRef, /empty-marker-only-provider/);
    const history = s.store.allEvents();
    const retried = await s.controller.retryEffect(noEffect.id, noEffect.version, { mutationId: "op-safe-retry" });
    assert.equal(retried.status, "SUCCEEDED"); assert.equal(retried.dispatchCount, 2);
    assert.equal(s.driver.dispatchCalls, 2); assert.equal(s.driver.writes, 1); verifyFile(s);
    assert.deepEqual(s.store.allEvents().slice(0, history.length), history);
    assert.ok(history.some(e => e.type === "effect.unknown"));
    assert.ok(history.some(e => e.type === "effect.reconciled_no_effect"));
    const events = s.store.allEvents();
    assert.deepEqual(await s.controller.retryEffect(noEffect.id, noEffect.version, { mutationId: "op-safe-retry" }), retried);
    assert.equal(s.driver.dispatchCalls, 2); assert.deepEqual(s.store.allEvents(), events);
    separated(s); trace(t, s, retried);
  });
  for (const corruption of ["effectId", "commandId", "idempotencyKey", "payload", "payloadHash", "malformed", "unexpected-file"]) {
    check(`${corruption} Reality cannot resolve UNKNOWN or permit retry`, async t => {
      const s = fixture(t, backend, { modes: ["after-write"] }); authorizeEffectCommand(s.store, s.controller);
      const unknown = await s.controller.dispatchEffect(s.input);
      const marker = JSON.parse(fs.readFileSync(s.driver.target));
      if (corruption === "malformed") fs.writeFileSync(s.driver.target, "not-json");
      else if (corruption === "unexpected-file") {
        fs.unlinkSync(s.driver.target); fs.writeFileSync(path.join(s.directory, "ambiguous.tmp"), "unattributed");
      } else { marker[corruption] = "wrong"; fs.writeFileSync(s.driver.target, JSON.stringify(marker)); }
      const before = fs.readdirSync(s.directory).map(name => [name, fs.readFileSync(path.join(s.directory, name)).toString()]);
      const result = await s.controller.reconcileEffect(unknown.id, unknown.version);
      assert.equal(result.status, "UNKNOWN"); assert.equal(result.reconciliation.status, "REQUIRED");
      assert.equal(result.reconciliation.lastObservation, "UNKNOWN");
      await assert.rejects(s.controller.retryEffect(result.id, result.version), /FAILED_NO_EFFECT|UNKNOWN/);
      assert.equal(s.driver.dispatchCalls, 1); assert.equal(s.driver.writes, 1);
      assert.deepEqual(fs.readdirSync(s.directory).map(name => [name, fs.readFileSync(path.join(s.directory, name)).toString()]), before);
      separated(s);
    });
  }
  check("CREATED, missing and policy-REJECTED Command never create Effect or call provider", async t => {
    const s = fixture(t, backend, { deny: true });
    await assert.rejects(s.controller.dispatchEffect(s.input), /AUTHORIZED/);
    await assert.rejects(s.controller.dispatchEffect({ ...s.input, commandId: "missing-command" }), /not found|missing/);
    assert.equal(s.controller.authorizeCommand("command-2", 1).action, "REJECT");
    await assert.rejects(s.controller.dispatchEffect(s.input), /AUTHORIZED/);
    assert.equal(s.driver.dispatchCalls, 0); assert.equal(s.store.allRecords("effect").length, 0);
    assert.deepEqual(fs.readdirSync(s.directory), []);
  });
  check("stale target is rejected at existing authorization boundary", async t => {
    const s = fixture(t, backend);
    s.store.updateTask("t2", 1, { title: "new target version" });
    assert.equal(s.controller.authorizeCommand("command-2", 1).action, "REJECT");
    await assert.rejects(s.controller.dispatchEffect(s.input), /AUTHORIZED/);
    assert.equal(s.driver.dispatchCalls, 0); assert.deepEqual(fs.readdirSync(s.directory), []);
  });
}

test("Effect-only independent process restart reconciles lost response without a second dispatch/write", { skip: !isSqliteAvailable() && SQLITE_REQUIREMENT }, t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "g8-effect-restart-provider-"));
  const controlDir = fs.mkdtempSync(path.join(os.tmpdir(), "g8-effect-restart-control-"));
  const database = path.join(controlDir, "control.db");
  t.after(() => { for (const dir of [directory, controlDir]) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  const helper = fileURLToPath(new URL("../helpers/g8-effect-child.mjs", import.meta.url));
  const child = mode => {
    // No descendants/barrier. spawnSync enforces a hard execution deadline,
    // kills on timeout and waits for process termination before returning.
    const result = spawnSync(process.execPath, [helper, mode, database, directory], { encoding: "utf8", timeout: 15000, killSignal: "SIGKILL", windowsHide: true });
    assert.equal(result.error, undefined, String(result.error)); assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const lost = child("lose-response");
  assert.equal(lost.result.status, "UNKNOWN"); assert.equal(lost.result.reconciliation.status, "REQUIRED");
  assert.equal(lost.dispatchCalls, 1); assert.equal(lost.writes, 1);
  const target = path.join(directory, "marker.json"), bytes = fs.readFileSync(target), stat = fs.statSync(target);
  const reader = new SqliteStore(database);
  try { assert.deepEqual(reader.getEffect("effect-2"), lost.result); } finally { reader.close(); }
  const resolved = child("reconcile");
  assert.equal(resolved.result.status, "SUCCEEDED"); assert.equal(resolved.result.dispatchCount, 1);
  assert.equal(resolved.result.reconciliation.status, "RESOLVED");
  assert.equal(resolved.dispatchCalls, 0); assert.equal(resolved.writes, 0);
  assert.deepEqual(fs.readFileSync(target), bytes); assert.equal(fs.statSync(target).mtimeMs, stat.mtimeMs);
  assert.equal(resolved.result.externalReceipt.receiptId, `sha256:${markerHash(bytes)}`);
  assert.deepEqual(resolved.events.slice(0, lost.events.length), lost.events);
  assert.equal(resolved.events.filter(e => e.type === "effect.dispatched").length, 1);
  const reopened = new SqliteStore(database);
  try {
    assert.deepEqual(reopened.getEffect("effect-2"), resolved.result);
    assert.equal(reopened.allRecords("evidence").length, 0); assert.equal(reopened.allRecords("verification").length, 0);
    assert.notEqual(reopened.getTask("t2").status, "ACCEPTED");
  } finally { reopened.close(); }
  t.diagnostic(JSON.stringify({ database, destination: target, lost, resolved, payloadHash: markerHash(bytes) }));
});
