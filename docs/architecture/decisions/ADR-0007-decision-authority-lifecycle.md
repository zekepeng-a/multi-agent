# ADR-0007 — Project Decision authority and lifecycle

**Status:** ACCEPTED  
**Date:** 2026-09-30  
**Roadmap phase:** G7.2 — Decision  
**Related invariants:** I-12, I-14, I-20, I-21, I-25, I-35

## Context

The canonical model names Decision as a Project Control object, but until now the
repository had no durable Decision identity or lifecycle.

A Decision must not collapse several neighboring concepts:

```text
runtime/model proposal ≠ Decision
Approval               ≠ Decision
PolicyDecision          ≠ Project Decision
Memory                  ≠ Decision
Event                   ≠ Decision
```

The unresolved boundary is who may make project-direction/constraint facts
authoritative, how those facts evolve, and how later context may cite them
without rewriting history.

## External evidence

The focused G7.2 pass is recorded in
`docs/architecture/SOURCE_TRACEABILITY.md` §25.

### Agent Harness

Implementation/docs show:

- human owns product direction/judgment/approval/acceptance;
- ambiguous product/risk choices pause for user direction rather than being
  guessed;
- worker results remain candidate evidence while the controller owns accepted
  durable state;
- control packets preserve route reasoning and handoff state separately from
  user-facing closeout;
- specs/artifacts record durable decisions and boundaries separately from the
  current bounded status view.

Transferable lesson:

> a model/runtime may propose or explain a choice, but it cannot promote its own
> output into authoritative project direction.

### ADR Tools

`npryce/adr-tools` records a replacement decision by creating a new ADR and
marking the old ADR superseded by that new record.

Transferable lesson:

> materially changed meaning gets a new identity; supersession preserves the old
> rationale/history instead of rewriting it.

## Decision

### 1. Decision is a durable Project Control fact

A Decision records one chosen project direction or constraint and the authority
that chose it.

Target schema:

```yaml
id: DecisionId
version: integer
project_id: ProjectId
title: string
rationale: string
alternatives:
  - description: string
    rejected_reason: string?
decided_by:
  type: HUMAN | CONTROL_PLANE
  actor_id: string
status: ACTIVE | SUPERSEDED | REVOKED
source_refs:
  - type: HUMAN_INSTRUCTION | PROJECT_STATE | EVIDENCE |
          VERIFICATION | POLICY_DECISION | DECISION | EXTERNAL_REFERENCE
    id: string
    revision: string?
supersedes_decision_id: DecisionId?
superseded_by_decision_id: DecisionId?
revocation:
  revoked_by:
    type: HUMAN | CONTROL_PLANE
    actor_id: string
  revoked_at: timestamp
  reason: string
created_at: timestamp
updated_at: timestamp
```

### 2. Meaning fields are immutable

After creation these fields do not change in place:

- project_id;
- title;
- rationale;
- alternatives;
- decided_by;
- source_refs;
- supersedes_decision_id.

A materially different choice is a **new DecisionId**.

Lifecycle metadata may change only through the explicit supersede/revoke
operations.

### 3. Only HUMAN or CONTROL_PLANE may author an ACTIVE Decision

`decided_by.type` is closed to:

- HUMAN;
- CONTROL_PLANE.

There is no AGENT, MODEL, RUNTIME or WORKER authority type.

A runtime/model proposal may be cited as an external/source artifact, but that
proposal is not an ACTIVE Decision until a legitimate authority records the
Decision.

### 4. Human direction has stronger authority than derived control decisions

Rules:

- a HUMAN Decision may be superseded or revoked only by HUMAN authority;
- a CONTROL_PLANE Decision may be superseded/revoked by HUMAN authority;
- a CONTROL_PLANE Decision may supersede/revoke another CONTROL_PLANE Decision
  when current authoritative source facts justify the replacement.

The Control Plane may not silently overturn explicit human direction.

This is an implementation of the Blueprint's Human Intent Authority, not a new
authority layer.

### 5. Every Decision requires provenance

`source_refs` is non-empty.

For HUMAN decisions, at least one source reference must preserve the human
instruction/decision provenance.

For CONTROL_PLANE decisions, at least one source reference must name an
authoritative control/evidence fact. A model recommendation by itself is not a
sufficient source.

