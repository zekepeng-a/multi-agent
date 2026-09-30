# ADR-0008 — Project-control Memory promotion, validity and lifecycle

Status: PROPOSED
Date: 2026-09-30
Roadmap phase: G7.3 — Project-control Memory
Related invariants: I-02, I-09, I-10, I-12, I-14, I-20, I-21, I-23, I-24, I-25, I-27, I-28, I-34, I-35, I-38, I-45

## Context

Baseline: `project-control/controller-v0.1` at
`be0b2383b47d78b91e446555c3026762054842d7`.

Inputs are `PROJECT_BLUEPRINT.md` §§5–8, 12–15;
`PROJECT_CONTROL_OS_ARCHITECTURE.md` §§5.13–5.14, 14, 17, 19, 27;
`ROADMAP.md` G7.3; ADR-0007; `PERSISTENCE_BOUNDARY.md` §§2–4, 8–12;
and the bounded external source review described below.

G7.2 supplies durable Decisions. G7.3 still lacks promotion authority, confidence
meaning, source validation, invalidation, replacement and query semantics.
The canonical vocabulary exists; its Memory authority matrix is partly proposed.

Legacy V0.5 memory is a rebuildable runtime product under `.ai/memory`.
Its planner decisions, keyword ranking, unknown provenance and in-place lesson
aggregation are not the Project-control Memory contract.
`project-control/memory-store.mjs` is an in-process storage backend, not this domain.

This ADR proposes a minimal boundary. It does not amend frozen invariants.
While PROPOSED it grants no implementation permission and does not close the
ROADMAP D-GATE.

## Decision

All choices below are proposed for explicit acceptance.

### 1. Memory is retained knowledge, not state or permission authority

The unchanged conflict hierarchy is:

```text
Current Reality > Verified Evidence > Accepted Project State
  > Decision / Constraint > Promoted Memory
  > Historical Run > Old Conversation
```

Memory cannot create Evidence, Verification, Acceptance, Approval, PolicyDecision
or project direction. Store authority over Memory lifecycle metadata does not
make Memory content authoritative Project State.

Memory is project-scoped. Its identity is MemoryId, independent of Runtime and
Decision identity. Runtime/model output alone never creates an ACTIVE Memory.

### 2. Proposal, validation and promotion have separate responsibilities

| Operation | Allowed actor | Rule |
|---|---|---|
| Propose candidate content | HUMAN, CONTROL_PLANE, or Runtime/Agent | Proposal has no Memory authority and cannot enter default queries. |
| Resolve/check source identity, scope and currency | CONTROL_PLANE | Deterministic checks against supported control objects and observed reality. |
| Validate content fidelity and confidence | HUMAN or designated REVIEWER; CONTROL_PLANE only for exact deterministic field renderings | Validate the exact candidate and its sources, not merely the existence of files. |
| Promote/create or replace Memory | CONTROL_PLANE | Re-check sources and enforce the validated candidate contract transactionally. |
| Mark Memory STALE | HUMAN or CONTROL_PLANE, recorded through the control boundary | Non-empty attributable reason; no alteration of source objects. |
| Detect known source invalidity and reconcile it | CONTROL_PLANE | Persist STALE without inventing replacement meaning. |

A REVIEWER is the existing delegated verification role, not an arbitrary worker
claiming that role. An agent executing a reviewer assignment may produce a
validation attestation only within that assignment. A worker cannot self-assign
validation or promotion authority.

A candidate input is not a new durable domain or lifecycle. MemoryId is issued
at promotion; candidates need not be persisted by G7.3.

Promotion preserves an immutable validation attestation containing:
validator type/id, validation method, candidate fingerprint, pinned source refs,
confidence, scope, result and validation time. The fingerprint covers project,
type, content, confidence and all source refs. Changing any of them requires a
new attestation. A rejected or mismatched attestation cannot authorize promotion.

HUMAN/REVIEWER validation records an attributable content judgement.
CONTROL_PLANE validation is restricted to deterministic literal/structured
restatements of existing fields; it cannot validate free-form inference.
Actor identity comes from the trusted control caller/assignment, not an
untrusted runtime payload. This is attribution/enforcement at the existing
control boundary, not a new authentication system.

