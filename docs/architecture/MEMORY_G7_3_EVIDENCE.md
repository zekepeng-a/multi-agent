# G7.3 Project-control Memory — Implementation Evidence

Date: 2026-09-30
Architecture: ACCEPTED ADR-0008.
Implementation baseline: `43af65b58717d127f8948906992916006feb8b5c` on
`project-control/controller-v0.1`.
Verified implementation commit: `9b3a0f6b5bd6161cc0f89198465412e8c9537146`.
CI: [GitHub Actions run 36723895383](https://github.com/zekepeng-a/multi-agent/actions/runs/36723895383).
Status: implemented; local regression and full Node 22 CI passed.
Phase completion remains subject to independent review. ROADMAP is not advanced.

## Implemented boundary

`project-control/project-memory.mjs` owns the shared Memory control rules above
the existing backend primitives. `domain.mjs` supplies the closed vocabulary and
promoted record. `Controller.memory` is an optional trusted composition seam;
it does not inject Memory into Runtime context.

The supported operations are `propose`, `validate`, `promote`, `withdraw`,
`reconcile`, `query` and `history`. Candidates are ephemeral JSON values without
MemoryId or durable authority. Promotion requires an attestation issued by this
trusted facade for the exact candidate. The in-process issuance handle is not
persisted as a candidate domain; the immutable attestation is retained in the
promoted record. After restart, a fresh promotion needs fresh validation;
identical replay of an already committed mutation uses its stored replay result.

Trusted Human identity, Control Plane identity, optional reviewer assignment
resolution and bounded Evidence reality observation are supplied by the existing
control caller at composition time. They are not copied from Runtime payloads.
The facade is an internal trusted API, like the existing Store mutation APIs;
it is not authentication middleware. No identity provider, role registry or
Reviewer subsystem is added. Missing/untraceable reviewer assignment fails closed.

Validation distinguishes attributable HUMAN/REVIEWER semantic judgement from
CONTROL_PLANE_EXACT literal field rendering. It binds project, type, content,
confidence, applicability, assumptions, claim and every necessary source ref.
Both candidate tampering and attestation tampering prevent fresh promotion.
Semantic fidelity and source necessity remain accountable judgements, not
automatically proven truth. Exact validation cannot bless free-form inference.

Admission follows ADR-0008's closed matrix. Decision/Constraint ACCEPTED requires
one corresponding ACTIVE Decision; explicit constraint text is bound to that
Decision. FACT ACCEPTED requires its own contract-bound accepted target, actual
acceptance event and current proof; a Decision cannot establish an accepted FACT.
VERIFIED requires current non-candidate Evidence and matching immutable
Verification, with explicit matching verdict. FAIL can support a scoped failure
lesson. INFERRED retains assumptions and is excluded unless explicitly opted in.
Memory never upgrades Evidence, Acceptance or Decision authority.

All four resolver families are supported: DECISION, EVIDENCE, VERIFICATION and
PROJECT_STATE (TASK, GOAL, MILESTONE, PROJECT). Sources are exact-pinned and their
project/parent/execution/workspace ownership is re-proved. Evidence and
Verification pins use deterministic immutable semantic fingerprints, separately
from lifecycle. Versioned sources use exact positive versions. Accepted-state
proof reuses the existing pinned Acceptance, execution and aggregate snapshot
checks. Existing Acceptance mutation rules keep their original whitelist; only
the new read adapter additionally permits already ACCEPTED Evidence.

Every source is necessary. Any INVALID or UNRESOLVED source suppresses current
use. Known invalidity can be explicitly reconciled to SOURCE_INVALIDATION;
unavailability alone cannot permanently stale a record. Attributable Human
withdrawal uses HUMAN_WITHDRAWAL. Recorded ACTIVE and current eligibility are
separate. PROJECT_STATE version changes invalidate its exact pin, even when the
asserted field is unchanged. No TTL or unrelated-file dependency is introduced.

Meaning is immutable. ACTIVE can become STALE; ACTIVE/STALE can become
SUPERSEDED only with an independently validated new MemoryId in the same Project.
Both lineage links, rows, events and replay commit/roll back together. STALE
cannot become ACTIVE; SUPERSEDED is terminal. Historical content and original
validation/source authority remain readable.

Current-use queries require ProjectId, filter lifecycle and all source validity
before relevance/limit, exclude INFERRED by default, and use simple token match
counts with MemoryId tie ordering. History/debug is explicitly selected by
MemoryId or ProjectId plus lifecycle statuses and exposes eligibility reasons.
Reads do not mutate Memory, events, timestamps or replay.

## Persistence and observation limits

Both backends use the same facade/rules. MemoryStore has a Memory Map and rollback
of Maps/events for synchronous transactions. SQLite stores id/version/project/
status plus JSON body in `memories`, indexed by project. Mutations reuse the
existing replay registry: its operation identity includes a deterministic intent
fingerprint, without adding a durable Command lifecycle or replay subsystem.
Expected-version and backend CAS protect lifecycle writes and replacements.
Failed SQLite BEGIN does not leave transaction depth poisoned; a subsequent
failed mutation still rolls back all state/event/replay writes.

SQLite queries use a consistent Control Store read snapshot. External Evidence
reality is observed separately by the trusted bounded observer, with its own
revision, observation reference and time. Task artifacts without an available
observer are UNRESOLVED. Aggregate child-state evidence is checked against the
existing Control Store snapshot proof. This implementation supplies the seam,
not a general artifact/URL parser. The tests' file observer is a test fixture.

No atomic database/filesystem snapshot, perpetual validity, automatic semantic
truth proof or later Context freshness is claimed. Consumers must re-query for
a later current-use claim. Known source invalidity is distinguished from observer
unavailability; no cached valid flag is restored on restart.

## Verification

Local runtime: Node `v24.19.0`, built-in SQLite available.

- Targeted Memory suite: 59 passed, 0 failed, 0 skipped.
- Full `npm test`: 592 passed, 0 failed, 0 skipped.
- The full suite retains all 533 pre-existing tests, including Decision,
  Approval, Policy, Acceptance, Controller, persistence and legacy Runtime.
- `git diff --check`: clean.
- Observed remote proof: CI run `36723895383`, Node 22 job `109915686554`,
  **592 passed, 0 failed, 0 skipped**, built-in SQLite capability check passed.
  Node 20 job `109915686486` also passed: 383 passed, 0 failed, 209 expected
  SQLite-capability skips. Node 20 is not the complete persistence exit proof.
  The subsequent Evidence-only commit preserves this tested implementation;
  its own commit checks remain independently inspectable in GitHub Actions.

## ADR-0008 exit criteria coverage

`tests/unit/project-control-memory.test.mjs` executes each behavioral case on
MemoryStore and SQLite. `tests/integration/project-control-memory-restart.test.mjs`
uses independent Node processes and a real SQLite file; the helper is
`tests/helpers/pc-memory-child.mjs`.

| Exit | Executable proof |
|---|---|
| 1 | proposal has no identity/state authority; self-reported roles cannot authorize validation |
| 2 | trusted reviewer assignment binds exact candidate and task/run/attempt; HUMAN fidelity differs from restricted exact control rendering |
| 3 | candidate/attestation immutable-field tampering and rejected/forged attestations fail atomically |
| 4 | closed type × confidence × source matrix admits precisely supported combinations |
| 5 | refs must be pinned, internal, supported, project-owned and necessary; all four PROJECT_STATE targets resolve ownership |
| 6 | accepted FACT requires its own current contract and actual Acceptance; CANDIDATE is not upgraded; FAIL supports failure lesson; accepted Goal/Milestone/Project reuse own live proof |
| 7 | every necessary dependency remains valid; deletion, pin and lifecycle suppress; exact PROJECT_STATE version invalidation |
| 8 | UNRESOLVED observations exclude without mutating lifecycle or inventing falsity |
| 9 | unrelated control change and elapsed observation time do not invent invalidity; real unrelated-file change after restart |
| 10 | source recheck at promotion; external reality re-observed at promotion; restart recomputes current eligibility |
| 11 | Human withdrawal is attributable and separate; known external invalidity/status downgrade reconcile; no stale resurrection |
| 12 | new-id replacement independently validates and atomically links lineage; cross-project/identity rejection; injected rollback after row/event/replay writes |
| 13 | preserved historical meaning/attestation and cloned reads; real restart preserves lineage/lifecycle/content |
| 14 | Decision terminal lifecycle excludes Memory before reconciliation and never upgrades authority |
| 15 | project/lifecycle/source filters precede deterministic relevance and limit |
| 16 | INFERRED explicit opt-in; history is a distinct explicit read surface |
| 17 | reads never write; separate observation pins/times; SQLite read snapshot with independent writer during reality observation |
| 18 | CAS rejects stale staling/replacements; two independent SQLite writer processes cannot both replace one expected version |
| 19 | intent-bound mutation replay; different intent rejected; restart replays promotion, replacement, withdrawal and reconciliation without resurrection/events |
| 20 | same 27 behavioral cases on both backends |
| 21 | real process restart; changed real artifact/Decision/target version; UNRESOLVED and recorded-ACTIVE separation |
| 22 | all pre-existing tests retained; full local suite green; observed Node 22 CI: 592 pass, zero failures/skips |
| 23 | this Evidence records implemented boundary and observation limits; independent stage review pending |

## Scope and completion review

No new D/E issue was found. The transaction-depth correction is an implementation
bug fix required for Memory atomicity, not a new concurrency architecture.

No G7.4 Capsule, Runtime injection, vector/embedding/ranking infrastructure,
legacy migration, knowledge graph, external source parser, authentication system,
Roadmap domain, observability subsystem, lease/fencing or distributed lock is
implemented. Decision/Approval/Policy/Acceptance authority is unchanged.
Blueprint, ADR-0008, canonical architecture, ROADMAP and G7 decomposition are not
rewritten or advanced by this implementation commit. Their phase/completion
statements remain governance boundaries pending the independent review of this
code and evidence; they are not claims that this new implementation is absent.
