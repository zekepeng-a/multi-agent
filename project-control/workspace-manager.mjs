import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import {
  InvariantError,
  WorkspaceAccess,
  WorkspaceKind,
  WorkspaceStatus,
  createWorkspace,
} from "./domain.mjs";

const ABSENT = "ABSENT";

function normalizeRelative(input) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new InvariantError("workspace path must be a non-empty relative path");
  }
  if (path.isAbsolute(input) || /^[A-Za-z]:[\\/]/.test(input)) {
    throw new InvariantError(`absolute workspace path is forbidden: ${input}`);
  }
  const normalized = input.replaceAll("\\", "/").replace(/^\.\//, "");
  const parts = normalized.split("/");
  if (
    parts.some((part) => part === "" || part === "." || part === ".." || part === ".git") ||
    normalized.includes("\0")
  ) {
    throw new InvariantError(`unsafe workspace path: ${input}`);
  }
  return parts.join("/");
}

function normalizeScope(scope) {
  const s = normalizeRelative(scope).replace(/\/$/, "");
  return s;
}

function pathInsideScope(rel, scope) {
  return rel === scope || rel.startsWith(scope + "/");
}

function assertNoSymlinkTraversal(root, rel) {
  let current = path.resolve(root);
  for (const part of rel.split("/").slice(0, -1)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) continue;
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new InvariantError(`workspace path traverses symlink: ${rel}`);
    }
  }
}

function resolveInside(root, rel) {
  const normalized = normalizeRelative(rel);
  const base = path.resolve(root);
  const resolved = path.resolve(base, ...normalized.split("/"));
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new InvariantError(`workspace path escapes root: ${rel}`);
  }
  assertNoSymlinkTraversal(base, normalized);
  return { normalized, resolved };
}

function fileDigest(file) {
  if (!fs.existsSync(file)) return ABSENT;
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) throw new InvariantError(`workspace file is a symlink: ${file}`);
  if (!stat.isFile()) return `TYPE:${stat.isDirectory() ? "DIR" : "OTHER"}`;
  return "sha256:" + createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function walkFiles(root, prefix = "") {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      throw new InvariantError(`workspace contains symlink: ${rel}`);
    }
    if (entry.isDirectory()) out.push(...walkFiles(full, rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

export function workspaceRevision(root) {
  const base = path.resolve(root);
  fs.mkdirSync(base, { recursive: true });
  const hash = createHash("sha256");
  for (const rel of walkFiles(base)) {
    hash.update(rel);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(base, ...rel.split("/"))));
    hash.update("\0");
  }
  return "sha256:" + hash.digest("hex");
}

export class WorkspaceManager {
  constructor({ store, isolationRoot } = {}) {
    if (!store) throw new Error("WorkspaceManager requires store");
    if (typeof isolationRoot !== "string" || isolationRoot.trim() === "") {
      throw new Error("WorkspaceManager requires isolationRoot");
    }
    this.store = store;
    this.isolationRoot = path.resolve(isolationRoot);
    fs.mkdirSync(this.isolationRoot, { recursive: true });
  }

  createShared({
    id,
    projectId,
    root,
    access = WorkspaceAccess.WRITE,
    writeScopes = [],
  } = {}) {
    const rootRef = path.resolve(root);
    fs.mkdirSync(rootRef, { recursive: true });
    const revision = workspaceRevision(rootRef);
    const workspace = createWorkspace({
      id,
      projectId,
      kind: WorkspaceKind.SHARED,
      access,
      rootRef,
      baseRevision: revision,
      currentRevision: revision,
      writeScopes: writeScopes.map(normalizeScope),
      status: WorkspaceStatus.ACTIVE,
    });
    return this.store.createWorkspace(workspace);
  }

  createIsolated({
    id,
    projectId,
    parentWorkspaceId,
    owner = null,
    access = WorkspaceAccess.WRITE,
    writeScopes,
  } = {}) {
    const parent = this.store.getWorkspace(parentWorkspaceId);
    if (parent.kind !== WorkspaceKind.SHARED) {
      throw new InvariantError(`isolated workspace parent ${parent.id} is not SHARED`);
    }
    if (parent.projectId !== projectId) {
      throw new InvariantError(`isolated workspace project differs from parent project`);
    }
    const rootRef = path.join(this.isolationRoot, normalizeRelative(id));
    fs.mkdirSync(rootRef, { recursive: true });
    const scopes = (writeScopes ?? []).map(normalizeScope);
    const workspace = createWorkspace({
      id,
      projectId,
      kind: WorkspaceKind.ISOLATED,
      access,
      owner,
      parentWorkspaceId,
      rootRef,
      baseRevision: parent.currentRevision,
      currentRevision: workspaceRevision(rootRef),
      writeScopes: scopes,
      status: WorkspaceStatus.ACTIVE,
    });
    return this.store.createWorkspace(workspace);
  }