Rationale: source resolution and semantic fidelity are different checks.
Recording that a file exists or accepting a model's self-reported confidence
does not perform the second check.

### 3. Type semantics and allowed confidence

| Type | Meaning | Allowed confidence |
|---|---|---|
| FACT | One bounded observation or existing control-state assertion, with its time/revision/scope. It must not broaden an observation into a universal assertion. | VERIFIED, ACCEPTED, INFERRED |
| DECISION | A faithful restatement of one identified ACTIVE Project Decision. No new choice or rationale is introduced. | ACCEPTED |
| CONSTRAINT | A faithful restatement of an explicit constraint in one identified ACTIVE Project Decision. It does not create a new directive. | ACCEPTED |
| LESSON | A reusable, explicitly scoped observation about a failure, fix or verification pattern. Generalization beyond demonstrated cases is inference. | VERIFIED, INFERRED |

DECISION/CONSTRAINT require exactly one originating Decision reference.
Additional corroborating refs are permitted and remain necessary dependencies.
A new desired constraint must first follow ADR-0007's Decision boundary; it must
not be created by labeling Memory as CONSTRAINT.

### 4. Confidence describes support, not Acceptance or a numeric rank

- **VERIFIED:** existing current Evidence plus a matching immutable Verification
  support the precise bounded assertion, and the content attestation confirms
  faithful rendering. A FAIL verdict can support a lesson about an observed
  failure; it cannot support a claim of successful execution. The verdict and
  verified scope must match the claim. File existence/hash checks alone do not
  justify VERIFIED.
- **ACCEPTED:** a faithful restatement of an authoritative recorded control fact:
  either an ACTIVE Decision or a currently supported accepted target state
  with its own contract-bound Evidence/Verification lineage. This describes
  source origin. It does not mean the Memory itself passed project Acceptance.
  A completion aggregate without its own acceptance proof is insufficient for
  an ACCEPTED FACT in this first boundary.
- **INFERRED:** an explicitly identified interpretation or generalization,
  supported by traceable sources but not established by those sources as the
  exact asserted conclusion. Its attestation states assumptions and applicability
  limits. Human review of an inference does not automatically make it VERIFIED.

These labels are not an authority ladder, do not change source status and never
waive an Acceptance contract. Promotion is not Acceptance. Confidence is immutable;
stronger support requires a newly validated replacement Memory.

Default current-use queries exclude INFERRED. A caller may explicitly request
INFERRED alongside otherwise valid memories; returned records retain that label
and assumptions. This opt-in does not increase their authority.

### 5. Source refs are exact, project-bound dependencies

The first implementation supports only:
DECISION, EVIDENCE, VERIFICATION, and PROJECT_STATE
(with target type PROJECT, MILESTONE, GOAL or TASK).

Each ref records source type/id, owning project, a concrete version/revision or
immutable-record fingerprint, and the bounded claim/scope it supports.
IDs or bare paths without pins are insufficient. For records without a version,
a deterministic fingerprint of immutable semantic fields supplies the pin.
Lifecycle/currentness is checked separately, not hidden inside a content hash.

The resolver must prove:
1. the source exists in the supported control model;
2. ownership, including parent/run/task lineage where needed, reaches this Project;
3. the pin matches the recorded semantic source;
4. the source's current lifecycle and related lineage permit the claimed use;
5. required reality revisions remain current at the observation used for the check.

Typed resolver rules:
- Decision: same project, matching pin, ACTIVE; terminal Decisions are history.
- Evidence: existing target/execution/workspace lineage remains coherent;
  rejected, stale or superseded evidence is unusable for current use.
  Candidate Evidence may support INFERRED content, but Memory never upgrades it.
- Verification: immutable pinned record plus matching underlying Evidence and
  target/contract scope; underlying evidence must still be current. Its verdict
  must support the confidence/claim, not merely exist.
- Project state: exact target version and, for ACCEPTED content, concrete
  Acceptance id/version and current supporting proof. A status string alone
  is insufficient.

Existing acceptance/revision checks are reused; Memory does not invent a second
Acceptance evaluator. Decision is consumed as an authoritative Decision under
ADR-0007; this ADR does not recursively re-verify all of its original external
source refs or amend G7.2 validation.

