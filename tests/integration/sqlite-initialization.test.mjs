import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { SqliteStore, isSqliteAvailable, SQLITE_REQUIREMENT } from "../../project-control/sqlite-store.mjs";

const skip = !isSqliteAvailable() && SQLITE_REQUIREMENT;
const helper = fileURLToPath(new URL("../helpers/pc-sqlite-init-child.mjs", import.meta.url));
const pause = () => new Promise(resolve => setTimeout(resolve, 10));
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-sqlite-init-"));
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
  const file = path.join(dir, "control.db");
  const holder = new DatabaseSync(file);
  holder.exec("CREATE TABLE lock_probe (id INTEGER)");
  t.after(() => { holder.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  return { dir, file, holder };
}
async function contendedOpen({ dir, file, holder }, timeout, releaseAfterMs) {
  holder.exec("BEGIN EXCLUSIVE");
  const ready = path.join(dir, "opening");
  const proc = spawn(process.execPath, [helper, file, ready, String(timeout)], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stdout = "", stderr = "", closed = false, spawnError = null, releaseTimer;
  proc.stdout.on("data", chunk => { stdout += chunk; }); proc.stderr.on("data", chunk => { stderr += chunk; });
  const done = new Promise(resolve => {
    proc.on("error", error => { spawnError = error; });
    proc.on("close", code => { closed = true; resolve(code); });
  });
  let lockHeld = true;
  try {
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(ready)) {
      assert.ok(!closed && !spawnError, stderr || spawnError?.message || "initializer exited before opening");
      assert.ok(Date.now() < deadline, "initializer readiness deadline"); await pause();
    }
    if (releaseAfterMs != null) releaseTimer = setTimeout(() => { holder.exec("ROLLBACK"); lockHeld = false; }, releaseAfterMs);
    while (!closed) { assert.ok(Date.now() < deadline, "initializer completion deadline"); await pause(); }
    assert.equal(await done, 0, stderr);
    return JSON.parse(stdout);
  } finally {
    clearTimeout(releaseTimer);
    if (lockHeld) holder.exec("ROLLBACK");
    if (!closed) proc.kill("SIGKILL");
    let timer;
    try { await Promise.race([done, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("initializer cleanup deadline")), 2000); })]); }
    finally { clearTimeout(timer); }
  }
}

test("SQLite initializer waits for a real process-held lock and succeeds after release", { skip }, async t => {
  const f = fixture(t);
  const result = await contendedOpen(f, 2000, 300);
  assert.equal(result.success, true, result.message);
  assert.ok(result.elapsedMs >= 250 && result.elapsedMs < 5000, JSON.stringify(result));
  const db = new (createRequire(import.meta.url)("node:sqlite").DatabaseSync)(f.file);
  try { assert.equal(db.prepare("PRAGMA journal_mode").get().journal_mode, "wal"); }
  finally { db.close(); }
  t.diagnostic(JSON.stringify(result));
});
test("SQLite initializer exceeds its lock timeout with an explicit bounded BUSY failure", { skip }, async t => {
  const f = fixture(t);
  const result = await contendedOpen(f, 300, null);
  assert.equal(result.success, false);
  assert.equal(result.errcode & 255, 5, JSON.stringify(result));
  assert.match(result.message, /locked|busy/i);
  assert.ok(result.elapsedMs >= 250 && result.elapsedMs < 3000, JSON.stringify(result));
  new SqliteStore(f.file).close();
  t.diagnostic(JSON.stringify(result));
});
test("SQLite default initialization wait survives a lock released after the old immediate-failure window", { skip }, async t => {
  const result = await contendedOpen(fixture(t), "default", 300);
  assert.equal(result.success, true, result.message);
  assert.ok(result.elapsedMs >= 250, JSON.stringify(result));
});
test("SQLite initializer normalizes timeout inputs and refuses unsafe PRAGMA values before opening", { skip }, t => {
  const f = fixture(t);
  for (const value of [NaN, Infinity, -1, 1.5, 2147483648, "", "1; DROP TABLE projects", "NaN", null, true, {}]) {
    const file = path.join(f.dir, `invalid-${Math.random()}.db`);
    assert.throws(() => new SqliteStore(file, { busyTimeoutMs: value }), /busyTimeoutMs/);
    assert.equal(fs.existsSync(file), false);
  }
  for (const value of [0, 1, " 5000 "]) new SqliteStore(f.file, { busyTimeoutMs: value }).close();
});
test("SQLite schema guard and IO errors remain failures rather than transient retries", { skip }, t => {
  const f = fixture(t);
  assert.throws(() => new SqliteStore(f.dir), /open|directory|disk|unable/i);
  const db = new (createRequire(import.meta.url)("node:sqlite").DatabaseSync)(f.file);
  db.exec("CREATE TABLE evidence (id TEXT PRIMARY KEY, body TEXT NOT NULL)"); db.close();
  assert.throws(() => new SqliteStore(f.file), /schema|migration|target/i);
});
