# G6 Workspace / Reality / Concurrency — Implementation Evidence

**Roadmap phase:** G6  
**Architecture decision:** `ADR-0005-workspace-isolation-boundary.md`  
**Verified head:** `49eed7a4f03c80522ad3226f8c1c2d5067393ad1`  
**CI run:** GitHub Actions `36686990655`

## Implemented boundary

G6 introduces a durable Workspace control object plus a local filesystem
WorkspaceManager that makes shared reality and isolated writer overlays explicit.

Implemented concepts:

- Workspace identity distinct from Run / Attempt / RuntimeRef;
- SHARED vs ISOLATED workspace kind;
- READ_ONLY vs WRITE access;
- enforced write scopes;
- deterministic workspace revision digest;
- overlay-over-shared reads;
- isolated writes that do not mutate SHARED before integration;
- per-path base digest capture;
- conflict-safe integration;
- deterministic ready-set integration order;
- durable Workspace records in MemoryStore and SQLite;
- optional Workspace lineage on Evidence;
- fail-closed stale/non-shared Workspace Evidence.

## Filesystem isolation

Real temporary-directory tests prove that two isolated writers have distinct roots,
can modify the same logical path independently, and cannot alter the authoritative
SHARED tree before integration.

The implementation rejects:

- writes outside declared scope;
- path traversal;
- writes to READ_ONLY workspaces;
- symlink traversal through WorkspaceManager path resolution.

## Conflict-safe integration

For each touched path, the isolated workspace records the digest observed in
SHARED before its first write.

Integration re-reads the current SHARED digest for every touched path.

If any digest differs:

```text
isolated → CONFLICTED
shared   → unchanged
overlay  → preserved / inspectable
```

If unrelated SHARED files changed, integration is not falsely rejected.

On successful integration:

- patch files are copied in deterministic path order;
- SHARED revision is recomputed from filesystem reality;
- SHARED durable currentRevision is updated;
- isolated Workspace becomes INTEGRATED;
- integration records target workspace, integrated revision, timestamp;
- `workspace.integrated_target` and `workspace.integrated` history is written.

## Deterministic integration order

`WorkspaceManager.integrateAll(workspaceIds)` deduplicates and sorts WorkspaceIds
before sequential integration.

Therefore runtime completion order is not integration authority.

The same ready set produces the same control-plane integration order.

## Workspace-bound Evidence

Evidence may carry:

```yaml
workspace_id: WorkspaceId
workspace_revision: revision
```

Current rules require both fields together.

Acceptance-relevant Workspace Evidence must bind a SHARED Workspace in current
shared-reality state and its exact current revision.

Tests prove:

- current SHARED revision is accepted;
- after SHARED reality changes + refresh, evidence pinned to the old revision is
  rejected as stale;
- isolated-workspace Evidence is rejected for acceptance because isolated patch
  reality is not authoritative project reality.

## Persistence / restart

SQLite persists Workspace identity, optimistic version, parent relation, access,
status, current revision, touched-path observations and integration metadata in
the record body.

A restart test closes and reopens SQLite, reconstructs WorkspaceManager over the
same roots, and proves the isolated Workspace record/revision plus overlay file
remain available.

## CI verification

Latest full CI:

```text
Node 22.23.2
tests   501
pass    501
fail    0
skipped 0
```

Package-floor CI:

```text
Node 20.20.2
tests   501
pass    341
fail    0
skipped 160
```

Node 20 skips the capability-gated SQLite-backed paths; Node 22 remains the full
Project Control persistence baseline.

## Exit-criteria assessment

ADR-0005 / Roadmap G6 exit criteria are satisfied for the bounded local provider:

1. Workspace identity is independent from execution/runtime identities — covered.
2. concurrent writers receive distinct writable roots — covered.
3. isolated writes do not mutate SHARED before integration — covered.
4. writes outside enforced scope are refused — covered.
5. READ_ONLY cannot write — covered.
6. shared readers observe the same deterministic SHARED revision without writer isolation needs — implementation property.
7. touched-path base mismatch becomes CONFLICTED before patch application — covered.
8. unrelated SHARED changes do not falsely conflict — covered.
9. successful integration changes SHARED revision and records lineage — covered.
10. later integration rechecks current SHARED reality — covered by two-writer conflict.
11. losing overlay remains inspectable — covered.
12. Workspace record/version survives SQLite restart — covered.
13. Workspace-bound Evidence rejects stale/non-authoritative revision — covered.
14. ready-set integration order is deterministic and independent of completion order — covered.
15. Node 22 full CI passes with zero skips — 501/501.

## Explicitly outside G6

G6 does not claim:

- distributed leases/fencing;
- multiple competing control-plane coordinators;
- Git worktree provider;
- container provider;
- automatic LLM conflict resolution;
- DSH Team writeScopes as Project authority.

Those remain future work only if a concrete requirement appears.
