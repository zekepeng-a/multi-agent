# ADR-0001 — Durable Command identity and authorization boundary

**Status:** ACCEPTED  
**Date:** 2026-09-30  
**Roadmap phase:** G2 — Durable Command boundary  
**Related invariants:** I-08, I-13, I-15, I-19, I-26, I-34, I-40..I-45

## Context

Current Project Control reality contains two command-shaped mechanisms but no durable Command domain:

1. `ProjectControlStore` persists small `command_id → operation/result` replay rows used to make authoritative store mutations idempotent.
2. `Controller.authorizeCommand()` performs a read-only Approval + target-version gate over a caller-presented intent.

Neither mechanism gives a requested action durable identity, immutable intent, versioned state, or a durable authorization result.

The canonical architecture already distinguishes:

```text
Command ≠ Event
Command ≠ Effect
Approval ≠ Command
Approval ≠ execution success
```

The immediate G2 question is therefore not "how do we execute external effects?" It is:

> What durable control fact represents one concrete requested action before any external execution is attempted?

G3 separately owns external Effect / UNKNOWN / reconciliation semantics.

## External evidence

### AgentLedger

Source traceability already records implementation-backed behavior from:

- `yaogdu/AgentLedger/src/agentledger/tools.py`
- `src/agentledger/store.py`
- `src/agentledger/runtime.py`

Relevant precedent:

- managed side effects receive durable identity/idempotency treatment before execution;
- a persistent ledger entry exists before the external tool is invoked;
- uncertain results become an explicit verification-required state instead of blind retry;
- mutable state and append-oriented history are separate;
- expected state version/ownership is checked when committing control state.

What we borrow: **persist intent/identity before execution and fail closed around uncertainty**.

What we do not borrow: AgentLedger's complete runtime model, leases, or Tool Ledger as our Project/Task authority.

### Temporal

Source traceability records official Temporal architecture/documentation showing:

- durable execution history does not make external side effects exactly-once;
- an external Activity may have happened before a worker loses the completion acknowledgement;
- application-level idempotency is still required.

What we borrow: **a durable logical command/execution record must not claim exactly-once external effect semantics**.

### Agent Harness / controller research

Existing source traceability also established:

- accepted-state authority is separate from scheduling/execution;
- reconciliation-required is a distinct uncertainty condition;
- current observed state, not the triggering event alone, governs safe reconciliation.

What we borrow: **Command state is owned by the control plane; runtime observations cannot directly manufacture authoritative project state**.

## Decision

### 1. Command becomes a durable Project Control object

A Command is the immutable intent + versioned control state for one concrete requested action.

It is created by the **Control Plane/Controller**, not by a runtime/agent.

A human or planner may originate a request that motivates a Command, but the durable Command record is a control-plane fact.

### 2. G2 supports authorization, not external execution

G2 intentionally implements only the subset that can be correct without an Effect ledger:

```text
CREATED
   ├──→ AUTHORIZED
   └──→ REJECTED
```

The canonical future states:

```text
DISPATCHED
EXECUTING
SUCCEEDED
FAILED
UNKNOWN
```

remain **reserved and non-writable in G2**.

They are not deleted from the target architecture; they are blocked until G3 settles Effect/dispatch/reconciliation semantics.

This is deliberate partial support, not a fake full lifecycle.

### 3. Command intent is immutable

A durable Command must bind at creation:

```yaml
id: CommandId
version: integer
project_id: ProjectId?
target_type: PROJECT | MILESTONE | GOAL | TASK
target_id: string
target_version: integer
action: string
capability: string
scope: string
risk_level: LOW | MODERATE | HIGH | CRITICAL
requested_by: string
expected_version: integer?
parameters: object
idempotency_key: string
status: CREATED | AUTHORIZED | REJECTED
authorization:
  approval_id: ApprovalId?
  authorized_at: timestamp?
  rejected_at: timestamp?
  reason: string?
  approval_reason: string?
created_at: timestamp
updated_at: timestamp
```

All intent fields are immutable after creation. A materially different action is a **new Command**, not an update.

`target_version` is read from current authoritative target state when the Command is created. It is not trusted from the caller.

### 4. Authorization operates on the stored Command

The future controller API should converge from:

```text
authorizeCommand({ caller-presented intent... })
```

to:

```text
authorizeCommand(commandId, expectedCommandVersion, { approvalId? })
```

The gate re-reads the durable Command and current target.

It must not authorize a different action/capability/scope by caller substitution.

Authorization checks:

1. Command exists and is `CREATED`.
2. Command optimistic version matches.
3. target exists.
4. target current version still equals the Command's bound `target_version`.
5. `expected_version`, when present, still matches target current version.
6. current Approval, when required by the current v0.1 gate, matches the Command's target/action/capability/scope and target version.
7. only then transition Command to `AUTHORIZED`.

A stale target makes the concrete Command unusable. Do not silently retarget it to the newer state.

### 5. WAIT is not a durable terminal Command status

Missing/pending Approval does not make the Command false or failed.

When authorization cannot yet proceed because permission is absent/pending:

- Command remains `CREATED`;
- controller returns a WAIT result/reason;
- no authoritative Command version change is required merely to say "not yet".

