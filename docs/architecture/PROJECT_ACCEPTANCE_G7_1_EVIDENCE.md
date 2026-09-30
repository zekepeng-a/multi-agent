# G7.1 Project-level Acceptance — Implementation Evidence

**Roadmap phase:** G7.1  
**Architecture decision:** `ADR-0006-project-acceptance-boundary.md`  
**Verified head:** `34a543aad4a7b9a47cd038604c5f3f2890dcbee2`  
**CI run:** GitHub Actions `36687940895`

## Implemented boundary

Project now supports an optional pinned Acceptance revision:

```yaml
acceptance_id: AcceptanceId?
acceptance_version: integer?
```

The two fields are required together and must target that exact PROJECT id.

Contract-free Project completion remains unchanged:

```text
all Milestones COMPLETED
  → Project COMPLETED
```

Contract-bound completion uses the full aggregate acceptance path:

```text
all Milestones COMPLETED
  ↓
Project Aggregate Evidence
  ↓
Verification
  ↓
Project Acceptance
  ↓
Project COMPLETED + contract PASSED
```

## Aggregate Evidence

Project Evidence is a deterministic snapshot of authoritative Milestones selected
through each Milestone's child-side `projectId` relationship.

The snapshot records Milestone identity/version/status and any pinned Acceptance
revision.

The same snapshot reuses one Evidence identity. A changed Milestone version
produces a new Evidence record and marks the older one SUPERSEDED.

## Current-reality re-proof

`acceptProject()` re-proves, in the same transaction as completion:

- Project optimistic version;
- Project source status is ACTIVE;
- pinned contract exists and targets PROJECT / this Project id;
- Verification is PASS;
- Verification points at the pinned contract revision;
- Evidence is for this Project;
- Evidence revision still equals the live Milestone snapshot.

Stale historical Project Evidence cannot complete current Project state.

## Atomic acceptance

A successful contract-bound acceptance atomically records:

- Project status → COMPLETED;
- Project version increment;
- Acceptance revision status → PASSED;
- `project.completed` event.

Human Approval is not part of this correctness decision.

## Persistence

Project Acceptance uses the existing durable Project record, Acceptance revision,
Evidence, Verification and Event persistence paths.

SQLite restart verification proves the Project's contract pin, COMPLETED state,
PASSED contract and completion event remain durable.

## CI verification

Latest full CI:

```text
Node 22.23.2
tests   518
pass    518
fail    0
skipped 0
```

Package-floor CI:

```text
Node 20.20.2
tests   518
pass    349
fail    0
skipped 169
```

## Exit-criteria assessment

ADR-0006 criteria are satisfied:

1. Project pins only its own PROJECT contract — covered.
2. half-pins are refused — covered.
3. contract-free aggregate completion remains — covered.
4. contract-bound completion cannot bypass Verification — covered.
5. same Milestone snapshot reuses Evidence identity — covered.
6. changed snapshot supersedes old Evidence — covered.
7. stale Project Evidence cannot complete current Project — covered.
8. PASS Verification atomically completes Project + contract — covered.
9. PAUSED/ARCHIVED/COMPLETED do not re-enter acceptance — covered.
10. restart preserves Project pin + accepted state — covered.
11. Node 22 full CI passes with zero skips — 518/518.

## Boundary after G7.1

Project Acceptance closes the contract-bound hierarchy:

```text
Task
  ↓
Goal
  ↓
Milestone
  ↓
Project
```

The next G7 candidate is Decision. That work remains a separate D-class gate.
