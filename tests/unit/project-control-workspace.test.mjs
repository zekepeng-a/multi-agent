// Workspace / Reality / concurrency boundary (G6).
//
// These tests use real temporary directories so isolation and integration are
// proven against filesystem reality, not mocked path metadata.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { MemoryStore } from "../../project-control/memory-store.mjs";
import {
  SqliteStore,
  isSqliteAvailable,
  SQLITE_REQUIREMENT,
} from "../../project-control/sqlite-store.mjs";
import { WorkspaceManager, workspaceRevision } from "../../project-control/workspace-manager.mjs";
import {
  EvidenceStatus,
  InvariantError,
  WorkspaceAccess,
  WorkspaceKind,
  WorkspaceStatus,
  createAcceptance,
  createEvidence,
  createProject,
  createTask,
} from "../../project-control/domain.mjs";

function fixture(t, { sqlite = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-workspace-"));
  const sharedRoot = path.join(dir, "shared");
  const isolationRoot = path.join(dir, "isolated");
  fs.mkdirSync(sharedRoot, { recursive: true });
  fs.mkdirSync(isolationRoot, { recursive: true });

  const store = sqlite
    ? new SqliteStore(path.join(dir, "project-control.db"))
    : new MemoryStore();

  t.after(() => {
    try { store.close(); } catch {}
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  store.seedProject(createProject({ id: "project-1", name: "Workspace project" }));
  const manager = new WorkspaceManager({ store, isolationRoot });
  return { dir, sharedRoot, isolationRoot, store, manager };
}

function seedFile(root, rel, content) {
  const full = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

test("two isolated writers get distinct roots and cannot mutate SHARED before integration", (t) => {
  const { store, manager, sharedRoot } = fixture(t);
  seedFile(sharedRoot, "src/app.txt", "base");

  const shared = manager.createShared({ id: "shared-1", projectId: "project-1", root: sharedRoot });
  const left = manager.createIsolated({
    id: "iso-left",
    projectId: "project-1",
    parentWorkspaceId: shared.id,
    writeScopes: ["src"],
  });
  const right = manager.createIsolated({
    id: "iso-right",
    projectId: "project-1",
    parentWorkspaceId: shared.id,
    writeScopes: ["src"],
  });

  assert.equal(left.kind, WorkspaceKind.ISOLATED);
  assert.notEqual(left.rootRef, right.rootRef);
  assert.notEqual(left.id, right.id);

  manager.writeFile(left.id, "src/app.txt", "left");
  manager.writeFile(right.id, "src/app.txt", "right");

  assert.equal(fs.readFileSync(path.join(sharedRoot, "src/app.txt"), "utf8"), "base");
  assert.equal(manager.readFile(left.id, "src/app.txt"), "left");
  assert.equal(manager.readFile(right.id, "src/app.txt"), "right");
  assert.equal(store.getWorkspace(shared.id).status, WorkspaceStatus.ACTIVE);
});

test("write scope is enforced and read-only workspaces cannot write", (t) => {
  const { manager, sharedRoot } = fixture(t);
  seedFile(sharedRoot, "src/app.txt", "base");

  const shared = manager.createShared({ id: "shared-1", projectId: "project-1", root: sharedRoot });
  const isolated = manager.createIsolated({
    id: "iso-1",
    projectId: "project-1",
    parentWorkspaceId: shared.id,
    writeScopes: ["src"],
  });

  assert.throws(
    () => manager.writeFile(isolated.id, "docs/readme.md", "no"),
    (error) => error instanceof InvariantError && /outside enforced write scopes/.test(error.message),
  );
  assert.throws(
    () => manager.writeFile(isolated.id, "../escape.txt", "no"),
    (error) => error instanceof InvariantError && /unsafe workspace path/.test(error.message),
  );

  const readOnly = manager.createIsolated({
    id: "iso-read",
    projectId: "project-1",
    parentWorkspaceId: shared.id,
    access: WorkspaceAccess.READ_ONLY,
    writeScopes: ["src"],
  });
  assert.throws(
    () => manager.writeFile(readOnly.id, "src/app.txt", "no"),
    (error) => error instanceof InvariantError && /READ_ONLY/.test(error.message),
  );
});

test("isolated reads overlay their own writes over the shared base", (t) => {
  const { manager, sharedRoot } = fixture(t);
  seedFile(sharedRoot, "src/base.txt", "from-shared");
  seedFile(sharedRoot, "src/keep.txt", "also-shared");

  const shared = manager.createShared({ id: "shared-1", projectId: "project-1", root: sharedRoot });
  const isolated = manager.createIsolated({
    id: "iso-1",
    projectId: "project-1",
    parentWorkspaceId: shared.id,
    writeScopes: ["src"],
  });

  assert.equal(manager.readFile(isolated.id, "src/base.txt"), "from-shared");
  manager.writeFile(isolated.id, "src/base.txt", "from-overlay");
  assert.equal(manager.readFile(isolated.id, "src/base.txt"), "from-overlay");
  assert.equal(manager.readFile(isolated.id, "src/keep.txt"), "also-shared");
});

test("first integration wins; a later patch from the same base conflicts and remains inspectable", (t) => {
  const { manager, sharedRoot } = fixture(t);
  seedFile(sharedRoot, "src/app.txt", "base");

  const shared = manager.createShared({ id: "shared-1", projectId: "project-1", root: sharedRoot });
  const a = manager.createIsolated({
    id: "iso-a", projectId: "project-1", parentWorkspaceId: shared.id, writeScopes: ["src"],
  });
  const b = manager.createIsolated({
    id: "iso-b", projectId: "project-1", parentWorkspaceId: shared.id, writeScopes: ["src"],
  });

  manager.writeFile(a.id, "src/app.txt", "A");
  manager.writeFile(b.id, "src/app.txt", "B");
  manager.markReady(a.id);
  manager.markReady(b.id);

  const first = manager.integrate(a.id);
  assert.equal(first.status, "INTEGRATED");
  assert.equal(fs.readFileSync(path.join(sharedRoot, "src/app.txt"), "utf8"), "A");

  const second = manager.integrate(b.id);
  assert.equal(second.status, "CONFLICTED");
  assert.deepEqual(second.conflictPaths, ["src/app.txt"]);
  assert.equal(fs.readFileSync(path.join(sharedRoot, "src/app.txt"), "utf8"), "A");
  assert.equal(manager.readFile(b.id, "src/app.txt"), "B", "losing overlay remains inspectable");
  assert.equal(second.workspace.status, WorkspaceStatus.CONFLICTED);
});

test("unrelated shared changes do not create a false conflict", (t) => {
  const { manager, sharedRoot } = fixture(t);
  seedFile(sharedRoot, "src/app.txt", "base");
  seedFile(sharedRoot, "docs/readme.md", "v1");

  const shared = manager.createShared({ id: "shared-1", projectId: "project-1", root: sharedRoot });
  const isolated = manager.createIsolated({
    id: "iso-1", projectId: "project-1", parentWorkspaceId: shared.id, writeScopes: ["src"],
  });
  manager.writeFile(isolated.id, "src/app.txt", "patch");
  manager.markReady(isolated.id);

  seedFile(sharedRoot, "docs/readme.md", "v2");
  manager.refreshShared(shared.id);

  const result = manager.integrate(isolated.id);
  assert.equal(result.status, "INTEGRATED");
  assert.equal(fs.readFileSync(path.join(sharedRoot, "src/app.txt"), "utf8"), "patch");
  assert.equal(fs.readFileSync(path.join(sharedRoot, "docs/readme.md"), "utf8"), "v2");
});

test("successful integration changes authoritative shared revision and records lineage", (t) => {
  const { store, manager, sharedRoot } = fixture(t);
  seedFile(sharedRoot, "src/app.txt", "base");

  const shared = manager.createShared({ id: "shared-1", projectId: "project-1", root: sharedRoot });
  const before = shared.currentRevision;
  const isolated = manager.createIsolated({
    id: "iso-1", projectId: "project-1", parentWorkspaceId: shared.id, writeScopes: ["src"],
  });
  manager.writeFile(isolated.id, "src/app.txt", "integrated");
  manager.markReady(isolated.id);
  const result = manager.integrate(isolated.id);

  assert.equal(result.status, "INTEGRATED");
  assert.notEqual(result.shared.currentRevision, before);
  assert.equal(result.shared.currentRevision, workspaceRevision(sharedRoot));
  assert.equal(result.workspace.integration.targetWorkspaceId, shared.id);
  assert.equal(result.workspace.integration.integratedRevision, result.shared.currentRevision);
  assert.ok(result.workspace.integration.integratedAt);
  assert.equal(store.getEvents().filter((event) => event.type === "workspace.integrated").length, 1);
});

test("deterministic integration order ignores completion order", (t) => {
  const { manager, sharedRoot } = fixture(t);
  seedFile(sharedRoot, "a.txt", "a0");
  seedFile(sharedRoot, "b.txt", "b0");

  const shared = manager.createShared({ id: "shared-1", projectId: "project-1", root: sharedRoot });
  const z = manager.createIsolated({
    id: "z-work", projectId: "project-1", parentWorkspaceId: shared.id, writeScopes: ["b.txt"],
  });
  const a = manager.createIsolated({
    id: "a-work", projectId: "project-1", parentWorkspaceId: shared.id, writeScopes: ["a.txt"],
  });

  // z becomes ready first, but the ready-set integration order is stable by id.
  manager.writeFile(z.id, "b.txt", "b1");
  manager.markReady(z.id);
  manager.writeFile(a.id, "a.txt", "a1");
  manager.markReady(a.id);

  const results = manager.integrateAll([z.id, a.id]);
  assert.deepEqual(results.map((result) => result.workspace.id), ["a-work", "z-work"]);
  assert.ok(results.every((result) => result.status === "INTEGRATED"));
  assert.equal(fs.readFileSync(path.join(sharedRoot, "a.txt"), "utf8"), "a1");
  assert.equal(fs.readFileSync(path.join(sharedRoot, "b.txt"), "utf8"), "b1");
});

test("workspace-bound Evidence must point to current SHARED revision", (t) => {
  const { store, manager, sharedRoot } = fixture(t);
  seedFile(sharedRoot, "src/app.txt", "v1");
  const shared = manager.createShared({ id: "shared-1", projectId: "project-1", root: sharedRoot });

  store.seedAcceptance(createAcceptance({
    id: "acceptance-1",
    targetId: "task-1",
    criteria: [{ id: "workspace", type: "WORKSPACE", required: true }],
  }));
  store.seedTask(createTask({
    id: "task-1",
    projectId: "project-1",
    title: "workspace evidence",
    acceptanceId: "acceptance-1",
    acceptanceVersion: 1,
  }));

  const evidence = createEvidence({
    id: "evidence-1",
    taskId: "task-1",
    runId: "run-placeholder",
    attemptId: "attempt-placeholder",
    acceptanceId: "acceptance-1",
    acceptanceVersion: 1,
    revision: "result-1",
    status: EvidenceStatus.CANDIDATE,
    workspaceId: shared.id,
    workspaceRevision: shared.currentRevision,
  });
  assert.equal(store.recordEvidence(evidence).workspaceRevision, shared.currentRevision);

  seedFile(sharedRoot, "src/app.txt", "v2");
  const refreshed = manager.refreshShared(shared.id);
  assert.notEqual(refreshed.currentRevision, shared.currentRevision);

  const stale = createEvidence({
    ...evidence,
    id: "evidence-stale",
  });
  assert.throws(
    () => store.recordEvidence(stale),
    (error) => error instanceof InvariantError && /workspace revision .* is stale/.test(error.message),
  );

  const isolated = manager.createIsolated({
    id: "iso-1", projectId: "project-1", parentWorkspaceId: shared.id, writeScopes: ["src"],
  });
  const isolatedEvidence = createEvidence({
    ...evidence,
    id: "evidence-isolated",
    workspaceId: isolated.id,
    workspaceRevision: isolated.currentRevision,
  });
  assert.throws(
    () => store.recordEvidence(isolatedEvidence),
    (error) => error instanceof InvariantError && /acceptance evidence must bind shared reality/.test(error.message),
  );
});

test("workspace record and revision survive SQLite restart", {
  skip: isSqliteAvailable() ? false : `node:sqlite is unavailable: ${SQLITE_REQUIREMENT}`,
}, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-workspace-restart-"));
  const dbFile = path.join(dir, "project-control.db");
  const sharedRoot = path.join(dir, "shared");
  const isolationRoot = path.join(dir, "isolated");
  fs.mkdirSync(sharedRoot, { recursive: true });
  seedFile(sharedRoot, "src/app.txt", "base");

  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

  let store = new SqliteStore(dbFile);
  store.seedProject(createProject({ id: "project-1", name: "restart" }));
  let manager = new WorkspaceManager({ store, isolationRoot });
  const shared = manager.createShared({ id: "shared-1", projectId: "project-1", root: sharedRoot });
  const isolated = manager.createIsolated({
    id: "iso-1", projectId: "project-1", parentWorkspaceId: shared.id, writeScopes: ["src"],
  });
  manager.writeFile(isolated.id, "src/app.txt", "overlay");
  const before = store.getWorkspace(isolated.id);
  store.close();

  store = new SqliteStore(dbFile);
  manager = new WorkspaceManager({ store, isolationRoot });
  const after = store.getWorkspace(isolated.id);

  assert.equal(after.id, before.id);
  assert.equal(after.version, before.version);
  assert.equal(after.currentRevision, before.currentRevision);
  assert.equal(after.status, WorkspaceStatus.DIRTY);
  assert.equal(manager.readFile(after.id, "src/app.txt"), "overlay");
  store.close();
});
