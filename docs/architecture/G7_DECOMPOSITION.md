# G7 Long-horizon Project Control — Decomposition

**Status:** ACTIVE  
**Roadmap phase:** G7  
**Purpose:** prevent "long-horizon objects" from becoming one architecture-completion bundle.

G7 candidates must be classified and advanced independently.

## Classification

| Candidate | Class | Why | Dependency / next action |
|---|---|---|---|
| Project-level Acceptance | D → first | `PROJECT` is a declared Acceptance target, but Project has no pinned contract fields or acceptance lifecycle. Parent acceptance precedent exists, but Project semantics are not frozen. | Focused acceptance-lineage review + ADR-0006 before code. |
| Decision | D | Schema exists, but create/supersede/revoke authority, versioning and relationship to human direction are not fully settled. | ADR after Project Acceptance. |
| Project-control Memory | D | Schema/truth hierarchy/provenance exist, but promotion, invalidation, supersession and retrieval authority are not settled. | Depends on Decision semantics. |
| Context Capsule | D | Shape exists, but generation/freshness/expiry and exact authority of references are not frozen. | Depends on Decision + Memory + current Policy/Workspace/Runtime boundaries. |
| Roadmap domain | D | Basic object schema exists, but human authority, activation, Milestone membership, competing roadmaps and lifecycle reconciliation are underspecified. | Focused ADR; do not confuse this domain object with repository `ROADMAP.md`. |
| Observability identity | D / hardening | Trace/Span/Correlation/Causation IDs are named, but propagation and persistence semantics are not defined. | Resolve only when needed for G8 auditability. |
| Leases / fencing | NOT CURRENTLY REQUIRED | Blueprint says "where necessary"; G6 explicitly found no multi-coordinator requirement. | Do not implement until a concrete concurrent-ownership problem appears. |

## Order

The current G7 sequence is:

```text
G7.1 Project-level Acceptance
   ↓
G7.2 Decision
   ↓
G7.3 Project-control Memory
   ↓
G7.4 Context Capsule
   ↓
G7.5 Roadmap domain
   ↓
G7.6 Observability hardening (only to G8 need)
```

This order is dependency-driven, not a claim that every item must ship before dogfood.

## Why Project Acceptance is first

The current hierarchy already has:

```text
Task Acceptance
  ↓
Goal Acceptance
  ↓
Milestone Acceptance
  ↓
Project completion by aggregation only
```

`PROJECT` already exists in `AcceptanceTargetType`, but the Project object cannot
pin an Acceptance revision and the Controller cannot run a Project acceptance
flow.

That is a real semantic gap at the top of an already-implemented hierarchy.

It is more concrete than adding Memory/Roadmap/observability for completeness.

## Non-goals

G7 does not authorize:

- rewriting existing accepted-state history;
- making Memory stronger than current reality;
- letting a model/agent create authoritative Decision facts without control-plane rules;
- treating repository `ROADMAP.md` as the future Roadmap domain object;
- adding distributed locking merely because leases/fencing appear in the architecture vocabulary;
- implementing every candidate in one patch.
