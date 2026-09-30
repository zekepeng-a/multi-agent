# ADR-0005 — Workspace isolation, revision and integration boundary

**Status:** ACCEPTED  
**Date:** 2026-09-30  
**Roadmap phase:** G6 — Workspace / Reality / concurrency  
**Related invariants:** I-09, I-10, I-21, I-22, I-27, I-28, I-38

## Context

G5 proves Project Control can execute through replaceable runtimes.

That does not make concurrent file/code writes safe.

A runtime may run two workers in parallel, but if both write the same shared tree,
Project Control cannot tell whether:

- one overwrote the other;
- one read a file before the other changed it;
- the final tree corresponds to either worker's evidence;
- an accepted Evidence revision still describes current reality.

The G6 problem is therefore a Reality-layer boundary:

> what durable Workspace identity and integration rules make parallel writes
> isolated, conflict-visible and revision-traceable?

## External evidence

Focused G6 research is recorded in
`docs/architecture/SOURCE_TRACEABILITY.md §24`.

Implementation-backed references:

- Agent Harness: isolation maps to a locked worktree/separate cwd; without
  isolation the fallback is sequential writers.
- DSH Agent Team: `writeScopes` are durable/advisory overlap warnings, but do not
  authorize writes and do not block conflicting claims.
- ExcelManus: conflicting parallel mutation can be rejected before publication;
  read-only workers may share the same file.
- Earthwalker Agent OS: parallel writers use private patch workspaces, writes are
  isolated, global shell/Git actions are blocked inside patches, and one
  deterministic integration path surfaces conflicts rather than silently
  overwriting.

The common boundary is strong enough to settle G6 without broad archaeology.

## Decision

### 1. Workspace is a durable Reality object

Project Control introduces a Workspace control record:

```yaml
id: WorkspaceId
version: integer
project_id: ProjectId
kind: SHARED | ISOLATED
access: READ_ONLY | WRITE
owner:
  run_id: RunId?
  attempt_id: AttemptId?
parent_workspace_id: WorkspaceId?
root_ref: string
base_revision: string
current_revision: string
write_scopes: string[]
status:
  - CREATED
  - ACTIVE
  - DIRTY
  - READY_TO_INTEGRATE
  - INTEGRATED
  - CONFLICTED
  - DISCARDED
integration:
  target_workspace_id: WorkspaceId?
  integrated_revision: string?
  conflict_paths: string[]
  integrated_at: timestamp?
created_at: timestamp
updated_at: timestamp
```

Workspace identity is not Runtime identity.

### 2. One Project has one authoritative SHARED workspace at a time

The SHARED workspace represents the current project code/file reality used for
integration and acceptance-relevant observation.

A Project may have many historical Workspace records, but only one active
authoritative SHARED workspace reference for the current working tree.

G6 does not make the filesystem record itself Project State; it makes the
Workspace record the control-plane pointer to observed Reality.

### 3. Parallel readers may share one revision

Multiple READ_ONLY executions may observe the same SHARED Workspace revision.

Read-only access creates no write authority.

### 4. Shared writers are single-writer in G6

A WRITE execution against the SHARED workspace requires exclusive writer
ownership.

G6 does not implement shared-tree multi-writer locking by path.

If a second writer wants to run concurrently, it must use an ISOLATED workspace.

### 5. Parallel writers require distinct ISOLATED workspaces

Each concurrent write-producing Run/Attempt gets a distinct WorkspaceId and
private write root/overlay.

The isolated workspace pins:

- the parent/shared WorkspaceId;
- the parent's `base_revision`;
- enforced write scopes;
- owner RunId/AttemptId.

Two parallel writers never share the same writable root.

This is the concrete implementation of I-22 for G6.

### 6. writeScopes are enforced capability, not advisory metadata

`write_scopes` are normalized workspace-relative path prefixes.

The WorkspaceManager enforces them at every write boundary.

A runtime/Agent cannot widen its own scopes.

DSH Team `writeScopes` may be imported as planning hints, but they do not become
Project Control authority until normalized and enforced by the WorkspaceManager.

### 7. G6 first implementation uses copy-on-write directory overlays

The first WorkspaceManager is local/filesystem based:

```text
SHARED root
  ↑ read fallback
ISOLATED overlay
  └─ writes only here
```

Reads in an isolated workspace see overlay-over-shared.

Writes never touch the shared tree before integration.

Global shell/Git/destructive operations are outside this overlay manager and are
not implicitly authorized by Workspace write permission.

Git worktrees/containers remain replaceable future Workspace providers.

### 8. Workspace revision is a deterministic reality digest

For the G6 local provider, revision is a deterministic SHA-256 digest over the
workspace-visible file set and file contents.

Provider-specific Workspace implementations may use a Git commit SHA or another
stable revision identity, but the semantic contract is the same:

> one revision identifies one observed workspace state.

Revision identity is distinct from Workspace.version, which is optimistic
concurrency for the Workspace control record.

### 9. Isolated work records per-path base observations

On first write to a path, the isolated WorkspaceManager records the base digest
(or absence) of that path from the parent revision.

At integration time, the manager re-observes every touched path in the current
SHARED workspace.

If any touched path differs from its recorded base observation, integration
fails closed as CONFLICTED.

Unrelated changes outside touched paths do not create a false conflict.

### 10. Integration is a Control Plane action

A runtime/Agent may produce an isolated patch.

It may not integrate itself into the authoritative SHARED workspace.

Integration is performed by one WorkspaceManager/control-plane owner after the
worker settles.

