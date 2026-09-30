# ADR-0006 — Project-level Acceptance boundary

**Status:** ACCEPTED  
**Date:** 2026-09-30  
**Roadmap phase:** G7.1 — Project-level Acceptance  
**Related invariants:** I-01, I-02, I-09, I-10, I-14, I-27, I-28, I-33, I-36, I-37, I-38, I-39

## Context

`AcceptanceTargetType.PROJECT` already exists, but the Project object cannot pin a
contract revision and the Controller currently marks a Project COMPLETED by
aggregation alone once every Milestone is COMPLETED.

Goal and Milestone already implement the stronger rule:

```text
finished children
      ↓
aggregate Evidence
      ↓
Verification
      ↓
Acceptance
      ↓
parent terminal state
```

The unresolved question is whether Project should reuse that authority model or
keep a special completion rule.

## Evidence / precedent

Existing source-traceability work already established three relevant boundaries:

- **Agent Harness:** execution/candidate evidence cannot directly mutate accepted
  project state; an accepted-state owner validates candidate evidence first.
- **Archify:** proof is revision-pinned; source/repository identity and evidence
  revision are checked before claims are treated as current.
- **Earthwalker Agent OS:** verification evidence is bounded and attached to a
  concrete execution/recovery lineage rather than being an unscoped success flag.

The repository's own Goal/Milestone acceptance implementation is also a proven
local precedent: deterministic aggregate child snapshots, superseded historical
Evidence, PASS Verification re-proof, and atomic target+contract transition.

No new top-level authority boundary is introduced by extending that pattern one
level upward.

## Decision

### 1. Project may optionally pin an Acceptance revision

Project gains:

```yaml
acceptance_id: AcceptanceId?
acceptance_version: integer?
```

Both fields are optional together.

If present, they must name one concrete `PROJECT` Acceptance revision whose
`target_id` is that Project.

### 2. Contract-free Project completion remains legal

A Project without an Acceptance Contract continues the current rule:

```text
all authoritative Milestones COMPLETED
  → Project COMPLETED
```

This preserves existing semantics.

### 3. Contract-bound Project completion requires Project Evidence

A Project with a pinned contract does **not** complete merely because all
Milestones are COMPLETED.

Completed Milestones are the input to Project Acceptance:

```text
all Milestones COMPLETED
  ↓
Project aggregate Evidence
  ↓
Verification
  ↓
Project Acceptance
  ↓
Project COMPLETED
```

### 4. Project aggregate Evidence snapshots authoritative Milestones

Project Evidence is a deterministic observation of every Milestone whose
child-side `projectId` points to the Project.

Each child reference includes at least:

- Milestone id;
- version;
- status;
- pinned Acceptance id/version when present.

The same snapshot reuses one Evidence identity.

A changed Milestone snapshot creates new Evidence and supersedes the previous
current Project Evidence without rewriting history.

### 5. Only ACTIVE Project may enter contract-bound completion

The accepted source-state whitelist is:

```text
ACTIVE
```

PAUSED, COMPLETED and ARCHIVED are not reopened by Project Acceptance.

A contract-bound Project whose Milestones are incomplete remains ACTIVE/WAIT.

### 6. Verification must bind exact Project contract + Evidence revision

A PASS Verification must target:

- targetType = PROJECT;
- targetId = ProjectId;
- the Project's pinned Acceptance id/version;
- the exact current aggregate Evidence revision.

Historical/stale Project Evidence cannot complete the Project.

### 7. Acceptance is atomic with Project state

The acceptance transaction updates:

- Project status → COMPLETED;
- Project version +1;
- pinned Acceptance revision status → PASSED;
- `project.completed` event.

A Project must never be COMPLETED by contract while the corresponding Acceptance
revision remains PENDING.

### 8. Project Acceptance does not manufacture child completion

Project acceptance is only legal after every authoritative Milestone is already
COMPLETED.

It cannot override BLOCKED/incomplete Milestones and cannot turn child state into
success.

## Alternatives considered

### A. Keep Project special: aggregation-only forever

Rejected. It leaves `PROJECT` in the Acceptance target vocabulary without a
real control flow and creates a weaker top-level acceptance authority than Goal
and Milestone.

### B. Require every Project to have a contract

Rejected. Existing projects and lightweight use cases need the aggregate-only
path.

### C. Accept Project from arbitrary Evidence

Rejected. It breaks hierarchy/current-state lineage and permits stale or
unscoped proof to complete the lifecycle root.

### D. Let human Approval complete Project

Rejected. Approval is permission, not correctness (I-29/I-31/I-42).

## Implementation boundary

After this ADR, G7.1 becomes **B — Missing Implementation**:

- Project acceptanceId/acceptanceVersion fields;
- Project contract validation on seed/update;
- Project in aggregate-acceptance maps;
- Project child snapshot over Milestones;
- `acceptProject()` store operation;
- Controller Project contract path;
- aggregate Verification support for PROJECT;
- MemoryStore/SQLite parity through existing Project record;
- tests for contract pinning, stale Evidence, atomic completion and restart.

Still outside G7.1:

- Roadmap domain;
- Decision;
- Memory;
- Context Capsule;
- observability propagation;
- leases/fencing.

## Verification / exit criteria

G7.1 is complete only if tests prove:

1. a Project may pin only a PROJECT contract for its own id;
2. one missing half of the pin is refused;
3. contract-free Project aggregation still completes;
4. contract-bound Project with completed Milestones does not bypass Verification;
5. same Milestone snapshot reuses Evidence identity;
6. changed snapshot supersedes old Evidence;
7. stale Project Evidence cannot complete Project;
8. PASS Verification of current Evidence atomically marks Project COMPLETED and contract PASSED;
9. PAUSED/ARCHIVED/COMPLETED Project cannot re-enter acceptance;
10. restart preserves Project contract pin + accepted state;
11. full Node 22 CI passes with zero skips.
