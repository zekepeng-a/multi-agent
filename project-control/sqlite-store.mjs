// Durable backend: SQLite via the built-in `node:sqlite` module.
//
// Design notes for this spike:
//  - Direct transactional state updates + an append-only domain event log.
//    NOT event sourcing: the event log is history, the tables are authority.
//  - Every authoritative mutation runs in ONE transaction that writes the state
//    row, its domain event and (when present) its command/idempotency row
//    together, so a half-applied mutation cannot survive a failure.
//  - State tables store the authoritative record as JSON in `body`, plus the
//    identity/version/reference columns the control plane actually queries or
//    compares. That is a deliberate spike tradeoff: a real deployment would
//    normalize further and add indexes per query; it would not need a mapper
//    framework to do it.
//  - No foreign key constraints on purpose: the store intentionally allows a
//    dangling Evidence record to exist (ownership is proven when a Verification
//    or an Acceptance tries to use it), so the lineage rules stay in one place —
//    ./store.mjs — rather than being half-enforced by the schema.
//  - No SQL leaks out of this file: the Controller and the control rules only
//    ever see ProjectControlStore's primitives.

import { createRequire } from "node:module";
import { ProjectControlStore, Collection } from "./store.mjs";

const require = createRequire(import.meta.url);

export const SQLITE_REQUIREMENT =
  "the built-in node:sqlite module is required (Node >= 22.5; unflagged on Node 22.13+ / 23.4+ / 24)";

let cachedDriver;
function sqliteDriver() {
  if (cachedDriver === undefined) {
    try {
      cachedDriver = require("node:sqlite");
    } catch {
      cachedDriver = null;
    }
  }
  return cachedDriver;
}