The integration result records:

- touched/applied paths;
- conflict paths;
- prior shared revision;
- resulting shared revision;
- source isolated WorkspaceId.

No LLM decides the mechanical conflict result.

### 11. Conflict means no successful integration claim

If preflight detects a touched-path conflict:

- the isolated workspace becomes CONFLICTED;
- its overlay remains inspectable;
- the SHARED workspace is not modified by that integration attempt;
- no integrated revision is recorded.

If an unexpected filesystem error occurs after preflight, the manager must:

1. fail loudly;
2. attempt rollback of writes already applied;
3. re-observe SHARED reality;
4. never claim INTEGRATED unless resulting reality matches the recorded
   integrated revision.

Current Reality outranks the intended transaction.

### 12. Candidate patch output is not authoritative workspace Evidence

An isolated worker may produce candidate patch/output artifacts.

But:

```text
isolated workspace revision
≠
authoritative shared workspace revision
```

A code/file completion claim that depends on the project working tree may only
bind to the SHARED revision **after successful integration**.

This prevents accepting a patch that never became current project reality.

### 13. Evidence may carry Workspace lineage

G6 extends Evidence lineage conceptually with optional:

```yaml
workspace_id: WorkspaceId?
workspace_revision: string?
```

For acceptance-relevant code/file Evidence, the Controller/Verifier must be able
to re-prove that the named Workspace revision is still current for the intended
reality scope.

G6 implementation may introduce the fields before every legacy Evidence producer
uses them; legacy evidence semantics remain unchanged until a task declares a
Workspace-bound acceptance path.

### 14. Integration order is deterministic

When several isolated workspaces are ready:

- integration order is explicit and stable;
- one integration owner applies them sequentially;
- each integration rechecks current touched-path base observations against the
  latest SHARED reality.

A later patch therefore conflicts if an earlier integrated patch changed one of
its touched base paths.

`Promise.all()` is never treated as an integration strategy.

### 15. G6 does not implement distributed leases/fencing

The first WorkspaceManager is process-local + durable control records.

If implementation requires multiple concurrent coordinator processes writing the
same SHARED workspace, that exposes a new D-class gap for leases/fencing.

Do not add distributed locking before that need exists.

## Alternatives considered

### A. Trust declared writeScopes and run shared-tree writers in parallel

Rejected. DSH itself treats writeScopes as advisory warnings, not write authority.

### B. Detect conflicts only after two writers already mutated the shared tree

Rejected. It loses the ability to identify which result produced current reality.

### C. Force all work sequential forever

Rejected. Safe but needlessly gives up parallel read/write execution when
isolation can provide a real boundary.

### D. Require Git worktrees for every Workspace

Deferred. Git worktrees are a valid provider but not the semantic definition of
Workspace. A local overlay is enough to prove the boundary in G6.

### E. Let the runtime merge its own patch

Rejected. Integration changes authoritative Reality and belongs to the control
boundary, not replaceable runtime execution.

## Consequences

Positive:

- concurrent writers cannot overwrite each other before integration;
- write scopes become enforceable rather than advisory;
- integration conflict is explicit and inspectable;
- Workspace revision can participate in Evidence lineage;
- the design remains compatible with future Git-worktree/container providers.

Costs:

- new durable Workspace records and backend storage;
- filesystem overlay/revision/integration implementation;
- integration is a distinct stage after runtime execution;
- acceptance paths that care about code reality must wait for integrated
  revision evidence;
- multi-process writer ownership remains intentionally out of scope.

## Implementation boundary

After this ADR, the following becomes **B — Missing Implementation**:

- Workspace domain/status/access/kind vocabulary;
- Workspace collection in MemoryStore/SQLite;
- local WorkspaceManager with safe relative-path resolution;
- deterministic shared-tree revision digest;
- SHARED and ISOLATED workspace creation;
- enforced write scopes;
- overlay-over-shared reads and isolated writes;
- per-path base digest capture;
- integration preflight + conflict detection;
- deterministic sequential integration;
- conflict/rollback/re-observation behavior;
- backend parity and restart persistence for Workspace records;
- tests with real temporary directories proving two isolated writers cannot
  overwrite each other before integration;
- tests proving a later integration conflicts when an earlier integration changed
  the same base path;
- optional Evidence workspace lineage fields + lineage validation for
  Workspace-bound Evidence.

Still outside G6:

- distributed/multi-host leases or fencing;
- Git worktree provider;
- container workspace provider;
- DSH Team task/writeScopes as Project authority;
- automatic semantic conflict resolution by LLM;
- long-horizon Roadmap/Decision/Memory objects.

## Verification / exit criteria

G6 is complete only if tests prove:

1. WorkspaceId is distinct from Run/Attempt/runtime ids;
2. two parallel writers receive distinct writable roots;
3. isolated writes do not mutate SHARED before integration;
4. write outside enforced scope is refused;
5. read-only workspace cannot write;
6. identical readers may share one revision safely;
7. touched-path base mismatch produces CONFLICTED before applying the patch;
8. unrelated SHARED changes do not falsely conflict;
9. successful integration changes SHARED revision and records lineage;
10. a later isolated patch rechecks against the latest shared reality;
11. conflict leaves the losing overlay inspectable;
12. Workspace record/version survives SQLite restart;
13. Workspace-bound Evidence cannot claim a non-current/non-integrated revision;
14. parallel completion order does not change deterministic integration order;
15. Node 22 full CI passes with zero skips.