Every source ref is a necessary dependency. If any one is invalid, the whole
Memory is unavailable. We do not implement optional refs, quorum support or
per-sentence dependency graphs. A source that is merely contextual should not
be included as a supporting ref in this first version.

External URLs, chats, runtime files, PolicyDecision and Memory-to-Memory references
are not direct supporting source types in G7.3. External/runtime artifacts may be
represented through existing Evidence and its ordinary verification boundary;
an arbitrary artifact reference alone does not establish a claim.
No universal URL/file resolver is added.

### 6. Source validity and recorded lifecycle are distinct

Source checks return CURRENT, INVALID or UNRESOLVED with reasons and observation
pins/times. These are resolver results, not new Memory lifecycle states.

- Known mismatch, missing internal object, superseded/revoked Decision, stale
  proof or changed required revision: INVALID.
- Required reality/artifact cannot be observed or checked reliably: UNRESOLVED.
- All required checks succeed: CURRENT.

INVALID and UNRESOLVED both exclude the Memory from current-use queries.
Transient unavailability is not proof that the content became false.

Explicit reconciliation persists STALE for known INVALID dependencies, with
reason, responsible actor and observation refs. UNRESOLVED is reported as
unavailable but does not automatically cause a permanent lifecycle mutation.

Historical assertions remain readable with their original scope and sources.
A past observation may remain historically true even when no longer applicable
now; it does not remain eligible for current use merely for that reason.
Unrelated files changing do not invalidate Memory. Required source pins changing
do; the bounded first version is deliberately conservative.

No fixed TTL is required. Time is not a substitute for revision/source validity.

### 7. Meaning is immutable; replacement has a new identity

Immutable meaning fields:
project_id, type, content, confidence, applicability/assumptions, source_refs,
validation attestation, promoted_by, and supersedes_memory_id.

Mutable metadata is limited to version, lifecycle status, attributable staleness
metadata, superseded_by_memory_id and timestamps.

Lifecycle:

```text
promotion → ACTIVE
ACTIVE → STALE
ACTIVE or STALE → SUPERSEDED, atomically with a new ACTIVE MemoryId
```

STALE never re-enters ACTIVE. Re-validation/re-promotion creates a new MemoryId
and supersedes the previous record. SUPERSEDED is terminal; no resurrection.

Supersession links old/new records atomically in the same Project and preserves
old content, source pins and attestation. The replacement must independently
pass promotion; it cannot inherit validation for changed meaning or sources.

A source's replacement does not itself create a replacement Memory:
it makes the dependent Memory unavailable/STALE. SUPERSEDED requires an actual
new Memory record. There is no physical pruning or deletion of Memory history
in this boundary. A human withdrawal without replacement records STALE with
reason; no new REVOKED state is introduced.

Rationale: conservative re-promotion is simpler to audit than restoring old
meaning in place, and does not pretend partial source repairs preserved a claim.

### 8. Decision authority is never increased by Memory

Memory retains the originating DecisionId, concrete pin and decider authority.
An ACTIVE HUMAN Decision remains Human direction even if a Control Plane
promotes its summary. Memory cannot supersede/revoke that Decision or change
its rationale. Confidence and retrieval position confer no additional authority.

Decision supersession/revocation excludes dependent Memory from current queries
immediately when observed, even before Memory reconciliation is persisted.
Replacement knowledge must cite the new ACTIVE Decision and be re-validated.

Staling Memory is not revoking its source Decision. Facts contradicting a
Decision's assumptions require appropriate control/human reconciliation;
Memory cannot silently overturn the directive.

### 9. Current-use queries are read-only and filter before ranking

Conceptual contract:

```text
required ProjectId
  → recorded status ACTIVE
  → all required source checks CURRENT
  → allowed type/confidence (INFERRED opt-in)
  → relevance ordering, if requested
  → result limit
```

A related but stale/unresolved record cannot enter results or consume topK.
Project selection is mandatory; no implicit global or cross-project fallback.

A simple deterministic relevance order is sufficient; ties use MemoryId.
Without relevance input, use deterministic MemoryId order.
No advanced ranking or search infrastructure is required.