  readFile(workspaceId, rel) {
    const ws = this.store.getWorkspace(workspaceId);
    const { normalized, resolved } = resolveInside(ws.rootRef, rel);
    if (ws.kind === WorkspaceKind.ISOLATED && !fs.existsSync(resolved)) {
      const parent = this.store.getWorkspace(ws.parentWorkspaceId);
      const base = resolveInside(parent.rootRef, normalized).resolved;
      if (!fs.existsSync(base)) throw new Error(`workspace file not found: ${normalized}`);
      return fs.readFileSync(base, "utf8");
    }
    if (!fs.existsSync(resolved)) throw new Error(`workspace file not found: ${normalized}`);
    return fs.readFileSync(resolved, "utf8");
  }

  writeFile(workspaceId, rel, content) {
    let ws = this.store.getWorkspace(workspaceId);
    if (ws.access !== WorkspaceAccess.WRITE) {
      throw new InvariantError(`workspace ${workspaceId} is READ_ONLY`);
    }
    if (![WorkspaceStatus.ACTIVE, WorkspaceStatus.DIRTY].includes(ws.status)) {
      throw new InvariantError(`workspace ${workspaceId} is ${ws.status} and is not writable`);
    }
    const { normalized, resolved } = resolveInside(ws.rootRef, rel);
    this.#assertWriteScope(ws, normalized);

    const touchedPaths = structuredClone(ws.touchedPaths ?? {});
    if (ws.kind === WorkspaceKind.ISOLATED && !(normalized in touchedPaths)) {
      const parent = this.store.getWorkspace(ws.parentWorkspaceId);
      const parentFile = resolveInside(parent.rootRef, normalized).resolved;
      touchedPaths[normalized] = { baseDigest: fileDigest(parentFile) };
    }

    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, String(content), "utf8");
    const currentRevision = this.visibleRevision(workspaceId);

