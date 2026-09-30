# ADR-0002 — External Effect uncertainty and reconciliation boundary

**Status:** ACCEPTED  
**Date:** 2026-09-30  
**Roadmap phase:** G3 — External Effect + reconciliation  
**Related invariants:** I-13, I-18, I-19, I-26, I-35, I-42

## Context

G2 now ends at a durable `AUTHORIZED` Command.

The next unsafe boundary is the moment an external mutation may occur:

- deployment;
- GitHub mutation;
- message send;
- external database write;
- external API mutation;
- delete/create operations outside Project Control storage.

A local timeout or process crash after dispatch does not prove that the external
operation failed. Retrying on that assumption can duplicate a real side effect.

The architecture therefore needs a durable record that answers a different
question from Command:

```text
Command: what action was requested and authorized?
Effect:  what may have happened in the external world?
```

## External evidence

The repository's source-traceability work already contains implementation-backed
evidence sufficient for this focused decision.

### AgentLedger

Source-traced implementation:

- managed side-effect calls are recorded before execution;
- idempotency/request identity is computed before the external call;
- a successful prior ledger entry is replayed instead of invoking again;
- an uncertain exception becomes `PENDING_VERIFICATION`, not "failed";
- explicit resolution distinguishes success from `FAILED_NO_EFFECT`;
- uncertain state blocks blind re-execution.

Transferable lesson:

> persist the side-effect fact before crossing the external-call boundary, and
> represent uncertainty explicitly.

### Temporal

Source-traced official architecture/documentation:

- a worker can perform an external Activity and crash before reporting completion;
- durable runtime history therefore does not imply exactly-once external effects;
- idempotency keys/provider idempotency reduce duplicate effects but do not prove
  what happened.

Transferable lesson:

> exactly-once external side effects must not be inferred from durable execution.

### Agent Harness / reconciliation research

Existing source traceability established that an unknown external command outcome
requires reconciliation before unsafe retry.

Transferable lesson:

> observation/reconciliation is a control step, not a synonym for retry.

No broad new archaeology is required for G3.

## Decision

### 1. Effect is a durable control-history object

An Effect represents one logical external mutation associated with an authorized
Command.

It is not Evidence and it is not Command state.

Target schema:

```yaml
id: EffectId
version: integer
project_id: ProjectId?
command_id: CommandId
action: string
capability: string
destination: string
idempotency_key: string
status:
  - REQUESTED
  - DISPATCHED
  - SUCCEEDED
  - FAILED_NO_EFFECT
  - UNKNOWN
dispatch_count: integer
external_receipt:
  provider: string?
  receipt_id: string?
  result_ref: string?
reconciliation:
  status: NOT_REQUIRED | REQUIRED | IN_PROGRESS | RESOLVED
  last_observation: CONFIRMED_SUCCEEDED | CONFIRMED_NO_EFFECT | UNKNOWN | null
  observation_ref: string?
  reconciled_at: timestamp?
created_at: timestamp
updated_at: timestamp
```

### 2. Effect is created from stored Command intent

G3 may create an Effect only from a durable `AUTHORIZED` Command.

The Effect's `action` and `capability` are copied from the stored Command.
A caller may provide destination/provider-specific parameters, but may not
substitute the authorized action/capability.

One Command may eventually be associated with more than one Effect; therefore an
Effect does not become Command identity.

### 3. Persist before crossing the external-call boundary

The safe ordering is:

```text
AUTHORIZED Command
  ↓
Effect REQUESTED persisted
  ↓
Effect DISPATCHED persisted
  ↓
cross external-call boundary
  ↓
observe result
```

`DISPATCHED` means:

> Project Control has crossed (or is committed to crossing) the external-call
> boundary and may no longer assume that no effect happened.

It does **not** mean success.

If the process crashes after `DISPATCHED` and before a terminal observation is
recorded, the Effect must be treated as requiring reconciliation on recovery.

### 4. Terminal meanings are explicit

`SUCCEEDED` means external success is positively observed.

`FAILED_NO_EFFECT` means non-occurrence is positively established. It is the
only failure state that can make a later re-dispatch safe from the perspective of
"did the previous attempt already happen?".

There is deliberately no ambiguous `FAILED` terminal in G3.

`UNKNOWN` means the system cannot establish whether the external mutation
happened.

### 5. UNKNOWN blocks blind retry

For `UNKNOWN` (and recovered orphaned `DISPATCHED`), the only legal next
control action is reconciliation.

Typed reconciliation outcomes:

```text
CONFIRMED_SUCCEEDED
CONFIRMED_NO_EFFECT
UNKNOWN
```

Mapping:

```text
CONFIRMED_SUCCEEDED → SUCCEEDED
CONFIRMED_NO_EFFECT → FAILED_NO_EFFECT
UNKNOWN             → UNKNOWN
```

An UNKNOWN observation is stable: it does not create permission to retry.

### 6. Reconciliation requires an observation reference

A reconciliation that resolves uncertainty must identify the observation used to
resolve it.

Examples:

- provider receipt/query result;
- GitHub object id;
- deployment status query;
- durable external lookup;
- manual operator observation.

