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

## Acceptance contract revision pinning

A contract has identity `(id, version)`. A Task records the revision it was
created against and stays bound to it — the Controller and the store always
resolve the *pinned* revision, never the contract's newest one:

```
Task.acceptanceId + Task.acceptanceVersion   → the pinned contract revision
Evidence.acceptanceVersion                   === Task.acceptanceVersion
Verification.acceptanceVersion               === Task.acceptanceVersion
```

Contract content (`id`, `targetId`, `version`, `criteria`) changes only through
`reviseAcceptance()`, which always creates a **new** revision; content change and
identity change are the same event. The store re-checks that a revision's content
still matches the identity it was stored under, so a revision edited in place
fails closed instead of being trusted.

A decision is not a revision: `status` moving from `PENDING` to `PASSED` leaves
the version untouched. v0.1 still keeps contract content and the acceptance
decision in one object, separated by field. `PERSISTENCE_BOUNDARY.md` §7 names
`AcceptanceContract` and the acceptance decision as separate durable categories,
so splitting them is the eventual shape — not this prototype's.

A Goal and a Milestone pin a revision the same way, and the store proves that the
revision is about *that* parent:

```
Goal.acceptanceId + Goal.acceptanceVersion            → the pinned contract revision
Milestone.acceptanceId + Milestone.acceptanceVersion  → the pinned contract revision
acceptance.targetType === the parent's own type
acceptance.targetId   === the parent's own id
```

A half-pin is refused: a bare `acceptanceId` is not a revision, and a bare
`acceptanceVersion` names nothing. This is checked at seed and at every update,
so a parent can never be stored pointing at a contract that cannot be resolved.

## Parent acceptance (Goal / Milestone)

A parent with an Acceptance Contract is **not** accepted by aggregation. Child
completion is the input; the decision has to be verified against the pinned
revision, exactly as it is for a Task:

```
contract revision → Aggregate Evidence → Verification → Acceptance
```

1. **Aggregate Evidence.** No runtime produces a Goal, so the Control Plane
   records its own observation of the children: `target_type`/`target_id`, no
   task/run/attempt, `sourceRefs` = one ref per child (found through the child's
   own parent link), and `revision = sha256(canonical child snapshot)`.
2. **Reuse, not duplication.** The revision is the observation's identity, so a
   repeated reconcile returns the *same* Evidence and writes no second
   `evidence.recorded`. When the child state moves, a new record is created and
   the record it replaces is marked `SUPERSEDED` — never deleted. Idempotency here
   comes from that identity, **not** from a command id: a command id is durable and
   its replay returns the evidence it recorded, so reusing one across observations
   would freeze the parent to its first observation.
3. **One observation, one verdict.** A verdict recorded for an observation and a
   contract revision is reused instead of re-asked, which is what makes
   `reconcile*` idempotent. New observation, new evidence id, new verification.
4. **Re-proved at the write.** The acceptance re-derives the snapshot inside the
   same transaction as the status change, so a verification that was legal when
   recorded cannot accept a parent whose reality has since moved.

Outcomes, and the reasons the Controller reports:

| Result | Action | Reason |
|---|---|---|
| PASS, contract pinned | `ACCEPT` | `goal-accepted` / `milestone-completed` |
| FAIL or INCONCLUSIVE | `WAIT` | `goal-acceptance-not-passed` / `milestone-acceptance-not-passed` |
| pin unresolvable, contract not about this parent, or children not finished | `WAIT` | `goal-acceptance-unprovable` / `milestone-acceptance-unprovable` |
| no contract | `SYNC` | the parent status is synchronised from children |

No status is invented for a failed parent acceptance, no Runtime call is made, and
`PROJECT` has no acceptance flow in v0.1.

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
10. A Task cannot drift onto a newer acceptance contract revision: it executes and
    accepts only against the revision it pinned.
11. A Goal or a Milestone with its own contract is accepted only through that
    contract: aggregate evidence is observed from the live children, verified, and
    re-proved at the acceptance write — child completion alone never completes a
    contract-bound parent.

## What v0.1 does NOT prove

- durable persistence across process restart
- reconciliation against a real external system (v0.1 defines the observation
  protocol and enforces observation-before-action, but only the fake runtime
  implements `reconcile`)
- persisted reconciliation observations (the observation lives in the call, not
  yet in the event log)
- canonical contract-content comparison across a persistence boundary (the
  revision guard compares serialized content, which is key-order sensitive today)
- distributed concurrency
- DSH integration
- real agent execution
- human approval
- Policy Engine
- Project acceptance against its own contract: `PROJECT` is a declared target type
  with no v0.1 acceptance flow
- re-pinning a parent contract revision mid-flight (a revision can be created, but
  nothing rewrites an existing pin)
- production-grade transaction atomicity

Those remain later implementation questions.