    ws = this.store.updateWorkspace(ws.id, ws.version, {
      status: WorkspaceStatus.DIRTY,
      currentRevision,
      touchedPaths,
    });
    return { workspace: ws, path: normalized, revision: currentRevision };
  }

  markReady(workspaceId) {
    const ws = this.store.getWorkspace(workspaceId);
    if (ws.kind !== WorkspaceKind.ISOLATED) {
      throw new InvariantError("only isolated workspaces are integrated");
    }
    if (![WorkspaceStatus.ACTIVE, WorkspaceStatus.DIRTY].includes(ws.status)) {
      throw new InvariantError(`workspace ${workspaceId} cannot become ready from ${ws.status}`);
    }
    return this.store.updateWorkspace(ws.id, ws.version, {
      status: WorkspaceStatus.READY_TO_INTEGRATE,
      currentRevision: this.visibleRevision(workspaceId),
    });
  }

  visibleRevision(workspaceId) {
    const ws = this.store.getWorkspace(workspaceId);
    if (ws.kind === WorkspaceKind.SHARED) return workspaceRevision(ws.rootRef);

    const parent = this.store.getWorkspace(ws.parentWorkspaceId);
    const paths = new Set([...walkFiles(parent.rootRef), ...walkFiles(ws.rootRef)]);
    const hash = createHash("sha256");
    for (const rel of [...paths].sort()) {
      const overlayFile = resolveInside(ws.rootRef, rel).resolved;
      const source = fs.existsSync(overlayFile)
        ? overlayFile
        : resolveInside(parent.rootRef, rel).resolved;
      hash.update(rel);
      hash.update("\0");
      hash.update(fs.readFileSync(source));
      hash.update("\0");
    }
    return "sha256:" + hash.digest("hex");
  }

  refreshShared(workspaceId) {
    const ws = this.store.getWorkspace(workspaceId);
    if (ws.kind !== WorkspaceKind.SHARED) throw new InvariantError("refreshShared requires SHARED workspace");
    const currentRevision = workspaceRevision(ws.rootRef);
    if (currentRevision === ws.currentRevision) return ws;
    return this.store.updateWorkspace(ws.id, ws.version, {
      currentRevision,
      status: WorkspaceStatus.DIRTY,
    });
  }

  integrateAll(workspaceIds) {
    if (!Array.isArray(workspaceIds) || workspaceIds.some((id) => typeof id !== "string" || id.trim() === "")) {
      throw new InvariantError("integrateAll requires workspace ids");
    }
    // Completion order is not authority. A stable identity order gives the
    // control plane one deterministic integration sequence for the same ready set.
    const ordered = [...new Set(workspaceIds)].sort((left, right) => left.localeCompare(right));
    return ordered.map((workspaceId) => this.integrate(workspaceId));
  }

  integrate(workspaceId) {
    let isolated = this.store.getWorkspace(workspaceId);
    if (isolated.kind !== WorkspaceKind.ISOLATED) {
      throw new InvariantError("integration source must be ISOLATED");
    }
    if (![WorkspaceStatus.READY_TO_INTEGRATE, WorkspaceStatus.DIRTY].includes(isolated.status)) {
      throw new InvariantError(`workspace ${workspaceId} is ${isolated.status} and is not integratable`);
    }
    let shared = this.store.getWorkspace(isolated.parentWorkspaceId);
    if (shared.kind !== WorkspaceKind.SHARED) throw new InvariantError("integration target must be SHARED");

    const touched = Object.keys(isolated.touchedPaths ?? {}).sort();
    const conflicts = [];
    for (const rel of touched) {
      const currentFile = resolveInside(shared.rootRef, rel).resolved;
      const current = fileDigest(currentFile);
      if (current !== isolated.touchedPaths[rel].baseDigest) conflicts.push(rel);
    }

    if (conflicts.length) {
      isolated = this.store.updateWorkspace(isolated.id, isolated.version, {
        status: WorkspaceStatus.CONFLICTED,
        integration: {
          targetWorkspaceId: shared.id,
          integratedRevision: null,
          conflictPaths: conflicts,
          integratedAt: null,
        },
      }, { eventType: "workspace.conflicted" });
      return { status: "CONFLICTED", workspace: isolated, shared, conflictPaths: conflicts, appliedPaths: [] };
    }

    const backups = new Map();
    const applied = [];
    try {
      for (const rel of touched) {
        const src = resolveInside(isolated.rootRef, rel).resolved;
        if (!fs.existsSync(src)) continue;
        const dest = resolveInside(shared.rootRef, rel).resolved;
        backups.set(rel, fs.existsSync(dest) ? fs.readFileSync(dest) : null);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        applied.push(rel);
      }
    } catch (error) {
      for (const rel of applied.reverse()) {
        const dest = resolveInside(shared.rootRef, rel).resolved;
        const old = backups.get(rel);
        try {
          if (old === null) fs.rmSync(dest, { force: true });
          else fs.writeFileSync(dest, old);
        } catch {
          // Reality is re-observed below; never claim integration on rollback failure.
        }
      }
      const observed = workspaceRevision(shared.rootRef);
      if (observed !== shared.currentRevision) {
        shared = this.store.updateWorkspace(shared.id, shared.version, {
          currentRevision: observed,
          status: WorkspaceStatus.DIRTY,
        });
      }
      throw error;
    }

    const integratedRevision = workspaceRevision(shared.rootRef);
    shared = this.store.updateWorkspace(shared.id, shared.version, {
      currentRevision: integratedRevision,
      status: WorkspaceStatus.ACTIVE,
    }, { eventType: "workspace.integrated_target" });

    isolated = this.store.updateWorkspace(isolated.id, isolated.version, {
      status: WorkspaceStatus.INTEGRATED,
      currentRevision: this.visibleRevision(isolated.id),
      integration: {
        targetWorkspaceId: shared.id,
        integratedRevision,
        conflictPaths: [],
        integratedAt: new Date().toISOString(),
      },
    }, { eventType: "workspace.integrated" });

    return { status: "INTEGRATED", workspace: isolated, shared, conflictPaths: [], appliedPaths: applied };
  }

  #assertWriteScope(ws, rel) {
    if (ws.kind === WorkspaceKind.ISOLATED && ws.writeScopes.length === 0) {
      throw new InvariantError(`workspace ${ws.id} has no write scope`);
    }
    if (ws.writeScopes.length && !ws.writeScopes.some((scope) => pathInsideScope(rel, scope))) {
      throw new InvariantError(`workspace ${ws.id} may not write ${rel}; outside enforced write scopes`);
    }
  }
}