The reference is not automatically Acceptance Evidence. Effect and Evidence stay
separate (I-18).

### 7. Idempotency keys reduce risk; they are not proof

Every managed G3 Effect carries an idempotency key.

The Effect driver should present it to providers that support idempotency.

But:

```text
idempotency key present
≠
effect definitely happened once
```

Current Reality / reconciliation still decides uncertain outcomes.

### 8. Effect dispatch uses an abstract driver seam

G3 introduces a narrow external-effect seam conceptually equivalent to:

```text
dispatch(effect)   → observed outcome
reconcile(effect)  → reconciliation observation
```

G3 tests may use a FakeEffectDriver.

This is not yet the full Runtime Adapter from G5 and does not encode DSH/Claude/
Codex session semantics.

### 9. Command lifecycle remains bounded in G3

G3 does **not** need to mark the Command `SUCCEEDED` merely because one Effect
succeeded.

A Command can potentially produce multiple effects, and command execution
aggregation belongs to the later runtime/execution boundary.

Therefore G3 keeps the G2 Command authorization fact intact and adds Effect
history beside it.

`DISPATCHED / EXECUTING / SUCCEEDED / FAILED / UNKNOWN` Command statuses remain
reserved until their ownership can be defined without conflating Command with
Effect.

### 10. Retry creates a new dispatch attempt on the same logical Effect only after safety is established

G3 Effect keeps `dispatch_count` and append-oriented events.

A second dispatch is legal only when:

- the previous dispatch was positively resolved as `FAILED_NO_EFFECT`; or
- provider semantics make re-dispatch independently safe under the same
  idempotency key and the control rules explicitly recognize that capability.

The first G3 implementation supports the conservative case only:
`FAILED_NO_EFFECT` may be explicitly re-requested; `UNKNOWN` may not.

## Alternatives considered

### A. Treat runtime exception as Effect FAILED

Rejected. A local exception does not prove non-occurrence.

### B. Use Command UNKNOWN instead of a separate Effect object

Rejected. It collapses requested action state with external-world uncertainty and
breaks I-18's neighboring distinction.

### C. Create Effect only after the external API returns

Rejected. A crash after the API mutation but before persistence would leave no
durable fact that reconciliation is required.

### D. Assume provider idempotency key gives exactly-once

Rejected. It reduces duplication risk but is not universal proof of outcome.

### E. Add leases/fencing now

Deferred. G3 does not yet have multi-worker ownership evidence requiring a lease
model. If implementation exposes concurrent dispatch ownership, that becomes a
new D-class gap.

## Consequences

Positive:

- external uncertainty becomes durable and explicit;
- crash windows no longer authorize blind retry;
- successful external mutation, confirmed non-occurrence and unknown outcome are
  distinct facts;
- idempotency is recorded without being overstated;
- Effect remains separate from Evidence/Acceptance;
- G5 can later attach a real runtime to a stable effect-safety boundary.

Costs:

- requires a new durable Effect collection/table;
- requires explicit recovery/reconciliation tests;
- callers must supply/derive idempotency keys and observation references;
- some operations may remain blocked in UNKNOWN until external reality can be
  observed.

## Implementation boundary

After this ADR, the following becomes **B — Missing Implementation** in G3:

- Effect domain/status/reconciliation vocabulary;
- Effect collection in shared store + MemoryStore + SQLite;
- create Effect only from AUTHORIZED Command;
- persist REQUESTED and DISPATCHED before driver invocation;
- abstract/fake Effect driver;
- outcome mapping to SUCCEEDED / FAILED_NO_EFFECT / UNKNOWN;
- restart handling for DISPATCHED/UNKNOWN;
- reconciliation API and typed outcomes;
- observation reference on resolved reconciliation;
- conservative re-dispatch only after FAILED_NO_EFFECT;
- backend parity + restart tests.

Still outside G3:

- real DSH/Claude/Codex Runtime Adapter;
- Command completion aggregation;
- Policy Engine;
- COMMAND-target Approval;
- leases/fencing unless a concrete concurrency need appears;
- treating Effect receipts as Acceptance Evidence automatically.

## Verification / exit criteria

G3 is complete only if tests prove:

1. no Effect can be created from a non-AUTHORIZED Command;
2. Effect action/capability come from stored Command intent;
3. REQUESTED exists durably before DISPATCHED;
4. DISPATCHED is durable before external driver invocation;
5. success becomes SUCCEEDED with receipt/reference;
6. confirmed no-effect becomes FAILED_NO_EFFECT;
7. ambiguous/throwing dispatch becomes UNKNOWN;
8. UNKNOWN cannot be redispatched;
9. restart from DISPATCHED/UNKNOWN requires reconciliation;
10. CONFIRMED_SUCCEEDED and CONFIRMED_NO_EFFECT resolve to distinct terminal states;
11. unresolved reconciliation remains UNKNOWN;
12. resolution records an observation reference;
13. MemoryStore and SQLite pass the same Effect contract;
14. no Effect transition changes Task/Goal Acceptance;
15. no Effect receipt is automatically promoted to Evidence;
16. latest Node 22 full CI passes with zero skips.
