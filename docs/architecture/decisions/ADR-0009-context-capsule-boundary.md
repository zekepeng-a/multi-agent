# ADR-0009 — Context Capsule generation, delivery and recovery boundary

**Status:** PROPOSED  
**Date:** 2026-09-30  
**Roadmap phase:** G7.4 — Context Capsule / independent D-GATE  
**Related invariants:** I-01..I-03, I-06, I-08..I-10, I-14, I-20..I-24, I-27..I-31, I-33..I-35, I-38..I-45

## Context

Baseline: `project-control/controller-v0.1` at
`b6fc9411c00297f0faba9439bbfde781d2931e6e`.
G7.1 Project Acceptance, G7.2 Decision and G7.3 Project-control Memory are COMPLETE.
G7.4 remains D — Architectural Gap. This proposal does not accept itself, change
ROADMAP or authorize implementation execution.

Blueprint §12 defines bounded task-relevant execution context. Canonical §5.14
names ContextCapsuleId and conceptual references, but explicitly leaves generation,
freshness, expiry and reference semantics unresolved. Its proposed authority matrix
is not an accepted Capsule lifecycle. ADR-0004 supplies a Runtime Adapter input
seam; ADR-0008 supplies current-use Memory, not Capsule assembly.

At this baseline, Controller.runtimeContextFactory returns an arbitrary object.
LocalProcess and DSH Workflow adapters interpret it as launch configuration;
DSH may also require a live parent Agent. There is no Capsule collection,
immutable input archive, freshness gate, budget contract or delivery receipt.
A parameter named contextCapsule does not prove these semantics exist.

Three concrete failures motivate this boundary:

1. Selected sources change between generation and dispatch.
2. After restart, current regeneration is mistaken for a historical Attempt's input.
3. Budget reduction silently removes a necessary contract, constraint or permission.

The proposal refines the Blueprint using ADR-0004, ADR-0005 Workspace,
ADR-0003 Policy/Approval, ADR-0007 Decision, ADR-0008 Memory and the Persistence
Boundary. It changes none of their authority or acceptance semantics.

## Decision

All rules below are proposed choices requiring Human acceptance.

### 1. Nature and ownership

A Context Capsule is a derived, bounded execution input assembled by the trusted
Control Plane for one Task execution Attempt. It is not Project State, a source
object replacement, an Acceptance result or a permission token.

Its formal snapshot is immutable from generation: payload, manifest, pins,
assembler version, generation observations and execution binding cannot be edited.
Freshness and delivery observations are recorded separately; they never rewrite
the snapshot. Regeneration creates a new ContextCapsuleId.

The Control Plane selects and validates content. Runtime/Agent output can propose
context but cannot issue an authoritative snapshot or classify its own content as
required. This uses the existing trusted composition boundary; no new identity,
authentication, Reviewer-role or top-level architectural system is introduced.

Current Reality, Evidence, Acceptance, Decision, Memory, Policy and Approval retain
their original authority. Neither inclusion, omission, formatting, rank nor a
Capsule hash changes that authority. Contradictions are exposed to the appropriate
existing control/human boundary, not resolved by promoting a weaker source.

### 2. Identity and execution binding

Use an independent ContextCapsuleId. Every snapshot binds:

```text
ProjectId → TaskId → RunId → AttemptId → ContextCapsuleId
```

Control validates the existing ownership relationships, Task's pinned Acceptance
id/version, Run's Task and Attempt's Run. CapsuleId never substitutes for those IDs.
Goal/Milestone references, when included, must belong to that same project/hierarchy.

One Capsule belongs to exactly one Attempt; it cannot be reused by another Attempt,
even if the visible task text is identical. This avoids transferring historical
observations, permissions and receipt evidence to a new execution. A new Attempt
requires fresh assembly and a new CapsuleId.

An Attempt may have multiple generated snapshots before dispatch, but at most one
logical dispatch binding. Earlier un-dispatched snapshots remain history. Once a
dispatch reservation exists, no different Capsule may be substituted for it.
An uncertain dispatch is reconciled, never replaced by another input on that
Attempt. Confirmed non-receipt terminates that Attempt; any subsequent execution
uses a new Attempt or Run according to the existing recovery rules.

