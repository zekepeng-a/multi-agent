# G8 bounded dogfood Slice 2 — real Effect and uncertainty reconciliation

**Status:** IMPLEMENTATION EVIDENCE — independent review pending.
**Date:** 2026-10-01.
**Branch:** `project-control/controller-v0.1`.
**Authorized baseline:** `b78b334f927085344dada2df306a6093a2c8867e`.
**Code/test HEAD:** `f5a67f9ad076d7b022c60d2d68c95d3706547fa3`.
The subsequent Evidence-only commit does not change production semantics,
governance status or accepted ADRs. G8 is not COMPLETE; Slice 3 is not executed.

## Existing boundary used

ADR-0002's ACCEPTED boundary is reused unchanged:

`AUTHORIZED Command → REQUESTED persisted → DISPATCHED persisted → external mutation → direct observation or UNKNOWN → Reality reconciliation`.

All additions are tests/helpers. Production Controller, driver contract,
Store, transaction ownership, Effect lifecycle, retry rules and Command
lifecycle are unchanged. Runtime is not relabeled Effect. The composition
is **B — settled-boundary integration proof**, not a new provider architecture.

## Actual provider and authorization

`tests/helpers/g8-local-file-effect-driver.mjs` implements the existing
`dispatch(effect)` / `reconcile(effect)` interface. Each fixture allocates a
test-owned `g8-effect-provider-*` OS temporary directory separately from its
`g8-effect-control-*` SQLite directory, repository and Workspace. There is no
Workspace record or WorkspaceManager write. Cleanup removes both temporary
directories; paths below are historical observations, not retained artifacts.

This narrow provider is synchronous and marker-only: its sole mutation creates
`marker.json` using exclusive `wx`. It has no queue, delayed worker, temp/rename
mutation or other writer in its isolated directory. Those constraints permit
positive non-occurrence only after the complete directory is observed empty.
They are not a rule that arbitrary external file absence proves no effect.

The durable Task-target Command `command-2` binds:

- project `p2`, Task `t2`, target version 1;
- action `external.marker.write`, capability `external.marker.create`;
- scope `test-provider`, risk HIGH, requester `human-slice-2`;
- parameters `{ "marker": "bounded-real-effect", "version": 1 }`;
- idempotency key `marker:t2:v1`.

Real StaticPolicyEngine version `slice-2-v1`, rule `marker-approval`, requires
Approval. Controller authorization first WAITs, then consumes durable
`approval-2` APPROVE by `human-slice-2` and records AUTHORIZED. DENY, CREATED,
missing Command and stale target authorization tests create no Effect and make
zero provider calls. Caller-supplied action/capability cannot substitute stored
Command intent. This does not add a new general late-authorization recheck:
the existing authorization/Effect APIs retain their own accepted boundaries.

Effect `effect-2` copies action/capability from that Command; destination is the
actual absolute provider marker path. Mutation replay identity (for example
`op-direct`, expanded to request/dispatch/outcome mutations), EffectId and
idempotencyKey are separately asserted and are not interchangeable.

## Dispatch and observation

Before any write the driver asserts DISPATCHED, exact EffectId/CommandId,
action/capability, destination and idempotency binding. For SQLite, a separately
opened connection reads committed Effect state and events before the mutation:
REQUESTED precedes DISPATCHED, both have matching status, and Command is
AUTHORIZED. MemoryStore follows the same contract.

Marker bytes contain EffectId, CommandId, idempotencyKey, action, capability,
the full payload and its SHA-256. Direct success rereads actual file bytes.
Reconcile reads current directory entries, lstat, bytes and SHA-256; exact
expected bytes imply all identity/payload bindings match. It never uses
dispatch mode, writes count, past observations or a saved expected outcome
as outcome truth. Fresh-driver and fresh-process tests establish this separation.

Successful observationRef/resultRef is the actual `file:///.../marker.json`
URL with `#sha256=<actual-hash>`, receipt provider `test-local-marker`,
receiptId `sha256:<actual-hash>`. Empty-provider observation identifies the
real directory with `#empty-marker-only-provider`. These are Effect observations,
not Acceptance Evidence or retained copies of temporary external Reality.

## Concrete traces and assertions

The following paths were actually observed in the Windows Node 22 targeted
run; fixtures remove them after the assertions. The marker hash in all these
deterministic successful cases was
`d4193fe2b229d14bb94124a2b596cb1c216aeb5621f0539d194c8f0202722662`;
the nested payload hash was
`5fe4f542fd5cda1c1fc997e09ed652d42db67c53e29ce41a24a773383baa7cb1`.

