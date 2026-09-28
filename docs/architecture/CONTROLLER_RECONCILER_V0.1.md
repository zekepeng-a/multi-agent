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

`RECONCILE` is a request for observation, not a retry. On the next call the
Controller reconciles the blocked Run with the runtime *before* any state moves:

`Run = BLOCKED` + `current Attempt = LOST`
→ `runtime.reconcile(...)` — observation only, no side effects
→ `confirmed_no_effect` ⇒ external work provably did not happen, so recovery may
  execute: a **new** Run is opened and executed, while the blocked Run and its
  LOST Attempt stay untouched as history
→ `confirmed_completed` ⇒ external work already happened, so its result becomes
  candidate `Evidence` for the Run/Attempt that really produced it and enters the
  same Evidence → Verification → Acceptance path; **nothing is re-executed**
→ `unknown` ⇒ the Run stays `BLOCKED` and the Controller returns `RECONCILE`
  again on every later call; no external work is repeated on a guess

Recovery is therefore repeatable: no transition is legal unless a reconciliation
observation confirms it within that same call, and `unknown` leaves state
untouched, so repeated calls are safe.

The blocked Run is never rewritten — its `BLOCKED` status records that control was
lost, while the recovered Evidence records what actually happened. Persisting the
observation itself, and resolving the Run's own outcome after recovery, are later
concerns.

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
9. A blocked Run is resumable: a reconciliation observation is a precondition of
   recovery, and `unknown` never repeats external work.

## What v0.1 does NOT prove

- durable persistence across process restart
- reconciliation against a real external system (v0.1 defines the observation
  protocol and enforces observation-before-action, but only the fake runtime
  implements `reconcile`)
- persisted reconciliation observations (the observation lives in the call, not
  yet in the event log)
- distributed concurrency
- DSH integration
- real agent execution
- human approval
- Policy Engine
- full Goal/Milestone/Project lifecycle
- production-grade transaction atomicity

Those remain later implementation questions.