Do not store only Run.currentContext or overwrite a previous Attempt's input.

### 3. Exact snapshot and integrity

Persist the complete finite-JSON Capsule payload handed to RuntimeAdapter.start,
including required and selected supplemental content, source manifest and pins,
project/task/run/attempt binding, schema/assembler/profile versions, generated_at,
generation observation refs/times, explicit Memory inference policy and budget.

The same canonical serialized UTF-8 payload is archived, measured and hashed
before it is deserialized into a detached copy for the adapter. Canonical JSON
uses deterministic key ordering and fixed serialization rules; non-JSON values,
live objects and ambiguous/non-finite values are refused. SHA-256 covers those
exact archived bytes. The hash is metadata outside its own hashed payload.

V1 stores these bounded bytes inline in the Control Store. An immutable external
artifact ref plus hash is a permitted future representation under the existing
artifact boundary, not a second meaning: the complete bytes must remain available
and integrity checked. V1 does not require a new artifact provider. Large source
logs/artifacts remain external; only the selected bounded input is included.

Source IDs, a current regenerated prompt or a manifest without the delivered
payload cannot substitute for historical input. A missing/corrupt payload is an
explicit history/integrity failure and forbids dispatch; do not silently rebuild
it under the old CapsuleId. Payload integrity proves content identity, not receipt
or semantic truth.

### 4. Closed source structure and preserved semantics

Every selected source has a typed reference, source ID, proven project ownership
or trusted runtime/policy binding to this execution, exact pin, role
REQUIRED/SUPPLEMENTAL, use scope, original authority/provenance and validity
observation with observer/ref/time and concrete result/reasons.

Use real versions/revisions/fingerprints, not an invented common integer version.
Retain the authoritative source references behind a rendering; prose alone is
insufficient. The manifest distinguishes a reference used as execution context
from a supporting proof. Capsule references do not expand Memory.source_refs.

| Source family | Pin and retained information | Admission/current-use rule |
|---|---|---|
| Task / Goal / Milestone / Project State | Target type/id, project, exact control version, hierarchy, objective/status, relevant contract and proof refs | Current authoritative object. A status is not contract-bound Acceptance. Include only the relevant bounded hierarchy. |
| Acceptance Contract | AcceptanceId/version, target type/id, exact execution criteria and restrictions | Task uses its own pinned revision, not the latest contract. Applicable parent pins retain their own targets. A new unbound contract revision alone does not replace a valid pin. |
| Decision / Constraint | DecisionId/version, decider authority, original provenance, explicit applicable direction/constraint | ACTIVE Decision under ADR-0007. Rendering cannot invent direction or re-verify arbitrary original external refs. |
| Project-control Memory | MemoryId/version, type/confidence, applicability/assumptions, source pins, attestation, validity observations | Only ADR-0008 current-use eligible records; retain all necessary support and inference labels. |
| Evidence / Verification | IDs, immutable meaning fingerprint, target/contract pins, revision, evidence links, verdict/status, artifact and Workspace lineage | Reuse existing proof/currentness checks. CANDIDATE remains candidate; PASS/ACCEPTED alone is not current proof. Evidence statuses remain CANDIDATE/VERIFIED/ACCEPTED/STALE/SUPERSEDED. |
| Workspace / Reality | WorkspaceId/control version, owner, kind/access, enforced write scopes, parent/base/current reality revision, integration state, independent observation pin/time | Re-observe required reality. Workspace.version is not filesystem revision; isolated output is not shared accepted reality. No write authority is manufactured by context. |
| Policy / Approval | Policy configuration version/fingerprint and trusted provenance; PolicyDecisionId when relevant; ApprovalId/version, target/version/action/capability/scope, attribution/status/expiry | Context describes restrictions and observed permissions. Actual action authorization still evaluates current Policy and usable Approval through existing gates; DENY cannot be overridden. |
| Runtime capability/context | Adapter identity, capability/configuration fingerprint, trusted observation/time, bounded execution restrictions and relevant runtime refs | Bound to the selected adapter/execution, not a new project-owned Runtime object. Capability is not Permission. Secrets and live handles are excluded. |

