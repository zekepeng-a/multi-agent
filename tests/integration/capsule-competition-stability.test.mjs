import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isSqliteAvailable, SQLITE_REQUIREMENT, SqliteStore } from "../../project-control/sqlite-store.mjs";
import { runCapsuleCompetition } from "../helpers/pc-capsule-competition.mjs";
import { seedCapsuleFixture, capsules, generate } from "../helpers/pc-capsule-fixture.mjs";

const skip = !isSqliteAvailable() && SQLITE_REQUIREMENT;
const helper = fileURLToPath(new URL("../helpers/pc-capsule-child.mjs", import.meta.url));
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-competition-stability-"));
  const database = path.join(dir, "control.db"), artifact = path.join(dir, "reality.txt");
  fs.writeFileSync(artifact, "reality-1");
  const store = new SqliteStore(database);
  try { seedCapsuleFixture(store, artifact); generate(capsules(store)); } finally { store.close(); }
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return { dir, database, artifact };
}
function assertNoLiveWriters(error) {
  assert.equal(error.writerOutcomes.length, 2);
  for (const writer of error.writerOutcomes) {
    assert.equal(writer.closed, true, JSON.stringify(writer));
    assert.throws(() => process.kill(writer.pid, 0), /ESRCH|no such process/i);
  }
}
for (const mode of ["race", "snapshot-put", "snapshot-insert"]) {
  test(`${mode}: child barrier times out independently when parent never releases go`, { skip }, t => {
    const f = fixture(t), began = Date.now();
    const result = spawnSync(process.execPath, [helper, mode, f.database, f.artifact, "a", "150"],
      { encoding: "utf8", timeout: 4000, windowsHide: true });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /writer a Capsule barrier deadline exceeded/);
    assert.ok(fs.existsSync(`${f.artifact}.a.ready`));
    assert.equal(fs.existsSync(`${f.artifact}.go`), false);
    assert.ok(Date.now() - began < 4000);
  });
  test(`${mode}: initializer early failure fails fast, preserves stderr and closes sibling`, { skip }, async t => {
    const f = fixture(t), began = Date.now();
    let failure;
    try { await runCapsuleCompetition({ ...f, mode, timeoutMs: 8000, writerDatabases: { a: f.dir } }); }
    catch (error) { failure = error; }
    assert.ok(failure);
    assert.match(failure.message, /writer a.*failed/);
    assert.match(failure.message, /unable|open|directory|disk/i);
    assert.equal(failure.writerOutcomes.find(writer => writer.tag === "a").exitCode, 1);
    assert.ok(failure.writerOutcomes.find(writer => writer.tag === "a").stderr.length > 0);
    assert.equal(fs.existsSync(`${f.artifact}.go`), false, "no release when only one writer can be ready");
    assert.ok(Date.now() - began < 4000, "did not wait for the 8-second readiness deadline");
    assertNoLiveWriters(failure);
  });
}
test("Capsule competition overall deadline kills and awaits both unfinished initializers", { skip }, async t => {
  const f = fixture(t);
  // One millisecond is deliberately less than process/module startup. Children
  // cannot both be ready; this tests the parent's deadline/cleanup failure path.
  let failure;
  try { await runCapsuleCompetition({ ...f, mode: "race", timeoutMs: 1, barrierTimeoutMs: 10000 }); }
  catch (error) { failure = error; }
  assert.match(failure?.message ?? "", /overall deadline exceeded/);
  assert.equal(fs.existsSync(`${f.artifact}.go`), false);
  assertNoLiveWriters(failure);
});
