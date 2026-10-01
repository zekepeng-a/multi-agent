# G7.4 Context Capsule implementation Evidence

**Current gate:** G7.4 COMPLETE after independent review #3 PASSED and Human-authorized governance closure on 2026-10-01. The historical implementation, failed reviews and repairs below are retained; the closure record at the end is the current status.

## Historical implementation scope and baseline

- Architecture: ACCEPTED ADR-0009; implementation authorized by Human.
- Baseline: `3593b161b69885b36658bbb757367c8d1fd112f6`, branch
  `project-control/controller-v0.1`.
- At the original implementation-report stage this was implementation evidence,
  not independent review or stage completion; G7.4 was not marked COMPLETE.
  G7.5/G7.6 and governance boundaries were unchanged. Current closure is recorded below.

## Implemented boundary

`ContextCapsuleControl` is configured at the existing trusted Controller composition
boundary. Its versioned profile and synchronous source/Policy/Runtime/Reality and
required-integrity callbacks are supplied by Control, never by Runtime output or
an Agent's self-reported role. The integrity callback must positively prove
completeness and consistency; conflicting/unresolved required meaning fails closed.
There is no new identity, Reviewer, resolver or authorization subsystem.

An independent CapsuleId names one immutable inline canonical finite-JSON UTF-8
snapshot for one Project/Task/Run/Attempt. The archive includes complete execution
meaning, typed source pins, provenance/authority, validity observations, profile and
assembler/schema versions, selection checkpoints and bounded omission count. SHA-256
and byte budget use precisely these archived bytes. Required meaning cannot be
truncated, summarized, demoted or replaced by a path. Whole supplemental items use
profile priority followed by typed identity; no model ranking is introduced.

The default required selection includes the bounded hierarchy, its pinned contracts,
all project ACTIVE Decisions, Workspace/Reality, mandatory Policy/Approval and
Runtime restrictions. Evidence/Verification reuse G7.3 source proof; Memory comes
only from ADR-0008 current-use, with explicit trusted INFERRED opt-in. Historical
Evidence/Verification have a separate historical label and integrity check; they
cannot become current proof. PolicyDecision is audit only; Capsule does not authorize
the associated Command. Actual authorization still belongs to the existing gates.

Generation and dispatch reservation reuse the Store's transactions, event append and
mutation replay registry. The latter stores intent fingerprints and bounded operation
results, not another Command/Effect subsystem. A whole-record Attempt CAS is shared
by both backends; SQLite compares the expected JSON body under BEGIN IMMEDIATE.
Snapshot writes are insert-only. Generic Attempt updates cannot set delivery metadata
or rebind a Capsule-bound execution.

Reservation rechecks selection completeness and included-source eligibility/pins in
the writer transaction. External observations carry their own pins/times and are
recorded separately; no filesystem/database atomic snapshot is claimed. Any included
supplemental drift also refuses the old snapshot. Explicit regeneration uses a new
identity and is allowed only before reservation.

PREPARED, DISPATCHING, RECEIVED, NOT_RECEIVED and UNKNOWN remain distinct. Matching
Adapter receipt and RuntimeRef are persisted atomically with delivery observation.
Missing/mismatched receipts and ambiguous errors yield UNKNOWN and existing LOST/
BLOCKED recovery. Intent replay never repeats start. Trustworthy reconciliation may
append input receipt/non-execution proof; completion alone cannot invent delivery.
No dispatched Attempt can substitute/reuse another snapshot, including after refusal.

The Controller enables this path only with explicit `capsuleBoundary`; old
`runtimeContextFactory` objects retain their legacy contract. LocalProcess and DSH
accept a detached Capsule plus binding/hash and separate launchConfig. They retain
exact Adapter input bytes and return input-bound receipts. Credentials/live handles
stay in launch configuration. Receipt proves the Adapter boundary, not final model
tokens. Existing non-Capsule Adapter behavior remains compatible.

## Test proof

Targeted command:

```sh
node --test tests/unit/context-capsule.test.mjs tests/integration/context-capsule-restart.test.mjs
```

After the review repairs below, local Node 24.19.0: **77 passed, 0 failed,
0 skipped**. Full regression:

```sh
node --test tests/unit/*.test.mjs tests/integration/*.test.mjs
```