All internal sources must resolve to the same Project. Policy/runtime configuration
may be shared infrastructure but must be explicitly bound by trusted composition
to this execution; it does not receive fictitious project ownership. No global
source fallback or runtime-supplied ownership assertion is accepted.

V1 uses exact pins for included mutable control objects, including PROJECT_STATE;
any pinned version mismatch requires a new snapshot. Acceptance checks compare the
target's binding to the selected revision, not the contract's latest revision.
Immutable Evidence/Verification use meaning fingerprints plus separate currentness
checks. External observations use actual scope/revision/time. No semantic field-diff
exception, automatic rebinding or universal external parser is introduced.

Explicit historical Evidence/Verification excerpts may be supplemental background
only: retain original pin, time, status and historical label; verify availability
and integrity, and assert no current proof or authority. They are never required
current dependencies. Historical/debug Memory and inactive Decision directives
are not admitted to current execution. Other current-use entries must satisfy
their existing current validity rules.

### 5. Required content and selection completeness

The trusted, versioned assembler profile determines necessity before relevance
ranking or budget allocation. Required content includes:

- Task/execution identity and objective;
- the Task's pinned Acceptance Contract, including exact criteria;
- applicable ACTIVE Decision directions and explicit constraints;
- Workspace access, isolation, enforced write scope and relevant reality pins;
- mandatory Policy/Approval restrictions, including permission limits/expiry;
- Runtime execution restrictions, forbidden actions and required capabilities;
- any other selected source without which this execution cannot be understood or
  safely scoped, including Memory/Evidence when genuinely necessary.

V1 applies all project ACTIVE Decisions by default; a narrower applicability rule
must be explicit, deterministic and versioned in the trusted assembler profile.
Runtime/model relevance cannot declare a directive inapplicable. Conflicting
required directions block assembly until the existing authority resolves them.

Record selection checkpoints sufficient to detect newly applicable constraints,
not only versions of already selected rows: the applicable Decision membership
and pins, target/hierarchy/contract bindings, policy configuration and mandatory
restriction set, Workspace scope and required Runtime capabilities. Recompute them
before dispatch. A new required Decision cannot slip through because it was absent
from the old manifest. No new provenance graph or subscriptions subsystem is needed.

Supplemental content may include current eligible Memory, additional Evidence,
explicit historical background and nonessential explanation. A necessary source
cannot be demoted to supplemental to fit the budget. Every rendered item retains
its role and original authority. Never silently delete required content by rank.

### 6. Budget and deterministic trimming

V1 budget is an explicit positive maximum of final canonical JSON UTF-8 bytes.
It includes the whole Capsule envelope, content, manifest, pins, labels and
observation metadata. It is not a sample-prompt limit or an assertion about model
token capacity. The trusted profile must choose a limit the selected adapter can
accept; an adapter may enforce a stricter capacity and refuse before execution.

Required input is measured with its complete envelope first. If it cannot fit,
or required completeness/capacity cannot be established, fail closed before
dispatch. Persist no success/receipt for a rejected input.

Supplemental candidates are eligible before ordering. Use explicit profile
priority, then simple deterministic relevance if configured, then typed source
identity as a stable tie-breaker. Add whole items only when the resulting complete
serialized payload fits. Record a bounded selection/trimming summary and profile
version; do not turn omission history into an unbounded payload.

Do not truncate required text, automatically summarize it, substitute a path for
its required content, or weaken restrictions to meet the limit. Inline the required
execution meaning; artifact paths are for non-required large supporting material,
not a bypass. No LLM compressor, advanced token optimizer, embedding or ranking
infrastructure is part of this choice.

### 7. Freshness and regeneration