/** Whether this Node runtime can host SqliteStore. Never throws. */
export function isSqliteAvailable() {
  return sqliteDriver() !== null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id      TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  status  TEXT NOT NULL,
  body    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id                 TEXT PRIMARY KEY,
  version            INTEGER NOT NULL,
  acceptance_id      TEXT NOT NULL,
  acceptance_version INTEGER NOT NULL,
  status             TEXT NOT NULL,
  body               TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS acceptance_revisions (
  id      TEXT NOT NULL,
  version INTEGER NOT NULL,
  status  TEXT NOT NULL,
  body    TEXT NOT NULL,
  PRIMARY KEY (id, version)
);

-- Contract content fingerprints live in their own table on purpose: a body that
-- is edited in place (by hand, by a migration, by another writer) no longer
-- matches its fingerprint, and the revision then fails closed on read.
CREATE TABLE IF NOT EXISTS acceptance_contracts (
  id          TEXT NOT NULL,
  version     INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  PRIMARY KEY (id, version),
  FOREIGN KEY (id, version) REFERENCES acceptance_revisions (id, version)
);

CREATE TABLE IF NOT EXISTS runs (
  id      TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status  TEXT NOT NULL,
  body    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id     TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  body   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL,
  run_id     TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  body       TEXT NOT NULL
);

-- task_id / acceptance revision are real foreign keys because the rules prove
-- them before the insert. Evidence deliberately has NONE: a dangling evidence
-- record is allowed to exist and is rejected when something tries to use it, so
-- both backends keep identical semantics and the lineage rules keep a single
-- owner (./store.mjs).
CREATE TABLE IF NOT EXISTS verifications (
  id                 TEXT PRIMARY KEY,
  task_id            TEXT NOT NULL,
  acceptance_id      TEXT NOT NULL,
  acceptance_version INTEGER NOT NULL,
  body               TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks (id),
  FOREIGN KEY (acceptance_id, acceptance_version) REFERENCES acceptance_revisions (id, version)
);

CREATE TABLE IF NOT EXISTS commands (
  command_id TEXT PRIMARY KEY,
  operation  TEXT NOT NULL,
  result_id  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  seq               INTEGER PRIMARY KEY,
  event_id          TEXT NOT NULL UNIQUE,
  type              TEXT NOT NULL,
  aggregate_type    TEXT NOT NULL,
  aggregate_id      TEXT NOT NULL,
  aggregate_version INTEGER,
  payload           TEXT NOT NULL,
  command_id        TEXT,
  occurred_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS runs_by_task ON runs (task_id);
CREATE INDEX IF NOT EXISTS evidence_by_task ON evidence (task_id);
CREATE INDEX IF NOT EXISTS events_by_aggregate ON events (aggregate_id);
`;

// collection → table, key scope, projected columns and the columns the store
// filters on. Table/column names come from this constant, never from input.
const SHAPES = {
  [Collection.PROJECT]: {
    table: "projects",
    scope: "id",
    columns: (r) => ({ id: r.id, version: r.version, status: r.status }),
    filters: { id: "id" },
  },
  [Collection.TASK]: {
    table: "tasks",
    scope: "id",
    columns: (r) => ({
      id: r.id,
      version: r.version,
      acceptance_id: r.acceptanceId,
      acceptance_version: r.acceptanceVersion,
      status: r.status,
    }),
    filters: { id: "id", taskId: "id" },
  },
  [Collection.ACCEPTANCE]: {
    table: "acceptance_revisions",
    scope: "revision",
    columns: (r) => ({ id: r.id, version: r.version, status: r.status }),
    filters: { id: "id", version: "version" },
  },
  [Collection.RUN]: {
    table: "runs",
    scope: "id",
    columns: (r) => ({ id: r.id, task_id: r.taskId, version: r.version, status: r.status }),
    filters: { id: "id", taskId: "task_id" },
  },
  [Collection.ATTEMPT]: {
    table: "attempts",
    scope: "id",
    columns: (r) => ({ id: r.id, run_id: r.runId }),
    filters: { id: "id", runId: "run_id" },
  },
  [Collection.EVIDENCE]: {
    table: "evidence",
    scope: "id",
    columns: (r) => ({ id: r.id, task_id: r.taskId, run_id: r.runId, attempt_id: r.attemptId }),
    filters: { id: "id", taskId: "task_id" },
  },
  [Collection.VERIFICATION]: {
    table: "verifications",
    scope: "id",
    columns: (r) => ({
      id: r.id,
      task_id: r.taskId,
      acceptance_id: r.acceptanceId,
      acceptance_version: r.acceptanceVersion,
    }),
    filters: { id: "id", taskId: "task_id" },
  },
};

function shapeFor(collection) {
  const shape = SHAPES[collection];
  if (!shape) throw new Error(`unknown collection: ${collection}`);
  return shape;
}

// Acceptance revisions are addressed by the composite key `id@version`; every
// other collection is addressed by its id. Contract ids never contain "@".
function keyParams(shape, key) {
  if (shape.scope !== "revision") return [key];
  const at = key.lastIndexOf("@");
  if (at < 1) throw new Error(`malformed acceptance revision key: ${key}`);
  return [key.slice(0, at), Number(key.slice(at + 1))];
}

export class SqliteStore extends ProjectControlStore {
  #db;
  #depth = 0;
  #closed = false;

  constructor(file, { busyTimeoutMs = 5000 } = {}) {
    super();
    const sqlite = sqliteDriver();
    if (!sqlite) throw new Error(`SqliteStore unavailable: ${SQLITE_REQUIREMENT}`);
    this.#db = new sqlite.DatabaseSync(file);
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#db.exec("PRAGMA foreign_keys = ON");
    this.#db.exec(`PRAGMA busy_timeout = ${Number(busyTimeoutMs)}`);
    this.#db.exec(SCHEMA);
  }

  // ── Backend primitives ────────────────────────────────────────────────────

  getRecord(collection, key) {
    const shape = shapeFor(collection);
    const row = this.#db
      .prepare(`SELECT body FROM ${shape.table} WHERE ${shape.scope === "revision" ? "id = ? AND version = ?" : "id = ?"}`)
      .get(...keyParams(shape, key));
    return row ? JSON.parse(row.body) : null;
  }

  putRecord(collection, key, record) {
    const shape = shapeFor(collection);
    this.#upsert(shape, key, record);
  }

  insertRecord(collection, key, record) {
    const shape = shapeFor(collection);
    const where = shape.scope === "revision" ? "id = ? AND version = ?" : "id = ?";
    const exists = this.#db.prepare(`SELECT 1 AS present FROM ${shape.table} WHERE ${where}`).get(...keyParams(shape, key));
    if (exists) return false;
    const columns = shape.columns(record);
    const names = Object.keys(columns);
    this.#db
      .prepare(`INSERT INTO ${shape.table} (${names.join(", ")}, body) VALUES (${names.map(() => "?").join(", ")}, ?)`)
      .run(...names.map((name) => columns[name]), JSON.stringify(record));
    return true;
  }

  updateRecord(collection, key, record, expectedVersion) {
    const shape = shapeFor(collection);
    const columns = shape.columns(record);
    const names = Object.keys(columns);
    const where = shape.scope === "revision" ? "id = ? AND version = ?" : "id = ?";
    const guards = expectedVersion === undefined ? [] : ["version = ?"];
    const info = this.#db
      .prepare(
        `UPDATE ${shape.table} SET ${names.map((name) => `${name} = ?`).join(", ")}, body = ? ` +
          `WHERE ${where}${guards.length ? " AND version = ?" : ""}`,
      )
      .run(
        ...names.map((name) => columns[name]),
        JSON.stringify(record),
        ...keyParams(shape, key),
        ...(expectedVersion === undefined ? [] : [expectedVersion]),
      );
    return Number(info.changes) === 1;
  }

  allRecords(collection) {
    const shape = shapeFor(collection);
    return this.#db.prepare(`SELECT body FROM ${shape.table}`).all().map((row) => JSON.parse(row.body));
  }

  recordsMatching(collection, field, value) {
    const shape = shapeFor(collection);
    const column = shape.filters[field];
    if (!column) throw new Error(`cannot filter ${collection} by ${field}`);
    return this.#db
      .prepare(`SELECT body FROM ${shape.table} WHERE ${column} = ?`)
      .all(value)
      .map((row) => JSON.parse(row.body));
  }

  getCommand(commandId) {
    const row = this.#db
      .prepare("SELECT operation, result_id FROM commands WHERE command_id = ?")
      .get(commandId);
    return row ? { operation: row.operation, resultId: row.result_id } : null;
  }

  putCommand(commandId, entry) {
    this.#db
      .prepare("INSERT INTO commands (command_id, operation, result_id) VALUES (?, ?, ?) ON CONFLICT(command_id) DO NOTHING")
      .run(commandId, entry.operation, entry.resultId);
  }

  getContractFingerprint(key) {
    const [id, version] = keyParams(shapeFor(Collection.ACCEPTANCE), key);
    const row = this.#db
      .prepare("SELECT fingerprint FROM acceptance_contracts WHERE id = ? AND version = ?")
      .get(id, version);
    return row ? row.fingerprint : null;
  }

  putContractFingerprint(key, fingerprint) {
    const [id, version] = keyParams(shapeFor(Collection.ACCEPTANCE), key);
    this.#db
      .prepare(
        "INSERT INTO acceptance_contracts (id, version, fingerprint) VALUES (?, ?, ?) " +
          "ON CONFLICT(id, version) DO UPDATE SET fingerprint = excluded.fingerprint",
      )
      .run(id, version, fingerprint);
  }

  appendEvent(event) {
    // The event id is a function of the append sequence, so it is computed here
    // with the row rather than derived later. Writers hold the write lock inside
    // the surrounding transaction, so MAX(seq)+1 cannot race another writer.
    const seq = Number(this.#db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM events").get().next);
    const eventId = `evt-${seq}`;
    this.#db
      .prepare(
        "INSERT INTO events (seq, event_id, type, aggregate_type, aggregate_id, aggregate_version, payload, command_id, occurred_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        seq,
        eventId,
        event.type,
        event.aggregateType,
        event.aggregateId,
        event.aggregateVersion ?? null,
        JSON.stringify(event.payload ?? null),
        event.commandId ?? null,
        event.occurredAt,
      );
    return { id: eventId, ...event };
  }

  allEvents() {
    return this.#db
      .prepare(
        "SELECT event_id, type, aggregate_type, aggregate_id, aggregate_version, payload, command_id, occurred_at " +
          "FROM events ORDER BY seq",
      )
      .all()
      .map((row) => ({
        id: row.event_id,
        type: row.type,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        aggregateVersion: row.aggregate_version,
        payload: JSON.parse(row.payload),
        commandId: row.command_id,
        occurredAt: row.occurred_at,
      }));
  }

  /**
   * One transaction per authoritative mutation: state + event + idempotency row
   * commit together or not at all. Nested calls join the outer transaction, so a
   * failure anywhere rolls the whole thing back.
   */
  runInTransaction(fn) {
    if (this.#depth > 0) return fn();
    this.#depth += 1;
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.#db.exec("ROLLBACK");
      } catch {
        // already rolled back by SQLite
      }
      throw error;
    } finally {
      this.#depth -= 1;
    }
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#db.close();
  }

  #upsert(shape, key, record) {
    const columns = shape.columns(record);
    const names = Object.keys(columns);
    const conflict = shape.scope === "revision" ? "(id, version)" : "(id)";
    const updates = [...names.filter((name) => name !== "id"), "body"]
      .map((name) => `${name} = excluded.${name}`)
      .join(", ");
    this.#db
      .prepare(
        `INSERT INTO ${shape.table} (${names.join(", ")}, body) VALUES (${names.map(() => "?").join(", ")}, ?) ` +
          `ON CONFLICT${conflict} DO UPDATE SET ${updates}`,
      )
      .run(...names.map((name) => columns[name]), JSON.stringify(record));
  }
}
