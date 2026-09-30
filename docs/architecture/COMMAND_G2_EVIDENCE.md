# G2 Durable Command — Implementation Evidence

**Roadmap phase:** G2  
**Architecture decision:** `ADR-0001-durable-command-boundary.md`  
**Verified head:** `80cb7635c73b518ba42cda4e7dbec38bc687bec4`  
**CI run:** GitHub Actions `36677634584`

## Implemented boundary

G2 implements a durable Command as stored immutable intent + versioned authorization state.

Supported lifecycle:

```text
CREATED
   ├──→ AUTHORIZED
   └──→ REJECTED
```

Reserved/non-writable until G3:

```text
DISPATCHED
EXECUTING
SUCCEEDED
FAILED
UNKNOWN
```

The implementation intentionally starts no runtime and records no external Effect.

## Durable identity and persistence

Implemented across shared store semantics, MemoryStore, and SqliteStore:

- CommandId + independent Command version;
- target type/id/version;
- action/capability/scope/risk;
- requester;
- expected target version;
- parameters;
- idempotency key;
- authorization/rejection fact;
- command.created / command.authorized / command.rejected events.

The SQLite domain table is `control_commands`, intentionally separate from the historical store-mutation replay table `commands`.

## Authorization semantics

Authorization re-reads the stored Command. A caller cannot substitute a new target/action/capability/scope during authorization.

The gate proves:

1. Command is still CREATED and command version matches.
2. target still exists.
3. current target version still equals the Command's pinned targetVersion.
4. expectedVersion, when present, still matches current target state.
5. Approval matches the stored target/action/capability/scope and target version.
6. then and only then Command becomes AUTHORIZED.

Missing/pending approval returns WAIT with no Command mutation.

Definite fail-closed conditions used in current G2 rules can make the concrete Command REJECTED.

## Existing replay registry remains separate

The historical backend primitive:

```text
command_id → { operation, result_id }
```

still exists only to deduplicate authoritative store mutations.

It is not reinterpreted as the durable Command domain.

## COMMAND-target Approval remains unsupported

Command now has durable identity, but G2 does not decide whether human approval should target:

- the Command object; or
- the underlying Project/Task action.

That belongs to later Policy/Approval composition. COMMAND-target Approval therefore remains fail closed.

## Verification

Latest full CI:

```text
Node 22.23.3
tests   450
pass    450
fail    0
skipped 0
```

Package-floor CI:

```text
Node 20.20.2
tests   450
pass    304
fail    0
skipped 146
```

The Node 22 job asserts built-in `node:sqlite` availability before running tests.

## Exit-criteria evidence

ADR-0001 exit criteria are covered by the current implementation/tests:

1. immutable, versioned Command intent — covered;
2. target version captured from authoritative state — covered;
3. stale target cannot authorize — covered;
4. authorization cannot substitute action/capability/scope — covered;
5. missing/pending approval returns WAIT and stays CREATED — covered;
6. usable Approval transitions exactly once to AUTHORIZED — covered;
7. definite fail-closed refusal can become REJECTED — covered;
8. mutation replay is idempotent and distinct from Command identity — covered;
9. MemoryStore and SQLite share Command behavior — covered;
10. real process restart preserves Command and authorization — covered;
11. authorization starts no runtime and records no Effect — covered;
12. reserved dispatch/effect states have no G2 transition API — covered;
13. COMMAND-target Approval remains fail closed — covered.

## Boundary for G3

G2 ends at an AUTHORIZED Command.

G3 must decide what it means to cross this boundary:

```text
AUTHORIZED Command
        ↓
dispatch attempt?
        ↓
external Effect
        ↓
receipt / failure / UNKNOWN
        ↓
reconciliation
```

No G2 code claims to answer those questions.