After generation and immediately before reserving/starting dispatch, Control
revalidates binding, selection checkpoints, all required pins and source validity,
and the integrity/budget of the archived payload. Store facts use a consistent
read snapshot and are rechecked in the transaction that reserves dispatch.
External Reality/capability/policy observations are separately trusted and pinned
with times. No database/filesystem/external-world atomic snapshot is claimed.

Necessary invalidity or inability to confirm a required dependency refuses dispatch.
For Memory, CURRENT/INVALID/UNRESOLVED retain ADR-0008 semantics. Current checks do
not mutate source records or silently perform Memory promotion/staling.

Included supplemental content is also rechecked. For current-use items, a pin or
eligibility drift refuses that old snapshot; regenerate a new Capsule and omit or
refresh supplemental items under the same deterministic rules. Unavailable
supplemental candidates may be omitted during new assembly. Historical excerpts
check their pinned integrity/availability and their explicit historical labeling,
not a fabricated assertion that past evidence is currently applicable.

There is no in-place partial refresh and no delivery of a known-invalid supplemental
item with a warning. An unrelated, unselected supplemental source change alone does
not invalidate a snapshot, unless it changes a required selection checkpoint.

No fixed Capsule TTL is required in v1: source pins and consumption checks are the
guard. Time-sensitive Approval expiry is still checked by its own rules. Freshness
is a recorded observation, not a guarantee against later external changes or a
permission valid for the whole execution. Subsequent actions continue through
existing current authorization/Reality/Acceptance boundaries.

Any changed content, pins, binding, selection policy or budget produces a new
CapsuleId. Historical read never constitutes current-use validation or dispatch.

### 8. Memory and authority preservation

Use project-scoped ADR-0008 current-use queries: ACTIVE, every necessary source
CURRENT, allowed type/confidence, then relevance/limit. INFERRED is excluded by
default. Only trusted assembler configuration may explicitly opt in; persist that
choice and retain confidence, scope and assumptions in the payload.

Freshness repeats current-use checks for included Memory. Never use history/debug
queries as a fallback, resurrect STALE, rebind PROJECT_STATE versions, promote a
candidate or omit necessary Memory support. If necessary support exceeds budget,
fail closed rather than strip it. Selection does not increase Memory, Decision or
Evidence authority; Memory ACCEPTED remains distinct from project Acceptance.

### 9. Runtime boundary and receipt

The semantic delivery boundary is RuntimeAdapter acceptance of the Capsule input,
not the Runtime's final model prompt/token sequence. Separate Capsule finite-JSON
content from launch configuration, credentials, session state and live handles.
Launch configuration remains a distinct adapter input; its relevant bounded
restrictions/configuration pin appear in the Capsule manifest. No live DSH parent
or process handle is serialized as Capsule content.

Adapters receive a detached payload copy. They may build internal context but
cannot mutate the Control Store snapshot, replace its pins or write accepted
Project State, authoritative Decision or promoted Memory. Outputs follow existing
candidate Evidence/verification/control paths.

For G7.4-controlled dispatch, start request carries CapsuleId/hash and the exact
Project/Task/Run/Attempt binding. A trusted adapter returns a receipt containing
that binding, accepted payload hash, RuntimeRef and receipt time only after its
execution-input boundary accepts that exact payload. A runtime/model role string
or final message is not a receipt. A RuntimeRef alone does not prove which Capsule
was accepted. Receipt is not execution completion or Acceptance.

The controller validates the receipt against the reserved dispatch; mismatches,
missing receipts or ambiguous failures are not confirmed delivery. Adapters must
implement this bounded G7.4 input contract before they can use this path; unrelated
legacy Runtime calls are not silently claimed to satisfy it.

### 10. Delivery facts and uncertainty on the existing Attempt

Store small delivery metadata on the existing Attempt, with append-oriented events,
not a new Effect domain/subsystem. The record has at most one immutable logical
dispatch key and CapsuleId/hash binding. Observations distinguish:

