# G7 Long-horizon Project Control — Decomposition

**Status:** ACTIVE — G7.1–G7.4 COMPLETE; G7.5 D / queued
**Roadmap phase:** G7  
**Purpose:** prevent "long-horizon objects" from becoming one architecture-completion bundle.

G7 candidates must be classified and advanced independently.

## Classification

| Candidate | Class | Why | Dependency / next action |
|---|---|---|---|
| Project-level Acceptance | D → B → COMPLETE (G7.1) | Optional pinned PROJECT contracts and aggregate Evidence/Verification are implemented. | ADR-0006; `PROJECT_ACCEPTANCE_G7_1_EVIDENCE.md`. |
| Decision | D → B → COMPLETE (G7.2) | Durable authority, provenance, immutable meaning and supersede/revoke lifecycle are implemented. | ADR-0007; `DECISION_G7_2_EVIDENCE.md`. |
| Project-control Memory | D → B → COMPLETE (G7.3) | ADR-0008 promotion, closed source admission, validity, confidence, immutable meaning, STALE/no-resurrection, new-id supersession, current/history queries and persistence are implemented and independently reviewed. | `MEMORY_G7_3_EVIDENCE.md`; reviewed HEAD `973f77e2d231ee6eaa4e9b348ebf2424da41f674`, CI `36724720686` success (Node 22: 592 pass, zero failures/skips). |
| Context Capsule | D → B → COMPLETE (G7.4) | ADR-0009's bounded snapshot, source/budget/freshness, receipt/UNKNOWN, transactional persistence and restart semantics are implemented; all 25 exit criteria passed independent review #3. | `CONTEXT_CAPSULE_G7_4_EVIDENCE.md`; reviewed HEAD `1f9f208d8eef9fabcba02ac93772ff5713612f24`, final CI `36815496417` success; targeted 77/77, full local regression 669/669. Human authorized governance closure on 2026-10-01. |
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

G7.1–G7.4 are complete. G7.4's architecture is ACCEPTED under ADR-0009, its
implementation passed independent review #3 after two failed reviews and repairs,
and Human authorized this governance closeout. Failed reviews and repair proof
remain in Evidence. G7 remains active: G7.5 is D / queued with no research or
implementation authorization; G7.6 is decided only by demonstrated G8 need.
Leases/fencing remain NOT CURRENTLY REQUIRED. Capsule completion advances none of
these remaining candidates.

This order is dependency-driven, not a claim that every item must ship before dogfood.

## Why Project Acceptance was first — historical G7 entry rationale

The following records the pre-G7.1 gap, now closed by ADR-0006 and its implementation Evidence. It is not the current hierarchy limitation.

At G7 entry the hierarchy had:

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