Queries never promote, stale, supersede or update timestamps/events.
They compute current eligibility using one coherent control-store read snapshot
and trusted current reality observations. A recorded ACTIVE Memory can therefore
be currently unavailable. Historical/debug reads expose recorded status,
eligibility and reasons separately; no new durable status is invented.

History reads are explicitly by MemoryId or by ProjectId with requested lifecycle
statuses. They include original pins/meaning, lineage and reasons and are never
silently merged into current-use results.

Current-use results retain identity/version, type/confidence, source refs,
attestation and validity observation context. They are knowledge records, not
Context Capsules. Validity is guaranteed at the checked snapshot/observation,
not indefinitely after return; the contract does not claim an atomic transaction
with the external filesystem. Consumers requiring a later current-use claim must
re-query. Capsule assembly/freshness/expiry remain G7.4.

### 10. Minimal persistence, concurrency and replay

Persist a project-scoped Memory collection/table with:
MemoryId, positive optimistic version, project, immutable meaning/promotion
fields, status, staleness metadata, replacement links and timestamps.
Keep small structured validation facts with the immutable promoted record.
Large supporting artifacts remain external under existing Evidence references.

Append events for promotion, staling and supersession with actor/reason,
aggregate version and source/validation observation references.
State, event and existing store mutation-replay record commit together.
Replacement old/new rows and events commit or roll back together.

Updates require expected_version and backend compare-and-set. Failed validation,
source re-check or conflicts produce no partial Memory/state/event changes.
Promotion binds the exact validated input; sources are re-checked at the mutation
snapshot. External reality checks remain observation-bound as in §9.

Use the existing store mutation replay identity, not a new durable Command
execution lifecycle. An identical replay returns the existing operation result
without duplicate records/events, including after restart. Reusing the replay
identity for a different intent must fail closed. Replaying a past promotion
does not re-promote a now-STALE/SUPERSEDED record or assert current eligibility.

In-process MemoryStore and SQLite expose one shared semantic contract.
SQLite restart preserves meaning, lifecycle, attestation, lineage, events and
replay. Query-time eligibility is recomputed from current sources after restart,
not restored from a cached "valid" flag.
No event sourcing, production database selection or distributed locks are added.

## Alternatives considered

1. **Reuse V0.5 entries or planner decisions as authoritative Memory.**
   Rejected: runtime derivation, unknown provenance and in-place aggregation do
   not provide project identity, legitimate promotion or source currency.
2. **Treat existing sources/high confidence/main-agent boolean as validation.**
   Rejected: existence and self-report do not establish content fidelity or
   inference validity, and a boolean omits accountable validation provenance.
3. **Allow validated-but-unpromoted candidates in current queries.**
   Rejected: it erases the separate control-plane promotion boundary.
4. **Rank everything, then mark stale items or filter after topK.**
   Rejected: stale highly relevant entries can reach consumers or displace valid
   ones. Eligibility is a prerequisite, not a relevance penalty.
5. **Mutate lifecycle while reading; use TTL as the primary guard.**
   Rejected for the minimum: hidden writes complicate version/replay semantics,
   and elapsed time cannot prove source currency.
6. **Repair content/refs in place or restore STALE to ACTIVE.**
   Rejected: changed support/meaning should receive attributable new identity.
7. **Keep Memory usable when one of several sources fails.**
   Rejected for the minimum: without required/optional roles or claim-level
   dependency mapping, remaining sources may not support the complete claim.
8. **Automatically upgrade inference or manufacture new constraints.**
   Rejected: promotion does not create factual proof or project-direction authority.
9. **Implement general provenance graphs/external resolution.**
   Rejected: typed existing control references are sufficient for this boundary.

## External evidence

This is bounded implementation-backed research, not adoption of another framework.

### Agent Execution Harness — Learning Memory

Pinned source: `lordaeternus/agent-execution-harness`,
`401187291bf9e0cf5c91eaaedcf578912411b770`.