A definite refusal such as rejected/revoked/expired/stale Approval, invalid target, or failed immutable authorization condition may transition the concrete Command to `REJECTED` when the implementation defines the exact reason table.

### 6. AUTHORIZED is a permission/control fact, not an Effect fact

Recording:

```text
Command.status = AUTHORIZED
```

means:

> this exact stored Command passed the control gate against the observed authoritative state.

It does **not** mean:

- runtime accepted it;
- it was dispatched;
- an external API call occurred;
- an Effect happened;
- execution succeeded;
- Task/Goal Acceptance passed.

Therefore recording AUTHORIZED does not violate I-18 or I-42.

### 7. Existing `commands` replay rows are not the Command domain

The current SQLite/memory backend "command" replay registry is an idempotency mechanism for store operations:

```text
command_id → { operation, result_id }
```

ADR-0001 explicitly does **not** reinterpret those rows as durable Commands.

Implementation must introduce a separate authoritative Command collection/storage shape.

A future cleanup may rename the replay concept to avoid terminology collision, but such a refactor is not required to create the Command domain.

### 8. Command identity and idempotency key are different

- `CommandId` identifies the durable control object.
- `idempotency_key` identifies the logical submission/action for deduplication where applicable.
- existing store mutation `commandId` keys remain operation replay identifiers.

Do not collapse these three meanings simply because all can prevent duplicates.

### 9. No real dispatch in G2

G2 must not call external runtimes from the new durable Command lifecycle.

That would force G3 questions into G2:

- did the runtime receive the command?
- did the external operation happen?
- what if acknowledgement is lost?
- may it be retried?
- what receipt resolves uncertainty?

Until G3 answers those questions, `AUTHORIZED` is the final supported G2 state.

### 10. COMMAND-target Approval remains reserved in G2

Giving Command durable identity satisfies the object-existence part of I-45, but it does not by itself settle whether approvals should target the Command or the underlying Project/Task action.

Therefore G2 does **not** automatically enable `ApprovalTargetType.COMMAND`.

The existing fail-closed boundary remains until Policy/Approval composition explicitly decides otherwise.

## Alternatives considered

### A. Reuse current replay `commands` rows as Command records

Rejected.

They record operation replay, not immutable requested-action intent, versioned lifecycle, target binding, or authorization.

Reinterpreting them would silently change historical semantics.

### B. Implement the entire canonical Command lifecycle in G2

Rejected.

`DISPATCHED / EXECUTING / SUCCEEDED / FAILED / UNKNOWN` cannot be given honest semantics without the G3 Effect/reconciliation boundary.

### C. Keep authorization read-only forever

Rejected.

Once Command is a durable control object, a successful authorization is itself a durable control-plane transition worth recording. What must remain false is any implication that authorization equals execution/effect.

### D. Put action/capability/scope only in Approval and not Command

Rejected.

Then the durable Command would not actually identify what action it requests; authorization could again depend on caller-presented mutable intent.

## Consequences

Positive:

- one concrete requested action gains durable identity before execution;
- authorization is bound to stored intent, not caller substitution;
- optimistic concurrency can protect Command state;
- G3 receives a clean input boundary: an AUTHORIZED Command;
- existing Approval semantics remain usable;
- no external-effect guarantees are invented early.

Costs:

- introduces a second concept currently named "command" beside the old replay registry;
- requires a new collection/table/backend contract;
- canonical full Command lifecycle remains intentionally incomplete until G3;
- some current `authorizeCommand()` tests/API must evolve from intent-based to Command-based authorization.

## Implementation boundary

After this ADR, the following becomes **B — Missing Implementation** inside G2:

- Command domain record/status vocabulary for `CREATED/AUTHORIZED/REJECTED`;
- separate Command collection in shared store + MemoryStore/SQLite;
- create/get/update Command with optimistic concurrency and events;
- immutable-intent validation;
- create Command by reading target version from current reality;
- Command-based authorization transition;
- WAIT-without-mutation behavior;
- restart/backend-contract tests;
- regression proof that runtime is never started by authorization;
- preserve COMMAND-target Approval as unsupported.

Still **outside G2**:

- dispatch;
- runtime acknowledgement;
- execution;
- external Effect;
- UNKNOWN resolution;
- retry/re-dispatch;
- leases/fencing;
- Policy Engine;
- enabling COMMAND-target Approval.

## Verification / exit criteria

G2 implementation is complete only if tests prove:

1. Command intent is immutable and versioned.
2. target version is captured from authoritative current state.
3. stale target cannot authorize.
4. action/capability/scope cannot be substituted at authorization.
5. missing/pending approval yields WAIT with Command still CREATED.
6. usable approval + current target transitions exactly once to AUTHORIZED.
7. definite refusal can transition to REJECTED according to an explicit reason table.
8. repeated mutation IDs are idempotent without confusing the replay registry with Command identity.
9. MemoryStore and SQLite pass the same Command contract.
10. restart preserves Command state.
11. authorization starts no runtime and records no Effect.
12. `DISPATCHED/EXECUTING/SUCCEEDED/FAILED/UNKNOWN` are not writable in G2.
13. COMMAND-target Approval remains fail closed.