After the review repairs, local Node 24.19.0: **669 passed, 0 failed, 0 skipped**. This is additional local
validation; Node 22 CI remains the authoritative SQLite baseline. The existing CI
matrix retains Node 20 compatibility and mandatory Node 22 SQLite availability.

`U` below is `tests/unit/context-capsule.test.mjs`. Every backend case runs against
MemoryStore and SQLite. `R` is `tests/integration/context-capsule-restart.test.mjs`.
Its helper uses separate OS processes and an explicit readiness barrier for the
independent SQLite writer race; it does not simulate restart by reopening an object.

| ADR-0009 exit | Concrete proof |
|---|---|
| 1 | U immutable canonical archive; hierarchy/cross-project admission; atomic CAS/reuse rejection |
| 2 | U exact Task contract pin; parent contract pins; source target validation |
| 3 | U typed complete sources; unsupported/unresolved required input; Goal/Milestone; Evidence/Verification; PolicyDecision |
| 4 | U task and Workspace/Reality drift; Goal source drift; current Evidence/Verification |
| 5 | U new Decision membership, Policy and Runtime drift; required-integrity refusal |
| 6 | U source observations and drift; R actual filesystem after process restart; reserved metadata separates external observations |
| 7 | U Memory withdrawal invalidates included supplemental; regeneration uses new CapsuleId |
| 8 | U UTF-8 whole-item trimming preserves every required item; profile priority/identity ordering |
| 9 | U final UTF-8/envelope budget and no Runtime on required overflow |
| 10 | U required consistency and budget refusal; required items are copied whole with no compression path |
| 11 | U necessary Memory validity, default INFERRED exclusion, explicit recorded opt-in and no history escape |
| 12 | U historical Evidence/current Verification boundaries; inactive Decision excluded by existing ACTIVE query; required HISTORY refused |
| 13 | U exact archive/hash at Fake Adapter; R LocalProcess/DSH exact Adapter bytes |
| 14 | U detached Runtime mutation and separate secret/live launch configuration; R both real adapters |
| 15 | U missing/wrong hash/wrong Attempt receipts; matching receipt and RuntimeRef validation |
| 16 | U PREPARED/reservation/receipt distinctions; atomic refusal/terminal/event/replay rollback; R refusal process death before commit and lost response after commit |
| 17 | U crash UNKNOWN and no substitute/retry; R interrupted reservation/refusal restart, idempotent recovery and zero redispatch |
| 18 | U attributable non-receipt and recovered receipt append-only facts; Controller no-effect recovery preserves original UNKNOWN delivery after input receipt/lost receipt |
| 19 | U cross-Attempt reuse/history/substitution refusal; R delivered history remains readable without another call |
| 20 | U snapshot/event/replay and reservation rollback; whole-record CAS; R independent writer processes, one winner/one call |
| 21 | U intent-bound replay adds no events or external starts; R restarted replay |
| 22 | R exact archive/receipt and UNKNOWN after true restart; corruption/missing record fails closed |
| 23 | U shared backend suite; R SQLite durability, reservation race, and separate putRecord/insertRecord immutable creation races |
| 24 | Full regression includes Decision, Memory, Acceptance, Policy, Approval, Workspace, Runtime Adapter and legacy runtime; U Controller integration and refusal Store terminal bookkeeping; R terminal timestamp/event restart preservation |
| 25 | Node 22 SQLite availability and full npm test, plus Node 20 compatibility, passed in the immutable CI proof below; independent review and separate governance closure remain required |

## Original implementation CI proof (historical, before review repairs)

