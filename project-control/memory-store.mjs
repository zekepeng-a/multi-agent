// In-process reference backend.
//
// It implements only the storage primitives from ProjectControlStore; every
// control rule (validation, lineage, pinning, idempotency, events) lives in
// ./store.mjs. The Maps stay public because the reference implementation is also
// used as a white-box target by a few tests.

import { ProjectControlStore, Collection } from "./store.mjs";

export class MemoryStore extends ProjectControlStore {
  constructor() {
    super();
    this.projects = new Map();
    this.milestones = new Map();
    this.goals = new Map();
    this.tasks = new Map();
    // Acceptance contract revisions are keyed by (id, version) so that a task
    // pinned to v1 can never be silently served the v2 revision.
    this.acceptances = new Map();
    this.acceptanceContracts = new Map();
    this.runs = new Map();
    this.attempts = new Map();
    this.evidence = new Map();
    this.verifications = new Map();
    // Approvals are keyed by their own id, exactly like every other aggregate:
    // the decision lifecycle is enforced by Compare-And-Set on the record's
    // `version` in the shared rules, not by anything here.
    this.approvals = new Map();
    // Durable Command domain (G2) is separate from the mutation replay registry.
    this.controlCommands = new Map();
    this.effects = new Map();
    this.commands = new Map();
    this.events = [];
  }

  #mapFor(collection) {
    switch (collection) {
      case Collection.PROJECT: return this.projects;
      case Collection.MILESTONE: return this.milestones;
      case Collection.GOAL: return this.goals;
      case Collection.TASK: return this.tasks;
      case Collection.ACCEPTANCE: return this.acceptances;
      case Collection.RUN: return this.runs;
      case Collection.ATTEMPT: return this.attempts;
      case Collection.EVIDENCE: return this.evidence;
      case Collection.VERIFICATION: return this.verifications;
      case Collection.APPROVAL: return this.approvals;
      case Collection.COMMAND: return this.controlCommands;
      case Collection.EFFECT: return this.effects;
      default: throw new Error(`unknown collection: ${collection}`);
    }
  }

  getRecord(collection, key) {
    const record = this.#mapFor(collection).get(key);
    return record ? structuredClone(record) : null;
  }

  putRecord(collection, key, record) {
    this.#mapFor(collection).set(key, structuredClone(record));
  }

  insertRecord(collection, key, record) {
    const map = this.#mapFor(collection);
    if (map.has(key)) return false;
    map.set(key, structuredClone(record));
    return true;
  }

  updateRecord(collection, key, record, expectedVersion) {
    const map = this.#mapFor(collection);
    const current = map.get(key);
    if (!current) return false;
    if (expectedVersion !== undefined && current.version !== expectedVersion) return false;
    map.set(key, structuredClone(record));
    return true;
  }

  allRecords(collection) {
    return [...this.#mapFor(collection).values()].map((record) => structuredClone(record));
  }

  recordsMatching(collection, field, value) {
    return this.allRecords(collection).filter((record) => record[field] === value);
  }

  getCommand(commandId) {
    const entry = this.commands.get(commandId);
    return entry ? structuredClone(entry) : null;
  }

  putCommand(commandId, entry) {
    this.commands.set(commandId, structuredClone(entry));
  }

  getContractFingerprint(key) {
    return this.acceptanceContracts.get(key) ?? null;
  }

  putContractFingerprint(key, fingerprint) {
    this.acceptanceContracts.set(key, fingerprint);
  }

  appendEvent(event) {
    const stored = { id: `evt-${this.events.length + 1}`, ...structuredClone(event) };
    this.events.push(stored);
    return structuredClone(stored);
  }

  allEvents() {
    return structuredClone(this.events);
  }

  /**
   * No-op transaction boundary. The in-process backend is synchronous and every
   * mutation validates before it writes, so there is nothing to roll back; real
   * atomicity and rollback are the durable backend's responsibility
   * (see ./sqlite-store.mjs). Nested calls simply join the caller.
   */
  runInTransaction(fn) {
    return fn();
  }
}