| Delivery observation | Meaning |
|---|---|
| PREPARED | Capsule persisted; no dispatch reservation. No receipt claim. |
| DISPATCHING | Freshness-passed dispatch intent reserved durably before start. The call may or may not have happened; this state does not prove invocation or receipt. |
| RECEIVED | A matching trusted adapter receipt was durably recorded. |
| NOT_RECEIVED | Trusted evidence establishes input was refused/not started, not merely absence of a receipt. |
| UNKNOWN | The reserved call/receipt outcome cannot be established. No retry or input replacement is authorized. |

These are Attempt delivery observations, separate from Attempt execution status
and immutable Capsule content. Store them through the trusted controller only.
Observed call return/failure facts record invocation evidence when available;
the pre-call reservation is only intent. Do not infer receipt from persistence,
RUNNING status, a start timeout, RuntimeRef or a proposed dispatch event.

An ambiguous start, lost response, receipt mismatch, or crash after reservation
leaves UNKNOWN (an unfinished DISPATCHING is treated as UNKNOWN after restart).
Reuse Run BLOCKED / Attempt LOST and existing capability-gated observation /
reconciliation for uncertain execution. This is conservative even if no process
actually started. Missing capabilities leave it blocked; no blind replay of start.

Reconciliation may append a matching receipt, explicit confirmed non-receipt, or
existing confirmed execution result with legitimate identity/lineage. Execution
completion without input-identity proof does not fabricate a Capsule receipt.
UNKNOWN may become RECEIVED/NOT_RECEIVED only from trusted evidence; contradictory
terminal observations fail closed. RECEIVED/NOT_RECEIVED cannot be rewritten to a
different delivery. Existing outcome recovery/Acceptance rules remain in force.

Definite pre-call validation failure performs no dispatch. Explicit trusted adapter
refusal before external execution records NOT_RECEIVED and ends the Attempt as
FAILED. Uncertain failure is not definite refusal. Regeneration never repairs
missing evidence about a past invocation.

### 11. Persistence, concurrency, restart and replay

V1 persists an immutable Capsule collection plus small Attempt delivery metadata,
source manifests/observations, dispatch/receipt facts and events. Share the domain
rules across MemoryStore and SQLite. Run/Attempt remain execution control objects;
Capsule records remain derived input history, not a new Project authority.

Use existing direct transactional mutations plus append-only events and mutation
replay identities, not event sourcing or a new durable Command lifecycle.
Snapshot creation, replay entry and creation event commit together. Dispatch
reservation binds the selected snapshot and expected current Task/Run/Attempt
state with compare-and-set; binding, event and replay entry commit together.
Receipt/recovery writes use expected versions or an equivalent backend CAS on
Attempt delivery state; parity includes independent SQLite-writer competition.

Identical replay returns the recorded result without another Capsule/event/logical
dispatch. Reusing an identity for different content, pins, Attempt or intent is
rejected. Regeneration is a new explicit operation with a new CapsuleId, even when
rendered text happens to match. Replay does not recheck itself into permission to
start externally again. A second dispatcher losing reservation never calls start.

Keep database mutation replay separate from actual external delivery. Reserving
once and invoking outside the transaction cannot guarantee atomic or exactly-once
external execution. The crash window is handled by durable uncertainty and existing
reconciliation, not by inventing idempotency support in a Runtime.

Restart restores exact payload/hash, manifest, generation facts, Attempt binding,
observations, receipt/uncertainty, events and replay. It does not rebuild an old
snapshot from current sources or restore cached freshness as current validity.
All historical snapshots remain explicitly readable. An un-dispatched snapshot
may be checked for its original Attempt; old dispatched snapshots are history and
cannot be directly executed again. New Attempts always obtain new identity/input.

## Alternatives considered

1. **Ephemeral context or source IDs only.** Rejected: restart cannot establish
   actual historical input, rendering, selection or restrictions.
2. **Keep Run.currentContext and overwrite it.** Rejected: erases Attempt input
   lineage and lets regenerated context impersonate the past.
3. **Share CapsuleId across Attempts.** Rejected for v1: mixes consumption checks,
   permissions and receipt attribution; regeneration is cheap at bounded scale.