| Scenario | SQLite destination under `C:/Users/ADMIN/AppData/Local/Temp/` | Observed history / proof |
|---|---|---|
| A: direct success | `g8-effect-provider-lGmqb6/marker.json` | Absent before dispatch; exact bytes after. `effect.requested → effect.dispatched → effect.succeeded`; SUCCEEDED, dispatchCount 1, one driver call/write, NOT_REQUIRED. |
| B: write happened, response lost | `g8-effect-provider-z5JwzR/marker.json` | File written and reread before throw. `effect.unknown → effect.reconciliation_started → effect.reconciled_succeeded`; UNKNOWN/REQUIRED then SUCCEEDED/RESOLVED, dispatchCount stays 1. Fresh driver has zero dispatch calls/writes; bytes and mtime unchanged. UNKNOWN retry rejected. |
| C: transport uncertainty before mutation | `g8-effect-provider-WhlH86/marker.json` | UNKNOWN, directory empty, retry rejected; real empty-directory observation → FAILED_NO_EFFECT/RESOLVED; explicit retry → SUCCEEDED. dispatchCount 1→2, calls 2, actual writes 1. First UNKNOWN and no-effect events remain append-only. |

Ambiguity tests separately corrupt EffectId, CommandId, idempotencyKey,
payload, payloadHash, malformed bytes or unexpected directory shape. Every
reconcile remains UNKNOWN/REQUIRED with no retry permission and no second
dispatch. Bytes/directory are compared before/after to prove no external repair
or overwrite. An unexpected file with the canonical marker absent is still
UNKNOWN, not confirmed no-effect.

Exact dispatch mutation replay does not enter the provider again, add events,
create another Effect, rewrite bytes or change mtime. Replay of the explicit
safe retry likewise does not create a third dispatch. `idempotencyKey ≠ exactly
once`: this proves persist-before-dispatch, no blind retry and observations,
not universal exactly-once delivery or a general idempotent provider library.

## Effect-only real restart

`tests/helpers/g8-effect-child.mjs` is invoked via bounded `spawnSync` (15-second
deadline, SIGKILL timeout policy, no barrier or descendants). Process A seeds
and authorizes, writes the external marker and loses the response; UNKNOWN and
REQUIRED are committed and A closes/exits. A separate connection proves that
UNKNOWN persisted. Process B opens SQLite and constructs a driver with no
dispatch history, re-observes the real marker and resolves SUCCEEDED.

Assertions prove dispatchCount 1, one DISPATCHED event, B calls/writes 0, exact
file bytes/hash and mtime unchanged, historical events preserved and final
state surviving another reopen. This is process restart at the Effect boundary,
not power-loss durability, mid-write atomicity or whole-chain Task recovery.

## Authority separation

Every successful scenario compares Project, Milestone, Goal, Task and Acceptance
records to their pre-Effect snapshots. Evidence, Verification, Run, Attempt and
Workspace collections stay empty. Command remains AUTHORIZED, not completed by
Effect success. Runtime/verifier seams throw if accidentally invoked. No receipt
is manufactured into Evidence and no Task/Goal/Project acceptance is inferred.

## Verification and remaining G8 proof gaps

- New real provider suite: **25/25**, zero failures/skips on Node 22.
- Targeted Effect, persistence, Policy/Approval, SQLite initialization/competition,
  Capsule restart and Slice 1 regression: **190/190**, zero failures/skips.
- Full Node 22.23.3: **745 passed / 0 failed / 0 skipped**.
- Full Node 20.20.2: **450 passed / 0 failed / 295 expected SQLite capability skips**.
- Code/test HEAD remote CI: [36850256452](https://github.com/zekepeng-a/multi-agent/actions/runs/36850256452),
  **success**. Node 22 job 110329954713: SQLite availability check success,
  **745 passed / 0 failed / 0 skipped**. Node 20 job 110329954957:
  **450 passed / 0 failed / 295 expected SQLite capability skips**.
  The subsequent Evidence-only commit's CI is separately checked and reported
  after completion; this run is not used to assume its result.

New bounded G8 evidence covers real Effect/reconciliation, Effect-only
restart/recovery, real Policy/Approval→Command→Effect authorization and auditable
append-oriented external history. Slice 1's Runtime/Workspace/Verification
proof is preserved but is not combined into a new whole-chain claim.

Still unproven here: whole-chain Task/Runtime restart, durable/readable Runtime
result content, DSH live host/resume, LocalProcess↔DSH substitution, write
Workspace integration and general/network provider mutations. No new A/C/D/E
issue was found in the authorized slice. No Roadmap, Observability, lease,
distributed ownership, accepted ADR or G8 governance change is included.

Independent review is required. A sensible next bounded gap is durable/readable
Runtime result content across process restart, with its authority kept separate
from Acceptance; it needs separate Human authorization and is not started here.
