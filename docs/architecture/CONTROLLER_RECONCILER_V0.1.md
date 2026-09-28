# Project Control OS — Minimum Controller / Reconciler v0.1

**Status:** IMPLEMENTATION PROTOTYPE  
**Scope:** first executable control loop; deliberately in-memory and runtime-independent.

## Goal

Prove that Project Control can own project state without becoming another agent runtime.

The prototype answers one question:

> Given current Task state, Acceptance Contract, Run state, and available evidence, what controlled action should happen next?

## Boundary

The prototype contains four pieces:

- **MemoryStore** — authoritative current-state + append-oriented event log for the prototype.
- **Controller** — observes Task/Run state and chooses a legal next action.
- **FakeRuntime** — deterministic runtime substitute used only for tests.
- **Domain model** — identities, states, invariants, optimistic concurrency.

No DSH, Claude Code, Codex, Workflow, Team, database, UI, or model routing is required.

## First legal flow

`READY Task`
→ Controller creates `Run`
→ Controller creates `Attempt`
→ Runtime executes
→ Runtime result becomes `Evidence`
→ Verification evaluates Evidence
→ Control Plane records `Acceptance`
→ Task becomes `ACCEPTED`

The important property is that the runtime result itself cannot mutate Task state.

## Recovery flow

A lost Attempt:

`Attempt = LOST`
→ Run remains durable
→ Run becomes `BLOCKED`
→ Controller returns `RECONCILE`

This prototype intentionally stops there. It does not yet invent a retry policy.

## Concurrency flow

Every mutable aggregate carries a version.

A mutation provides `expectedVersion`. A mismatch produces `CONFLICT` rather than silently overwriting newer state.

## Evidence boundary

Evidence records:

- Task / Acceptance identity
- Acceptance contract version
- Run / Attempt lineage
- artifact/result reference
- source revision

Verification must target the same Acceptance contract version and evidence lineage.

Candidate Evidence cannot directly transition Task to ACCEPTED.

## What v0.1 proves

1. Task and Run are separate.
2. Run and Attempt are separate.
3. Evidence and Verification are separate.
4. Acceptance is a Control Plane decision.
5. Lost Attempt does not erase Run.
6. Stale writers are rejected.
7. The runtime is replaceable.
8. Events are retained as history.

## What v0.1 does NOT prove

- durable persistence across process restart
- real external side-effect reconciliation
- distributed concurrency
- DSH integration
- real agent execution
- human approval
- Policy Engine
- full Goal/Milestone/Project lifecycle
- production-grade transaction atomicity

Those remain later implementation questions.