4. **Use TTL or output CAS instead of pre-dispatch freshness.** Rejected: time
   and safe output commits do not stop execution on known stale input.
5. **Locally refresh the persisted Capsule.** Rejected: changes the input behind
   its historical identity/hash. Generate another snapshot instead.
6. **Deliver drifting supplemental content with a stale label.** Rejected for v1:
   avoid a second current-use exception. Explicit historical excerpts have a
   separate historical meaning; stale Memory never becomes such an exception.
7. **Truncate/summarize required context.** Rejected: budget pressure is not
   permission to weaken a contract, directive, workspace or execution restriction.
8. **Treat persisted/start intent as receipt; retry on missing receipt.** Rejected:
   external invocation and store commits are different boundaries. Preserve unknown.
9. **New dispatch ledger, leases/fencing or universal provenance graph.** Rejected:
   existing Run/Attempt recovery plus small delivery observations suffice here.
10. **Archive every source artifact or final model tokens.** Rejected: archive the
    bounded adapter input; large source artifacts and Runtime internals retain
    their existing boundaries.

## External evidence

Bounded source/tests were read, not executed. These mechanisms are precedent, not
dependencies or evidence that another system implements this entire protocol.

### AgentLedger

Pinned commit: `dd966e3b3d9eb54032c51701d30efcfbaa2379b0`.