G7.2 validates the reference shape/type and authority class. It does not attempt
to build a universal external-document resolver.

### 6. Supersession creates a new Decision atomically

Supersession is:

```text
old Decision ACTIVE
      +
new Decision (new id)
      ↓
old.status = SUPERSEDED
old.superseded_by = new.id
new.status = ACTIVE
new.supersedes = old.id
```

Both records and their events are written in one store transaction.

The old rationale/source refs remain readable.

A Decision may be superseded once. SUPERSEDED/REVOKED records do not re-enter
ACTIVE.

### 7. Revocation is attributable and terminal

Revocation does not create replacement meaning.

It records:

- who revoked;
- when;
- reason.

```text
ACTIVE → REVOKED
```

There is no revoke → active transition.

### 8. Decision is not Memory

A future Memory record may cite a Decision as a source, but copying a Decision
into Memory does not increase its authority.

When facts conflict:

```text
Current Reality
  > Verified Evidence
  > Accepted Project State
  > Decision / Constraint
  > Promoted Memory
```

remains unchanged.

### 9. Decision is not Approval or PolicyDecision

- Approval authorizes a concrete action.
- PolicyDecision records one policy evaluation of a Command.
- Project Decision records durable project direction/constraint.

None substitutes for another.

### 10. Concurrency and idempotency use existing store patterns

Decision lifecycle records use optimistic concurrency on `version`.

Create/supersede/revoke operations accept the existing store mutation replay
identity so retries do not duplicate durable decisions/events.

## Alternatives considered

### A. Allow editing rationale/title/source_refs in place

Rejected. It destroys the historical meaning of what was decided.

### B. Let agents/models create HUMAN-equivalent Decisions directly

Rejected. It violates Human Intent Authority and turns recommendation into
authority.

### C. Store every recommendation as a Decision

Rejected. Proposal volume would pollute authoritative project state and collapse
candidate reasoning into accepted direction.

### D. Make Decision append-only with no status updates at all

Rejected. Supersession/revocation need a current-state query without erasing
history. The Decision meaning is immutable; lifecycle projection may change.

### E. Reuse ADR files as Project Decision storage

Rejected. ADRs govern this repository's architecture. Project Decision is a
runtime/domain fact and needs backend persistence, concurrency and query
semantics.

## Consequences

Positive:

- project direction becomes durable and attributable;
- runtime proposals cannot silently become authority;
- changed direction has explicit lineage;
- human decisions cannot be silently overturned by Control Plane;
- future Memory/Context Capsule have a stable Decision source.

Costs:

- new domain collection/table;
- explicit source references are required;
- supersession/revocation need lifecycle events and concurrency tests.

## Implementation boundary

After this ADR, G7.2 becomes **B — Missing Implementation**:

- Decision authority/status/source-ref vocabulary;
- Decision factory;
- Decision collection in shared store + MemoryStore + SQLite;
- create Decision;
- supersede Decision atomically with replacement;
- revoke Decision;
- active-decision queries by Project;
- immutable meaning enforcement;
- human-vs-control-plane authority enforcement;
- events + mutation replay;
- backend parity and SQLite restart proof.

Still outside G7.2:

- automatic Memory promotion;
- Context Capsule generation;
- Roadmap domain;
- observability propagation;
- leases/fencing;
- model proposal persistence as its own domain.

## Verification / exit criteria

G7.2 is complete only if tests prove:

1. runtime/model authority type cannot create a Decision;
2. Decision cannot exist without provenance;
3. HUMAN Decision cannot be superseded/revoked by CONTROL_PLANE;
4. HUMAN may supersede HUMAN or CONTROL_PLANE;
5. CONTROL_PLANE may supersede its own derived Decision with valid control provenance;
6. supersession creates a new id and preserves old meaning;
7. supersession atomically links old ↔ new;
8. revocation is attributable, reasoned and terminal;
9. immutable meaning cannot be patched;
10. optimistic concurrency rejects stale lifecycle mutation;
11. replay identity does not duplicate Decisions/events;
12. active-decision query excludes superseded/revoked records;
13. MemoryStore and SQLite share the same semantics;
14. restart preserves Decision lineage/status/provenance;
15. full Node 22 CI passes with zero skips.
