# G3 External Effect + Reconciliation — Implementation Evidence

**Roadmap phase:** G3  
**Architecture decision:** `ADR-0002-effect-reconciliation-boundary.md`  
**Verified head:** `aa8bc196d125beb1d839a28936645ed5185ae523`  
**CI run:** GitHub Actions `36678945907`

## Implemented boundary

G3 adds a durable Effect ledger beside Command state.

Implemented lifecycle:

```text
REQUESTED
   ↓
DISPATCHED
   ↓
SUCCEEDED | FAILED_NO_EFFECT | UNKNOWN
```

Recovery/reconciliation:

```text
DISPATCHED / UNKNOWN
        ↓
reconciliation IN_PROGRESS
        ↓
CONFIRMED_SUCCEEDED → SUCCEEDED
CONFIRMED_NO_EFFECT → FAILED_NO_EFFECT
UNKNOWN             → UNKNOWN
```

`UNKNOWN` cannot be blindly re-requested.

`FAILED_NO_EFFECT` may be explicitly re-requested; the prior dispatch count/history is preserved.

## Persist-before-dispatch proof

Controller ordering is:

1. create `REQUESTED` Effect from an `AUTHORIZED` Command;
2. persist `DISPATCHED`;
3. call the external-effect driver;
4. persist the observed outcome.

The deterministic FakeEffectDriver records the Effect it receives, and tests prove
the driver sees `DISPATCHED` with `dispatchCount = 1`.

A throwing driver is recorded as `UNKNOWN`, never as no-effect failure.

## Command / Effect separation

Effect creation reads the durable Command and copies:

- `commandId`
- `action`
- `capability`
- project identity when available
- default idempotency key when one is not supplied specifically for the Effect

A caller cannot substitute a different action/capability at Effect creation.

Command remains `AUTHORIZED`; G3 does not infer Command completion from one Effect.

## Effect / Evidence separation

Effect receipt/reconciliation state does not:

- create Evidence;
- run Verification;
- accept a Task;
- change Goal/Milestone acceptance.

Tests explicitly assert zero Evidence records and unchanged Task state after Effect success/reconciliation.

## Durable persistence

Implemented across shared store semantics, MemoryStore and SQLite:

- Effect identity and independent version;
- command relationship;
- action/capability/destination/idempotency key;
- dispatch count;
- external receipt;
- reconciliation status/observation/reference;
- append-oriented Effect events.

SQLite stores Effects in an `effects` table, separate from durable Commands and from the mutation-replay registry.

## Crash-window restart proof

The integration suite starts one child process that:

- creates and authorizes a durable Command;
- creates an Effect;
- persists it as `DISPATCHED`;
- exits without recording any external outcome.

A second process reopens the same SQLite database and:

- observes the orphaned `DISPATCHED` Effect;
- calls reconciliation only;
- resolves it to `SUCCEEDED` from a typed observation/reference;
- performs zero dispatch calls;
- leaves Task Acceptance and Evidence untouched.

This directly proves the G3 crash boundary across a real process restart.

## Replay safety

A whole Controller dispatch operation with one mutation identity can be replayed
without invoking the driver a second time. Store mutation replay remains distinct
from Effect identity and Effect idempotency key.

## Direct observation vs reconciliation

A terminal outcome observed directly during dispatch records reconciliation status
`NOT_REQUIRED`.

A terminal outcome reached through an uncertainty/recovery path records
reconciliation status `RESOLVED`.

This keeps “we knew the result immediately” distinct from “we resolved an
ambiguous prior dispatch”.

## Verification

Latest full CI:

```text
Node 22.23.2
tests   467
pass    467
fail    0
skipped 0
```

Package-floor CI:

```text
Node 20.20.2
tests   467
pass    314
fail    0
skipped 153
```

## ADR-0002 exit assessment

The current implementation/tests prove:

1. non-AUTHORIZED Commands cannot create Effects;
2. Effect action/capability derive from stored Command intent;
3. REQUESTED is persisted before DISPATCHED;
4. DISPATCHED is persisted before driver invocation;
5. confirmed success becomes SUCCEEDED with receipt/reference;
6. confirmed no-effect becomes FAILED_NO_EFFECT;
7. ambiguous/throwing dispatch becomes UNKNOWN;
8. UNKNOWN cannot be redispatched;
9. restart from orphaned DISPATCHED requires reconciliation;
10. typed reconciliation resolves success/no-effect distinctly;
11. unresolved observation remains UNKNOWN;
12. resolving reconciliation records observation reference;
13. MemoryStore and SQLite share Effect semantics;
14. Effect transitions do not modify Task/Goal Acceptance;
15. receipts are not automatically promoted to Evidence;
16. full Node 22 CI passes with zero skips.

## Boundary for G4

G3 deliberately does not decide **when** an action may proceed without approval,
must be denied, or requires human approval.

That belongs to Policy:

```text
action/capability/target/risk/context
        ↓
ALLOW | DENY | REQUIRE_APPROVAL
```

Approval remains the durable human permission fact; Effect remains external-world history.