- [learning-memory.ts](https://github.com/lordaeternus/agent-execution-harness/blob/401187291bf9e0cf5c91eaaedcf578912411b770/src/core/learning-memory.ts):
  capture/validate/promote separation; file hashes and expiry; refresh/filter
  before ranking; attribution/event trail.
- [learning-memory.test.ts](https://github.com/lordaeternus/agent-execution-harness/blob/401187291bf9e0cf5c91eaaedcf578912411b770/tests/unit/learning-memory.test.ts):
  unvalidated promotion refused, missing files refused at validation,
  changed files excluded from queries.

Limits: query admits validated as well as promoted; confidence is caller supplied;
validation checks existence rather than semantic fidelity; authority actors are
not modeled by these functions; deleted files are skipped by hash refresh;
evidence refs are not hashed; queries write lifecycle and pruning can delete history.
Borrow phase separation and filter order, not these omissions.

### Agent Execution Harness — Codebase Memory

- [codebase-memory.ts](https://github.com/lordaeternus/agent-execution-harness/blob/401187291bf9e0cf5c91eaaedcf578912411b770/src/core/codebase-memory.ts):
  source_files/main-agent-check requirements for high-confidence/subagent records,
  update-time hashes and time-based freshness.
- [tests](https://github.com/lordaeternus/agent-execution-harness/blob/401187291bf9e0cf5c91eaaedcf578912411b770/tests/unit/codebase-memory.test.ts)
  enforce those requirements.

Limits: boolean attestation; query may return stale records and does not itself
recheck all hashes; records are overwritten. This supports explicit provenance
and a validation boundary, not an adequate authority/current-use protocol.

### Earthwalker Agent OS — scoped memory reconciliation

Pinned source: `earthwalker17/agent-os`,
`59833d3f436bd1fd842860af2aa1c081d4b20363`.

- [memory_reconciliation.py](https://github.com/earthwalker17/agent-os/blob/59833d3f436bd1fd842860af2aa1c081d4b20363/backend/execution/memory_reconciliation.py)
  separates model proposals from an allowed write surface and records per-run
  reconciliation outcomes.
- [memory_engine.py](https://github.com/earthwalker17/agent-os/blob/59833d3f436bd1fd842860af2aa1c081d4b20363/backend/memory_engine.py)
  implements allowed-file enforcement, section append/replace and deduplication.
- [tests](https://github.com/earthwalker17/agent-os/blob/59833d3f436bd1fd842860af2aa1c081d4b20363/backend/tests/test_memory_reconciliation.py)
  cover write filtering, duplicate-run handling and malformed judge responses.

Limits: no per-entry pinned source/lifecycle contract in these paths; section
replacement does not preserve a Memory supersession chain; project-file loading
does not filter entries by source validity. Borrow scope enforcement and
proposal/write separation, not direct model-summary promotion.

### W3C PROV — provenance is not truth

[PROV-DM](https://www.w3.org/TR/prov-dm/) distinguishes entities, activities,
responsibility, derivation, revision and invalidation.
[PROV Constraints](https://www.w3.org/TR/prov-constraints/) validates provenance
consistency, not the truth of a summary or inference.

Borrow attributable derivation and version/availability distinctions.
PROV neither assigns our Human/Control Plane authority nor specifies automatic
derived-Memory invalidation. We do not adopt its full representation/graph model.

External source/tests were read, not executed. The conservative all-required
dependency rule, confidence eligibility and no-resurrection choice are local
decisions constrained by the Blueprint, not claimed external consensus.

## Consequences

Benefits:
- promotion cannot conceal unvalidated runtime output;
- source identity/fidelity/inference are distinguished;
- stale relevance cannot bypass eligibility;
- changed knowledge remains attributable and historically inspectable;
- Decision and Acceptance authority remain unchanged.

Costs and risks:
- required-source invalidation is conservative and may suppress still-useful
  knowledge until explicit replacement;
- semantic fidelity is an attributable judgement, not an automatic truth proof;
- additional validation metadata and lifecycle events must remain durable;
- read-only queries may exclude a recorded ACTIVE record before reconciliation;
- external reality can change after observation; no perpetual validity is claimed;
- inferred lessons require explicit opt-in and cannot masquerade as verified facts;
- trusted caller/reviewer assignment remains an integration assumption, not a
  cryptographic identity guarantee.

Human acceptance must explicitly approve these tradeoffs and the confidence/type
matrix. They are candidate choices, not unspecified future semantics.

## Implementation boundary

Only after explicit acceptance of this ADR, G7.3's settled boundary becomes
**B — Missing Implementation**, subject to the repository's active ROADMAP gate:

- Memory vocabulary/record and immutable validation metadata;
- bounded candidate-validation and control-plane promotion operations;
- typed source resolvers over the four supported source families;
- current eligibility and explicit source-invalidity reconciliation;
- STALE and atomic new-id supersession;
- read-only current-use/history queries and simple deterministic ordering;
- shared-store/MemoryStore/SQLite parity;
- version/CAS, events, intent-bound mutation replay and restart tests.

PROPOSED status does not authorize any of those changes. This file alone neither
changes ROADMAP nor claims implementation/completion.

Non-goals:
- G7.4 Context Capsule generation, assembly, budgets, expiry or runtime injection;
- automatic LLM distillation or autonomous promotion pipelines;
- vector databases, embeddings or advanced ranking;
- legacy V0.5 Memory migration/refactoring;
- generic knowledge graphs or external-source resolvers;
- changes to Decision, Approval, Policy or Acceptance authority;
- Roadmap domain;
- distributed locks, leases/fencing or a new top-level architecture layer;
- durable candidate/proposal domain, Memory-to-Memory dependency graphs or pruning.

## Verification / exit criteria

Implementation is complete only when tests and recorded evidence prove:

1. Runtime/Agent can propose but cannot directly create ACTIVE Memory, self-assign
   reviewer authority, promote or alter lifecycle.
2. HUMAN/REVIEWER fidelity attestations and exact deterministic Control Plane
   validation are distinguished; free-form control self-validation is rejected.
3. Candidate fingerprint, attestation result and all immutable fields match;
   changing content/refs/confidence after validation prevents promotion.
4. Every type obeys the declared meaning/confidence matrix; invented Decisions
   or constraints and unsupported VERIFIED/ACCEPTED labels are refused.
5. Missing, unpinned, unsupported and cross-project refs fail closed.
6. Accepted-state sources require their own current contract/proof; Candidate
   Evidence is not upgraded by Memory; verdict/claim mismatch is rejected.
7. Any required source invalidity suppresses a multi-source Memory, including
   source deletion, pin change, stale Evidence and terminal Decision.
8. UNRESOLVED observations suppress current use without claiming falsity or
   automatically changing recorded lifecycle.
9. No unrelated-file change or mere elapsed time invents source invalidity.
10. Source validity is rechecked at promotion and query; changed sources cannot
    pass using only a previously valid attestation or stored ACTIVE flag.
11. HUMAN/CONTROL_PLANE staling is attributable; STALE never returns to ACTIVE;
    SUPERSEDED is terminal.
12. Replacement requires new MemoryId, valid independent attestation and the
    same Project; old/new links, events and state commit/roll back atomically.
13. Meaning/provenance/validation are immutable and historical content remains
    readable after source invalidation and replacement.
14. Source Decision supersession/revocation immediately removes dependent Memory
    from current use without modifying/upgrading Decision authority.
15. Queries enforce project/lifecycle/source eligibility before ranking/limit;
    a highly relevant invalid record cannot displace an eligible one.
16. INFERRED is excluded by default and remains explicitly labeled when opted in;
    history results never leak into current-use queries.
17. Reads produce no state, timestamp or event writes; unavailable recorded-ACTIVE
    records expose accurate reasons in explicit history/debug results.
18. Stale expected_version conflicts; concurrent replacements cannot both win.
19. Identical mutation replay produces no duplicate records/events; different
    intent under the same replay identity is refused; replay does not resurrect.
20. The same behavioral suite passes on MemoryStore and SQLite.
21. A real process restart preserves content, attestation, lifecycle, lineage,
    events and replay, and recomputes eligibility against changed sources.
22. Existing Decision/Approval/Policy/Acceptance and legacy Runtime behavior
    remain intact; full Node 22 CI passes with zero skips.
23. Implementation Evidence documents supported boundaries and observation
    limitations before G7.3 is marked complete; G7.4 remains separately gated.
