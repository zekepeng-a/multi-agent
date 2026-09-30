import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { SqliteStore, isSqliteAvailable, SQLITE_REQUIREMENT } from "../../project-control/sqlite-store.mjs";
import { boundary, candidate, promote } from "../helpers/pc-memory-fixture.mjs";

const skip = !isSqliteAvailable() && SQLITE_REQUIREMENT;
const helper = fileURLToPath(new URL("../helpers/pc-memory-child.mjs", import.meta.url));
function files(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-memory-restart-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const artifact = path.join(dir, "required-artifact.txt"); fs.writeFileSync(artifact, "rev-1");
  return { dir, database: path.join(dir, "control.db"), artifact };
}
function child(mode, { database, artifact }, tag) {
  const result = spawnSync(process.execPath, [helper, mode, database, artifact, ...(tag ? [tag] : [])], { encoding: "utf8", timeout: 20000 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return result.stdout ? JSON.parse(result.stdout) : null;
}
test("SQLite real process restart preserves meaning, lineage, lifecycle, events and intent-bound replay", { skip }, (t) => {
  const fixture = files(t); child("write", fixture);
  const first = child("read", fixture); const second = child("read", fixture);
  assert.deepEqual(second.memories, first.memories); assert.deepEqual(second.events, first.events);
  assert.equal(second.replayAddedEvents, 0);
  assert.equal(second.replay.original.status, "SUPERSEDED"); assert.equal(second.replay.original.supersededByMemoryId, "replacement");
  assert.equal(second.replay.replacement.supersedesMemoryId, "original");
  assert.equal(second.withdrawnReplay.staleness.kind, "HUMAN_WITHDRAWAL");
  assert.deepEqual(second.replay.verified.validation, first.replay.verified.validation);
  assert.deepEqual(second.current.map((r) => r.id), ["accepted", "replacement", "verified"]);
});
test("restart recomputes control pins and real filesystem observations; no cached ACTIVE eligibility or unrelated-file invalidation", { skip }, (t) => {
  const fixture = files(t); child("write", fixture);
  const before = child("read", fixture);
  fs.writeFileSync(path.join(fixture.dir, "unrelated.txt"), "unrelated reality change");
  assert.deepEqual(child("read", fixture).current.map((r) => r.id), before.current.map((r) => r.id));
  fs.writeFileSync(fixture.artifact, "rev-2");
  const changed = child("read", fixture);
  assert.deepEqual(changed.current.map((r) => r.id), ["replacement"]);
  assert.equal(changed.replay.verified.status, "ACTIVE");
  assert.match(changed.history.find((r) => r.id === "verified").currentUse.reasons.join(" "), /reality revision changed/);
  assert.deepEqual(changed.events, before.events);
  fs.rmSync(fixture.artifact);
  const unavailable = child("read", fixture);
  assert.ok(unavailable.history.find((r) => r.id === "verified").currentUse.checks.some((c) => c.validity === "UNRESOLVED"));
  assert.equal(unavailable.replay.verified.status, "ACTIVE");
  fs.writeFileSync(fixture.artifact, "rev-2");
  child("change-control", fixture);
  assert.equal(child("read", fixture).current.length, 0);
  child("reconcile", fixture);
  const stale = child("read", fixture);
  assert.equal(stale.replay.verified.status, "STALE");
  assert.equal(stale.replay.verified.staleness.kind, "SOURCE_INVALIDATION");
  assert.equal(stale.replay.replacement.status, "STALE");
  const third = child("read", fixture); assert.equal(third.replayAddedEvents, 0);
  assert.deepEqual(third.events, stale.events);
});
test("two independent SQLite writer processes cannot both replace one expected version", { skip }, async (t) => {
  const fixture = files(t); child("write", fixture);
  const store = new SqliteStore(fixture.database);
  promote(boundary(store), candidate(store), "race-source"); store.close();
  const processes = ["writer-a", "writer-b"].map((tag) => {
    const proc = spawn(process.execPath, [helper, "race", fixture.database, fixture.artifact, tag], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    proc.stdout.on("data", (data) => { stdout += data; }); proc.stderr.on("data", (data) => { stderr += data; });
    const done = new Promise((resolve, reject) => {
      proc.on("error", reject);
      proc.on("close", (code) => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)));
    });
    t.after(() => { if (proc.exitCode == null) proc.kill(); });
    return { tag, done };
  });
  const deadline = Date.now() + 10000;
  while (!processes.every(({ tag }) => fs.existsSync(`${fixture.database}.${tag}.ready`))) {
    assert.ok(Date.now() < deadline, "both writers must reach independent validation barrier");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  fs.writeFileSync(`${fixture.database}.release`, "go");
  const results = await Promise.all(processes.map(({ done }) => done));
  assert.equal(results.filter((r) => r.won).length, 1);
  const reopened = new SqliteStore(fixture.database);
  try {
    const old = reopened.getRecord("memory", "race-source"); assert.equal(old.status, "SUPERSEDED");
    assert.equal(old.version, 2); assert.equal(old.supersededByMemoryId, results.find((r) => r.won).id);
    assert.equal(reopened.allRecords("memory").filter((r) => r.supersedesMemoryId === "race-source").length, 1);
    assert.equal(reopened.getCommand(`race:${results.find((r) => !r.won).id ?? (results[0].won ? "writer-b" : "writer-a")}`), null);
  } finally { reopened.close(); }
});

test("SQLite current-use reads one control snapshot while external reality has its own observation pin/time", { skip }, (t) => {
  const fixture = files(t); child("write", fixture);
  const store = new SqliteStore(fixture.database), writer = new SqliteStore(fixture.database);
  try {
    promote(boundary(store), candidate(store), "late-decision");
    let changed = false;
    const control = boundary(store, { observeReality: (evidence) => {
      if (!changed) {
        changed = true;
        writer.revokeDecision("d", 1, { revokedBy: { type: "HUMAN", actorId: "human" }, reason: "independent writer during reality observation" });
      }
      return { status: "CURRENT", revision: fs.readFileSync(fixture.artifact, "utf8"), observationRef: fixture.artifact, observedAt: new Date().toISOString() };
    } });
    const result = control.query({ projectId: "p" });
    assert.equal(writer.getDecision("d").status, "REVOKED");
    // late-decision is resolved after the observer ran the independent writer.
    assert.ok(result.some((r) => r.id === "late-decision"));
    assert.equal(control.query({ projectId: "p" }).some((r) => r.id === "late-decision"), false);
    assert.match(result.find((r) => r.id === "verified").currentUse.consistency.externalReality, /no cross-boundary atomic/);
  } finally { writer.close(); store.close(); }
});

test("failed SQLite BEGIN does not poison transaction depth or bypass later Memory rollback", { skip }, (t) => {
  const fixture = files(t); child("write", fixture);
  const holder = new SqliteStore(fixture.database), waiting = new SqliteStore(fixture.database, { busyTimeoutMs: 0 });
  try {
    const control = boundary(waiting), input = candidate(waiting);
    const attestation = control.validate(input, { judgement: { faithful: true, reason: "faithful exact source decision", necessarySources: ["DECISION::d"] } });
    const args = { id: "after-busy", candidate: input, attestation };
    holder.runInTransaction(() => assert.throws(() => control.promote(args, { commandId: "after-busy" }), /locked|busy/));
    const before = waiting.allEvents(), append = waiting.appendEvent.bind(waiting);
    waiting.appendEvent = (event) => { append(event); throw new Error("injected failure after busy BEGIN"); };
    assert.throws(() => control.promote(args, { commandId: "after-busy" }), /injected failure/);
    assert.equal(waiting.getRecord("memory", "after-busy"), null);
    assert.equal(waiting.getCommand("after-busy"), null); assert.deepEqual(waiting.allEvents(), before);
    waiting.appendEvent = append;
    assert.equal(control.promote(args, { commandId: "after-busy" }).status, "ACTIVE");
  } finally { waiting.close(); holder.close(); }
});