Implementation commit: `83cdb4c8266bfe815e61e772ad56a9428d080fca`.
[CI run 36743726349](https://github.com/zekepeng-a/multi-agent/actions/runs/36743726349)
completed **success** for both `test (Node 22)` and `test (Node 20)`.
The Node 22 job explicitly passed the mandatory built-in SQLite availability check
and full `npm test`. Node 20 passed the compatibility suite with the existing
capability-gated SQLite skips; it is not the full SQLite proof.

The follow-up commit records this observed result only. It does not alter the
implementation/test tree, architecture, ROADMAP or stage classification. Final HEAD
CI is checked separately before reporting task completion.

## Independent-review repairs — A / Implementation Bug and proof gap

Repair baseline: `7fb33dadb3e86bf7ffb00999700814a6ee7a26f2`.
The independent review rejected completion on three implementation defects. Its
findings are not superseded merely by passing tests; independent re-review remains
required. ADR-0009 and stage governance have not changed.

1. Controller no longer derives Capsule NOT_RECEIVED from CONFIRMED_NO_EFFECT.
   Execution recovery may create a new Run while the original input delivery
   remains UNKNOWN. U's `no-effect recovery does not invent Capsule non-receipt
   after lost receipt` runs on both backends, proves the Adapter accepted the input,
   deliberately loses the receipt, and verifies new-Run recovery without changing
   the original delivery history or producing a non-receipt event.
2. Refusal observation, Attempt FAILED, Run FAILED, event and replay row now share
   the existing mutation transaction. U injects a terminal-write failure and
   checks total rollback. R kills a child process after the refusal delivery/event
   writes but before Run termination; a new process observes rolled-back
   DISPATCHING and recovers UNKNOWN/LOST/BLOCKED without another dispatch. A second
   R case dies after commit and proves NOT_RECEIVED/FAILED/FAILED survives without
   history rewriting or redispatch. Repeated uncertain recovery is a no-op for an
   already LOST Attempt, preserving its original terminal timestamp/events.
3. SQLite Capsule putRecord and insertRecord use atomic INSERT ON CONFLICT DO
   NOTHING, never UPSERT UPDATE or a pre-read immutability guard. R runs two actual
   independent writer processes with distinct payloads and a readiness barrier,
   separately for each API: one succeeds, the other explicitly rejects/conflicts,
   and the winner's exact payload/hash survives later replacement attempts.

Observed repair verification: targeted **75/75**, full regression **667/667**,
both on local Node 24.19.0 with SQLite and zero skips. The targeted suite includes
the real process-death/restart and independent-writer cases above. Initial sandbox
execution could not spawn children (EPERM); successful reruns executed outside that
restriction. These are local proofs, not substitutes for the required Node 22 CI.
Repair implementation commit: `2fb2ec8cb38b5bcb1420c6cce33912f716bb0cfe`.
[Repair CI run 36813735243](https://github.com/zekepeng-a/multi-agent/actions/runs/36813735243)
completed **success**. Directly observed job/step results confirm Node 22 passed
the mandatory SQLite availability check and full npm test; Node 20 passed npm test
with its existing capability-gated SQLite skips. Node 20 remains compatibility only.
This Evidence-only follow-up records that observed run; its own final HEAD CI must
also be checked. All 25 exit criteria have implementation/test mappings, but this
repair self-check does not supply the separately required independent re-review
or authorize a COMPLETE governance update.

## Second-review repair — Attempt terminal bookkeeping

Baseline: `ffb70029a4f92a2b961704c5e5a5560044d3fdad`. The second independent review
closed the original three defects but found an A-class regression: the Capsule CAS
wrote Attempt FAILED without Store terminal bookkeeping, leaving endedAt null and
omitting the normal attempt.updated event. Completion remained rejected.

The trusted Capsule CAS now changes only delivery metadata. Within that same outer
mutation transaction, the existing store.updateAttempt(attemptId, {status: FAILED})
performs the terminal transition, endedAt bookkeeping and normal event append;
Run FAILED, Capsule observation and mutation replay share the commit. No lifecycle
rules were copied into Capsule, no Store API permissions were expanded, and the
Capsule-bound delivery/binding guard remains unchanged.

- U `refusal preserves Store terminal bookkeeping exactly once across recovery and
  replay` runs on MemoryStore and SQLite: NOT_RECEIVED/FAILED/FAILED, non-null valid
  endedAt, exactly one corresponding FAILED attempt.updated and delivery event,
  replay persisted, one Runtime invocation; repeated recovery/dispatch replay
  preserves complete Attempt/Run/event/replay records.
- U terminal-write failure occurs after the normal Attempt bookkeeping has run;
  it proves endedAt/status/delivery/events/replay all roll back together.
- R process death before Run termination proves no partial terminal history,
  timestamp or replay survives. R committed-refusal restart proves endedAt and the
  normal FAILED event persist, and two fresh-process dispatch replays plus repeated
  recovery neither invoke Runtime nor change timestamps, events or replay rows.

Observed local Node 24.19.0: targeted **77/77**, full regression **669/669**, zero
failures/skips. These include actual child-process restart and independent SQLite
writer tests. Repair commit: `fc501d85ed8547b8423a3742f450c1dcd80c6e25`.
[Terminal-bookkeeping repair CI 36815386896](https://github.com/zekepeng-a/multi-agent/actions/runs/36815386896)
passed both jobs: Node 22's mandatory SQLite check and full npm test succeeded;
Node 20's compatibility npm test succeeded with its existing SQLite skips. These
job/step results were directly observed. This Evidence-only follow-up records that
run; final HEAD CI is verified separately. Exit criterion 24 has concrete
implementation and regression proof;
independent re-review is still required. ADR-0009, ROADMAP and phase status unchanged.

## Review limits

Exact pins, all ACTIVE Decisions and included-supplemental drift are intentionally
conservative. Profile integrations must provide truthful scoped observations and
semantic integrity checks; Capsule does not authenticate arbitrary callback callers
or prevent filesystem changes after observation. SQLite transactions cannot make
external calls exactly-once: ambiguous windows remain UNKNOWN and are never blindly
replayed. No fixed TTL, history cleanup, leases/fencing or new Effect layer was added.

No new D/E issue was discovered within this bounded implementation. At the time of
the implementation reports, independent review and separately authorized governance
closure remained necessary; the following record closes those gates.

## Independent review #3 and authorized governance closure

- Architecture gate: ADR-0009 ACCEPTED; its decision semantics are unchanged.
- Reviewed implementation HEAD: `1f9f208d8eef9fabcba02ac93772ff5713612f24` on
  `project-control/controller-v0.1`.
- Final implementation CI [36815496417](https://github.com/zekepeng-a/multi-agent/actions/runs/36815496417):
  success; Node 22 mandatory SQLite check and full npm test succeeded; Node 20
  compatibility npm test succeeded with its existing capability-gated SQLite skips.
- Targeted tests: **77/77**. Full local Node 24.19.0 regression: **669/669**, zero
  failures/skips. These local counts remain distinct from Node 22 CI proof.

| Independent review | Reviewed HEAD | Outcome and retained history |
|---|---|---|
| #1 | `7fb33dadb3e86bf7ffb00999700814a6ee7a26f2` | FAILED: no-effect incorrectly implied non-receipt; refusal had a split-commit crash window; SQLite Capsule putRecord could overwrite through UPSERT competition. First repair and proof remain above. |
| #2 | `ffb70029a4f92a2b961704c5e5a5560044d3fdad` | Original three CLOSED; review FAILED on new Attempt terminal bookkeeping P2 (missing endedAt and normal FAILED event). Second repair and proof remain above. |
| #3 | `1f9f208d8eef9fabcba02ac93772ff5713612f24` | PASSED: Attempt bookkeeping P2 CLOSED, original three still CLOSED, no new P0/P1/P2 or D/E; all 25 ADR-0009 exit criteria independently confirmed satisfied. |

Review #3 directly checked the code/Store transaction boundary, test and real
process-restart call chains; it independently ran the no-disk backend unit cases
and an additional late replay-write failure probe on both backends, confirming
full rollback, event cardinality, terminal replay stability and ordinary API guards.
It verified final HEAD CI rather than treating Evidence/test counts as acceptance.
Its explicit conclusion was: "第三轮独立复审通过，可以进入 G7.4 COMPLETE 治理收尾。"

The G7.4 exit gate is satisfied. Human explicitly authorized this governance
closure on 2026-10-01; **G7.4 may now be marked COMPLETE**, and ROADMAP plus current
boundary documents record that status. This does not rewrite the two failed reviews.
G7.1–G7.4 are COMPLETE; G7 overall remains ACTIVE. G7.5 remains D / queued, with
no research or implementation authorization. G7.6 is decided only by actual G8
need; leases/fencing remain NOT CURRENTLY REQUIRED. No implementation, ADR decision
body, frozen authority/invariant or subsequent-stage work changes in this closeout.