- [runtime.py](https://github.com/yaogdu/AgentLedger/blob/dd966e3b3d9eb54032c51701d30efcfbaa2379b0/src/agentledger/runtime.py#L120)
  reads state/version before execution; [store.py](https://github.com/yaogdu/AgentLedger/blob/dd966e3b3d9eb54032c51701d30efcfbaa2379b0/src/agentledger/store.py#L342)
  checks base_version at commit. Borrow pins/CAS, not a claim of pre-dispatch freshness
  and not its leases.
- [context.py](https://github.com/yaogdu/AgentLedger/blob/dd966e3b3d9eb54032c51701d30efcfbaa2379b0/src/agentledger/context.py#L37)
  archives request/response JSON with refs/hashes;
  [blobstore.py](https://github.com/yaogdu/AgentLedger/blob/dd966e3b3d9eb54032c51701d30efcfbaa2379b0/src/agentledger/blobstore.py)
  uses content-addressed JSON. Borrow actual input retention, not an independently
  proven delivery receipt or exact wire bytes.
- [cost.py](https://github.com/yaogdu/AgentLedger/blob/dd966e3b3d9eb54032c51701d30efcfbaa2379b0/src/agentledger/cost.py#L28)
  rejects budget overflow. [tests](https://github.com/yaogdu/AgentLedger/blob/dd966e3b3d9eb54032c51701d30efcfbaa2379b0/tests/test_runtime.py#L1162)
  prove the extra tool call is blocked; model evidence tests cover request/response
  inspection. Its cumulative usage budget is not required-context allocation.

### Agent Harness — prepared contract and worker artifacts

Pinned commit: `0c30ff12476898543246912a3d49d653ae86b874`.

- [preparation](https://github.com/0xenzyme/agent-harness/blob/0c30ff12476898543246912a3d49d653ae86b874/plugins/agent-harness/scripts/agent-harness.mjs#L6290)
  saves prompts, manifest and DAG. [contract checking](https://github.com/0xenzyme/agent-harness/blob/0c30ff12476898543246912a3d49d653ae86b874/plugins/agent-harness/scripts/agent-harness.mjs#L5813)
  compares current contract/DAG against pins and requires a new Run on drift.
- [regressions](https://github.com/0xenzyme/agent-harness/blob/0c30ff12476898543246912a3d49d653ae86b874/tests/regressions.mjs#L220)
  cover stale checkpoint rejection, prohibited restart, contract drift and replacement.
- [worker contract](https://github.com/0xenzyme/agent-harness/blob/0c30ff12476898543246912a3d49d653ae86b874/plugins/agent-harness/references/worker-runner-contract.md)
  separates host launch from accepted-state ownership. Prompt construction preserves
  ownership/stop rules but has no required-context capacity guard; manifest pins
  do not prove every referenced input or actual worker receipt. Borrow drift refusal
  and structured boundaries, not these missing guarantees.

### Agent Execution Harness — handoff and run artifacts

Pinned commit: `401187291bf9e0cf5c91eaaedcf578912411b770`.

- [handoff](https://github.com/lordaeternus/agent-execution-harness/blob/401187291bf9e0cf5c91eaaedcf578912411b770/src/core/handoff.ts)
  builds allowed files/commands, forbidden actions and blocked conditions;
  [CLI](https://github.com/lordaeternus/agent-execution-harness/blob/401187291bf9e0cf5c91eaaedcf578912411b770/src/cli/handoff.ts)
  outputs the prompt rather than persisting actual delivery.
- [artifact store](https://github.com/lordaeternus/agent-execution-harness/blob/401187291bf9e0cf5c91eaaedcf578912411b770/src/core/artifact-store.ts)
  keeps full/current Run views but overwrites them; not immutable per-Attempt input.
- [handoff tests](https://github.com/lordaeternus/agent-execution-harness/blob/401187291bf9e0cf5c91eaaedcf578912411b770/tests/unit/handoff.test.ts#L39)
  bound a sample prompt; [budget script](https://github.com/lordaeternus/agent-execution-harness/blob/401187291bf9e0cf5c91eaaedcf578912411b770/scripts/token-budget.mjs)
  checks template/benchmark sizes. Neither proves arbitrary required input fits.
  Borrow structured restrictions and compact/full separation; add our own runtime
  budget/freshness/snapshot guarantees.

Single-Attempt identity, byte budget, all-required completeness, supplemental
regeneration and receipt matching are local conservative choices. Research does
not determine our authority rules or prove cross-boundary atomicity.

## Consequences

- Historical inputs are inspectable after restart without pretending they remain
  usable or accepted. Delivery and preparation become distinguishable.
- Known drift and excessive required context stop execution instead of becoming
  implicit risk accepted by a model.
- Conservative exact pins and project-wide Decision applicability can regenerate
  often or block on conflicting directions. This cost is intentional in v1.
- Inline bounded archives consume storage; no history deletion/retention subsystem
  is introduced here. Source artifacts still require their existing availability.
- All G7.4 adapters need receipt-aware input acceptance; opaque legacy start
  success alone cannot prove delivery of a particular snapshot.
- A crash before/after start may block even when nothing happened. Recovery must
  establish facts; missing observation capability reduces availability, not safety.
- Byte budgets are portable and testable, but do not prove final model token fit.
  No final-token guarantee or stronger authorization is claimed.

The proposal preserves I-01..I-45 and five-layer authority. Its use of Attempt
metadata, CAS and events refines recovery/persistence without distributed locks,
new principals or a new top-level layer.

## Implementation boundary

Only after explicit Human acceptance and authorized governance synchronization,
the bounded G7.4 gap can become B — Missing Implementation:

- Capsule vocabulary, immutable finite-JSON snapshot and independent identity;
- typed source manifest, trusted assembler/profile and required/supplemental rules;
- reuse of Decision, Memory, Acceptance, Workspace and authorization checks;
- deterministic UTF-8 budget allocation and exact payload/hash archive;
- dispatch freshness/selection checks and original-Attempt binding;
- small Attempt reservation/receipt/unknown observations, CAS, events and replay;
- bounded receipt-aware integration of the existing Runtime Adapter seams;
- shared backend contract, true restart and independent-writer proof;
- separate history reads and the exit tests below.

Acceptance of architecture is not completion evidence or automatic permission to
start implementation; implementation execution requires the repository's phase
rules and explicit task authorization. This PROPOSED file advances neither gate.

Non-goals:

- G7.5 Roadmap domain, G7.6 observability platform or automatic phase advancement;
- automatic LLM summary/distillation/promotion or autonomous regeneration loops;
- vector databases, embeddings, advanced ranking or token optimization;
- general provenance/claim graphs or universal external source resolvers;
- legacy V0.5 context/Memory migration;
- new authentication, role/Reviewer registry or identity system;
- a new Runtime/session architecture, provider routing or live-handle persistence;
- leases/fencing, distributed locks or a new large Effect/dispatch subsystem;
- proving Runtime's final model token sequence or preventing all internal transforms;
- turning Capsule into execution success, Acceptance or permanent authorization;
- changing Decision/Memory/Acceptance/Policy/Approval authority or source semantics;
- event sourcing, production storage selection or history pruning.

## Verification / exit criteria

Implementation may claim the bounded G7.4 exit only when tests and Evidence prove:

1. Independent CapsuleId and valid Project/Task/Run/Attempt ownership; cross-project
   and mismatched hierarchy/runtime bindings are rejected.
2. Wrong Task contract id/version/target is refused; a newer unbound revision is
   not silently substituted for the Task's pin.
3. Every source preserves identity, real pin, scope, authority/provenance and
   observation; unsupported/unresolved required sources fail closed.
4. Required row/pin/reality drift between generation and dispatch prevents start.
5. Newly applicable Decision/restriction membership prevents stale dispatch;
   current checks cover selection completeness, not just selected IDs.
6. Store consistent reads and separate external observations retain pins/times
   without claiming database/filesystem atomicity or future currency.
7. Included supplemental drift refuses the old snapshot; regeneration has a new
   ID and may omit/refetch supplemental items without changing required content.
8. Deterministic ordering/trimming affects whole supplemental items only; required
   meaning, contracts and restrictions survive relevance and budget pressure.
9. Final UTF-8 serialization, non-ASCII content and structural overhead are measured;
   required-over-budget/completeness failure invokes no Runtime and creates no receipt.
10. Truncation, summary/path substitution and demotion cannot bypass required limits.
11. Memory consumes only ADR-0008 current-use results, with INFERRED default excluded
    and trusted explicit opt-in recorded; history/debug never enters current input.
12. Historical Evidence labels do not become current proof; stale Memory and inactive
    Decision directives have no historical-context escape into current execution.
13. Exact archived payload bytes/hash equal the input at the adapter boundary;
    source IDs/current regeneration alone cannot stand in for delivered input.
14. Runtime mutation of a detached copy leaves the formal snapshot unchanged;
    live handles/secrets/session data are outside Capsule serialization.
15. Receipt validates CapsuleId/hash and full execution binding plus RuntimeRef;
    a mismatch, RuntimeRef alone or a worker message cannot establish receipt.
16. PREPARED/persisted and DISPATCHING/reserved are not RECEIVED; validation failure
    produces no call, and explicit refusal differs from ambiguous start failure.
17. Lost responses and crash windows preserve UNKNOWN/blocked recovery and forbid
    blind start replay or Capsule substitution on the Attempt.
18. Reconciliation appends attributable receipt/non-receipt facts; completion without
    input proof cannot fabricate receipt, and terminal delivery facts are not rewritten.
19. A Capsule cannot be reused by another Attempt; dispatched historical snapshots
    are readable but cannot be directly re-executed. Fresh original-Attempt validation
    is required for any still-un-dispatched input.
20. Snapshot/binding/event/replay transactions roll back together; stale writers and
    competing SQLite reservations cannot produce two logical dispatches/calls.
21. Replay is intent-bound, produces no duplicate records/events, and never means
    permission to repeat an external start.
22. True process restart restores exact payload/hash, manifest, Capsule/Attempt
    binding, receipt/UNKNOWN, history and replay; missing/corrupt payload fails closed
    rather than being regenerated under its historical ID.
23. MemoryStore/SQLite parity covers all applicable semantics, including CAS,
    rollback/replay and independent persistent writers.
24. Existing Decision, Memory, Acceptance, Policy, Approval, Workspace, Runtime and
    legacy-runtime regression checks retain their authority/lifecycle semantics.
25. Full Node 22 CI passes, and implementation Evidence maps these criteria to
    tests. Independent review and a separately authorized ROADMAP update are still
    required before G7.4 may be marked COMPLETE; G7.5 is not advanced.
