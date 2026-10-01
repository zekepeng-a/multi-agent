# ROADMAP.md

**Status:** ACTIVE GOVERNANCE ROADMAP  
**Applies to:** `project-control/controller-v0.1` and successor Project Control work  
**Roadmap authority:** this file defines the current development boundary. A DSH/GPT report may propose evidence or findings, but it does not create a new roadmap phase by itself.

## 1. Purpose

This roadmap converts:

```text
PROJECT_BLUEPRINT
        +
canonical architecture
        +
current reality
        ↓
ordered project work
```

It exists specifically to prevent development from becoming:

```text
one agent report
   ↓
one new fix prompt
   ↓
one new report
   ↓
another locally chosen boundary
```

The project boundary is defined here in Git, ahead of individual agent runs.

## 2. Governing loop

Every roadmap item follows the same control loop:

```text
Observe current reality
  ↓
Compare against Blueprint + canonical architecture
  ↓
Identify one bounded gap
  ↓
Classify A / B / C / D / E
  ↓
Research + ADR first if D
Human decision first if E
  ↓
Implement
  ↓
Tests / Git / runtime evidence
  ↓
Independent review
  ↓
Update PROJECT_ARCHITECTURE / ROADMAP / CHANGELOG as needed
```

A task is not complete because DSH says it is complete.

## 3. Change classes

### A — Implementation Bug

Code violates an already-settled invariant/design.

**May proceed directly to fix**, with regression proof.

### B — Missing Implementation

Architecture already settles the meaning, authority boundary and failure semantics; code is simply absent.

**May proceed to implementation** inside the active roadmap phase.

### C — Architectural Conflict

Two authoritative/current pieces contradict each other.

**Resolve against Blueprint/invariants first.** Record meaningful resolution.

### D — Architectural Gap

Required behavior lacks a settled authority boundary, state machine, persistence meaning, recovery rule, concurrency rule or external-effect semantics.

**Stop coding.** Perform focused external research and record the decision in an ADR before implementation.

### E — Direction Change

Would alter project identity, core authority model, top-level layering or long-term product direction.

**Human decision required.**

## 4. Global stop rules

These rules apply to every phase:

1. Do not add a new top-level subsystem merely for architectural completeness.
2. Do not reopen broad GitHub archaeology unless a concrete D-class gap requires it.
3. Do not treat a runtime-native feature as Project Control authority.
4. Do not implement a half-domain that makes an unsupported concept look supported.
5. Do not retry an UNKNOWN external effect without reconciliation.
6. Do not let an Agent/runtime directly manufacture accepted Project State.
7. Do not change a frozen invariant inside an implementation task.
8. Do not let a DSH/GPT report advance the phase boundary by itself.
9. Do not merge PR #1 merely because governance documents exist; merge readiness is a separate project decision.
10. When a phase exposes a new D or E issue, stop that thread at the issue rather than designing the rest from imagination.

## 5. Phase map

```text
G0  Governance convergence
 ↓
G1  Baseline hardening / reproducibility
 ↓
G2  Command boundary
 ↓
G3  External Effect + reconciliation boundary
 ↓
G4  Policy / authorization composition
 ↓
G5  Real runtime adapter boundary
 ↓
G6  Workspace / reality / concurrency boundary
 ↓
G7  Long-horizon Project Control objects
 ↓
G8  End-to-end dogfood + release convergence
```

This is a dependency order, not permission to blindly implement every box.

Each phase has an entry condition, allowed work, and exit gate.

---

# G0 — Governance convergence

**Status: COMPLETE**

## Goal

Make the repository itself a reliable shared memory for human, GPT, DSH and future agents.

## Entry facts at G0 start — historical

The following records G0's starting conditions, not current missing work. G0 is complete; packaging identity remains consciously deferred under G1.

Already present:

- `PROJECT_BLUEPRINT.md`
- `docs/architecture/PROJECT_CONTROL_OS_ARCHITECTURE.md`
- `docs/architecture/ARCHAEOLOGY_CLOSURE.md`
- `docs/architecture/SOURCE_TRACEABILITY.md`
- `PROJECT_ARCHITECTURE.md`
- this `ROADMAP.md`

Drift at G0 entry:

- `AGENTS.md` describes the repository as frozen V0.5 Multi-Agent Runtime.
- `docs/architecture.md` is the legacy V0.5 architecture without explicit legacy scope.
- `package.json` still describes only the legacy runtime.
- `CHANGELOG.md` does not yet exist.
- ADR storage/convention is not yet established.

## Allowed work

- clarify document authority/read order;
- mark legacy V0.5 architecture as legacy/runtime scope without deleting history;
- define a minimal ADR convention/directory;
- create `CHANGELOG.md` for architectural evolution;
- reconcile top-level repository guidance with the Blueprint;
- preserve the current code behavior.

## Not allowed in G0

- Command implementation;
- Effect Ledger implementation;
- Policy Engine implementation;
- new runtime integration;
- major refactors of legacy V0.5 runtime;
- changing I-01..I-45.

## Exit gate

G0 is complete when a fresh agent entering the repository can determine, from Git alone:

1. what the product is;
2. which document is constitution vs design vs reality vs plan;
3. that V0.5 runtime is legacy/runtime scope;
4. what the current implementation actually contains;
5. what work is currently authorized next;
6. where an architectural decision must be recorded.

**Boundary:** finish G0 before feature development resumes.

---

# G1 — Baseline hardening and reproducibility

**Status: COMPLETE**

## Goal

Turn the existing Project Control prototype into a reproducible baseline before extending its domain.

## Candidate work

- execute and record a clean full test baseline on the current governance head;
- verify MemoryStore/SQLite backend contract parity;
- verify no governance-only commit changed production behavior;
- resolve or explicitly document the top-level Node engine vs `node:sqlite` requirement;
- decide package/repository identity handling without premature rename;
- check current schema compatibility/migration assumptions;
- produce a concise baseline evidence record.

## Likely classification

Mostly A/C technical/governance debt.

Packaging identity may become E if it implies splitting/renaming the product.

## Exit gate

- deterministic current test baseline;
- persistence prerequisites are explicit;
- no unresolved repository-identity ambiguity blocks development;
- `PROJECT_ARCHITECTURE.md` matches verified reality.

---

# G2 — Durable Command boundary

**Status: COMPLETE**

## Why this comes before Effect

The current system has command IDs and an authorization gate, but no authoritative Command object.

Effect tracking cannot be cleanly attached to a nonexistent command lifecycle.

## Required questions before coding

This phase starts as **D — Architectural Gap** until the following are explicitly settled:

- What creates a Command?
- Who owns Command state transitions?
- Exact lifecycle and terminal states.
- What does `AUTHORIZED` mean relative to Approval/Policy?
- What does `DISPATCHED` prove?
- How is `UNKNOWN` represented?
- Which identity is the idempotency key?
- How are retries related to one Command vs a new Command?
- How do command-id replay records currently in Store relate to the future Command domain?
- What is mutable authoritative state vs append-only history?
- What target/version is concurrency checked against?
- Which operations need leases/fencing, if any?

## Required process

Completed for the architecture gate:

1. focused external evidence was reviewed from the existing source-traceability chain;
2. `ADR-0001-durable-command-boundary.md` was accepted;
3. canonical architecture was updated to separate G2 durable authorization from G3 external execution;
4. the bounded G2 Command implementation became **B — Missing Implementation** at that gate, and was subsequently completed (see Exit gate).

Implementation must remain inside ADR-0001's boundary.

## Exit gate

**SATISFIED.** See `docs/architecture/COMMAND_G2_EVIDENCE.md`.

A durable Command now exists without pretending that authorization means dispatch or success.

COMMAND-target Approval remains deliberately disabled; durable identity alone does not settle the later Policy/Approval target decision.

---

# G3 — External Effect and reconciliation boundary

**Status: COMPLETE**

## Goal

Represent what may have happened in the external world without assuming exactly-once execution.

## Architecture gate

Resolved by `ADR-0002-effect-reconciliation-boundary.md`.

The accepted G3 boundary now defines:

- durable Effect identity tied to an AUTHORIZED Command;
- persist-before-dispatch ordering;
- REQUESTED / DISPATCHED / SUCCEEDED / FAILED_NO_EFFECT / UNKNOWN semantics;
- typed reconciliation outcomes;
- UNKNOWN/orphaned-DISPATCHED retry prohibition;
- idempotency-key meaning without exactly-once claims;
- Effect receipt/observation remaining distinct from Evidence;
- a narrow abstract Effect driver seam.

The bounded G3 implementation became **B — Missing Implementation** at that gate, and was subsequently completed (see Exit gate).

## Exit gate

**SATISFIED.** See `docs/architecture/EFFECT_G3_EVIDENCE.md`.

The system now survives an ambiguous external outcome without blind retry and without confusing Effect with Evidence.

---

# G4 — Policy and authorization composition

**Status: COMPLETE**

## Goal

Separate durable human Approval from the rule that decides whether an action is allowed or requires approval.

## Target conceptual contract

```text
Policy(action, capability, target, risk, context)
        ↓
ALLOW | DENY | REQUIRE_APPROVAL
```

Approval remains a durable human permission fact.

## Architecture gate

Resolved by `ADR-0003-policy-approval-composition.md`.

The accepted G4 boundary defines:

- normalized request derived from stored Command/current target;
- deterministic ALLOW / DENY / REQUIRE_APPROVAL;
- deny precedence over human Approval;
- immutable persisted PolicyDecision audit facts;
- fail-closed reference engine;
- re-evaluation at each authorization attempt;
- Approval only as the satisfier of REQUIRE_APPROVAL.

The bounded G4 implementation became **B — Missing Implementation** at that gate, and was subsequently completed (see Exit gate).

## Exit gate

**SATISFIED.** See `docs/architecture/POLICY_G4_EVIDENCE.md`.

No code path equates “Approval exists” with “Policy allows this action”. Policy is evaluated and recorded first; Approval only satisfies REQUIRE_APPROVAL.

---

# G5 — Real Runtime Adapter boundary

**Status: COMPLETE**

## Goal

Prove that Project Control is above replaceable runtimes rather than only above `FakeRuntime`.

## Architecture gate

Resolved by `ADR-0004-runtime-adapter-boundary.md`.

The old maximal interface was replaced with a capability-shaped adapter:

```text
mandatory:
  capabilities()
  start()
  observe()
  collectResult()
  cancel()

optional/capability-gated:
  resume()
  sendMessage()
  subscribeEvents()
  reconcile()
  pause()
```

Project Control Run/Attempt identities stay separate from runtime Session/Workflow/Team/process identities. Runtime observations/results are normalized and non-authoritative. The bounded G5 implementation became **B — Missing Implementation** at that gate, and was subsequently completed (see Exit gate).

## Candidate first adapter

DSH is the natural first real adapter because it is the user's current execution substrate, but Project Control must not encode DSH Session/Workflow/Team as project authority.

## Required proof

A real runtime execution can be started, observed, interrupted/recovered and turned into candidate evidence without changing Project/Task acceptance semantics.

## Exit gate

**SATISFIED.** See `docs/architecture/RUNTIME_G5_EVIDENCE.md`.

A real LocalProcess adapter executes in CI, DSH Workflow has a production-facing adapter over its public seam, FakeRuntime remains deterministic, and runtime-specific identity stays behind RuntimeRef.

---

# G6 — Workspace / Reality / concurrency boundary

**Status: COMPLETE**

## Goal

Make external code/file reality explicit enough for safe parallel execution and evidence lineage.

## Architecture gate

Resolved by `ADR-0005-workspace-isolation-boundary.md`.

The accepted G6 boundary defines:

- durable Workspace identity separate from Run/Attempt/runtime identities;
- one authoritative SHARED workspace plus isolated overlays for concurrent writers;
- enforced write scopes rather than advisory metadata;
- deterministic workspace revision digests;
- per-path base observations and fail-closed integration conflicts;
- control-plane-owned deterministic integration;
- isolated patch revision ≠ authoritative shared revision;
- optional Workspace lineage on Evidence;
- no distributed leases/fencing until a concrete multi-coordinator need appears.

The bounded G6 implementation became **B — Missing Implementation** at that gate, and was subsequently completed (see Exit gate).

## Exit gate

**SATISFIED for the bounded local provider.** See `docs/architecture/WORKSPACE_G6_EVIDENCE.md`.

Parallel execution now has real isolated writable roots, enforced scopes, conflict-safe integration and deterministic ready-set ordering. `Promise.all()` alone is still never accepted as the concurrency model.

---

# G7 — Long-horizon Project Control objects

**Status: COMPLETE — converged by implemented boundaries + explicit deferral of unproven candidates**

This phase is intentionally decomposed. See `docs/architecture/G7_DECOMPOSITION.md`.

Current candidate sequence:

1. G7.1 Project-level Acceptance — COMPLETE.
2. G7.2 Decision — COMPLETE.
3. G7.3 Project-control Memory — D → B → COMPLETE.
4. G7.4 Context Capsule — D → B → COMPLETE; ADR-0009 ACCEPTED, independent review #3 PASSED.
5. G7.5 Roadmap domain — DEFERRED — no demonstrated control-loop or G8 dependency; its D-class architectural gap remains unresolved.
6. G7.6 Observability hardening — DEFERRED — reactivate only on demonstrated G8 auditability need; not COMPLETE.
7. leases/fencing — not currently required; do not implement without a concrete ownership problem.

## Current gate

G7.1 Project Acceptance, G7.2 Decision, G7.3 Project-control Memory and G7.4 Context Capsule are complete within their separately evidenced boundaries. Human authorized G7 convergence on 2026-10-01 by explicitly deferring candidates without demonstrated need. Roadmap remains MISSING / D, not B; reactivate only for a concrete requirement or G8 failure scenario. Observability remains unimplemented and deferred pending demonstrated G8 auditability need. Leases/fencing remain NOT CURRENTLY REQUIRED. G7 COMPLETE does not claim that every Blueprint concept is implemented.

G7.2 evidence: `docs/architecture/DECISION_G7_2_EVIDENCE.md`.

G7.3's architecture gate is resolved by accepted
`docs/architecture/decisions/ADR-0008-project-control-memory-boundary.md`
after bounded source review, two human review rounds and explicit human acceptance
of the current boundary and conservative tradeoffs on 2026-09-30.

G7.3's bounded implementation is now **COMPLETE** after independent implementation
review and explicit human authorization of this governance closeout on 2026-09-30.
The implemented ADR-0008 boundary covers:

- trusted-boundary proposal/validation/promotion authority, without a new Reviewer authentication system;
- closed FACT / DECISION / CONSTRAINT / LESSON × confidence × source admission;
- pinned, same-project necessary sources; all required sources must be CURRENT;
- conservative PROJECT_STATE exact-version invalidation;
- immutable meaning and new MemoryId on replacement;
- ACTIVE → STALE; ACTIVE/STALE → SUPERSEDED; no STALE resurrection;
- source invalidation versus human withdrawal reasons;
- Decision authority remaining unchanged;
- read-only current-use queries: project/lifecycle/source-validity filtering before ranking;
- INFERRED excluded by default, with explicit opt-in; history reads kept separate;
- store consistency and independent reality observation pins/times, without cross-boundary atomicity;
- transactional state/events/replay, optimistic concurrency, backend parity and restart proof.

Completion proof:

- implementation Evidence: `docs/architecture/MEMORY_G7_3_EVIDENCE.md`;
- independently reviewed HEAD: `973f77e2d231ee6eaa4e9b348ebf2424da41f674`;
- CI run [36724720686](https://github.com/zekepeng-a/multi-agent/actions/runs/36724720686):
  success; Node 22 has 592 passed, 0 failed, 0 skipped;
- independent review found no new D/E issue, authority leak or lifecycle defect;
- this authorized governance update records satisfaction of G7.3's exit gate.

**G7.4 Context Capsule — COMPLETE.**
Human explicitly accepted `docs/architecture/decisions/ADR-0009-context-capsule-boundary.md`
on 2026-09-30 after the bounded inventory and external research. Implementation
was separately authorized, repaired and independently reviewed. Human authorized
this governance closeout on 2026-10-01; it records completion without code changes.

The accepted v1 boundary includes:

- derived immutable input, independent ContextCapsuleId and exactly one Attempt;
- complete delivered payload/hash, typed manifest/pins and assembler version;
- all project ACTIVE Decisions by default unless an explicit deterministic,
  versioned applicability rule narrows them;
- preserved source ownership/authority/provenance and ADR-0008 current-use Memory,
  with trusted explicit INFERRED opt-in only;
- required content cannot be silently removed; final serialized UTF-8 byte budget,
  including envelope overhead, fails closed when required input cannot fit;
- pre-dispatch source/selection checks, separate Store and Reality observations;
  no cross-boundary atomic snapshot;
- included supplemental drift requires a new CapsuleId, not in-place refresh;
- persisted/reserved is not received; matching Adapter-boundary receipt and
  UNKNOWN recovery on the existing Attempt, with no blind resend;
- inline v1 persistence, CAS, events, intent-bound replay, backend parity and restart;
- no fixed TTL, history cleanup, leases/fencing or new Effect/dispatch subsystem.

Completion proof:

- architecture gate: ADR-0009 ACCEPTED;
- independently reviewed implementation HEAD: `1f9f208d8eef9fabcba02ac93772ff5713612f24`;
- final implementation CI [36815496417](https://github.com/zekepeng-a/multi-agent/actions/runs/36815496417): success; Node 22 SQLite/full tests and Node 20 compatibility succeeded;
- targeted tests: 77/77; full local Node 24.19.0 regression: 669/669, zero failures/skips;
- review #1 FAILED on three implementation defects; review #2 closed those defects but found Attempt terminal bookkeeping P2; after repair, review #3 PASSED;
- all 25 ADR-0009 exit criteria independently confirmed satisfied; no new D/E issue;
- retained implementation/repair/review Evidence: `docs/architecture/CONTEXT_CAPSULE_G7_4_EVIDENCE.md`.

G7.1–G7.4 Evidence/history, including failed Capsule reviews and repairs, is retained unchanged. G7.5's D-class gap remains unresolved and deferred; this convergence authorizes neither its research nor implementation. No bundle implementation, runtime-memory migration or broader research is authorized.

## Exit gate

G7 is complete only when each implemented candidate has its own evidenced boundary,
and candidates without demonstrated need are explicitly deferred rather than added
for completeness.

This gate is satisfied by G7.1–G7.4's evidenced boundaries and the explicit deferrals above. Human authorized this governance-only closure; it changes no accepted ADR or frozen invariant.

## G8 readiness audit and hierarchy repair closure — historical before Slice 1–4

The read-only audit found a foundation for bounded G8 integration validation, not proof of a complete G8 control loop. Roadmap, a new Observability identity system and leases/fencing are not known blockers. Existing Event / Command / Run / Attempt / Effect / Capsule / RuntimeRef identities suffice to begin bounded dogfood; no multi-coordinator ownership need was demonstrated.

The audit found an A-class implementation bug: cross-project Task→Goal links could pollute another Project's Goal/Milestone/Project aggregation. Reviewed repair HEAD `198ba74e26e6f1d4cb42ce612d37dde2947ac863` adds shared Task→Goal project ownership, create/update/re-parent and Goal project mutation protection, defensive aggregation validation, MemoryStore/SQLite parity and retained Capsule guards. Independent review confirmed CLOSED. Repair CI [36820265823](https://github.com/zekepeng-a/multi-agent/actions/runs/36820265823) succeeded: Node 22 680 passed / 0 failed / 0 skipped; Node 20 424 passed / 0 failed / 256 expected SQLite capability skips. This closes an implementation bug, not a new architecture domain.

Remaining G8 composition proof gaps are authorization ↔ actual execution binding, real Effect, durable/readable results, meaningful Verification, whole-chain restart and adapter substitution. They are not resolved by this governance task and do not justify architectural completeness work.

---

# G8 — End-to-end dogfood and release convergence

**Status: FINAL CONVERGENCE REVIEW READY — final exit review and separate completion decision required**

## Goal

Use Project Control OS to govern meaningful work on a real project and test the architecture as a system.

## Required proof areas

- human Goal → Task/Acceptance;
- controlled Command;
- real runtime execution;
- real Workspace;
- Effect/reconciliation;
- Evidence/Verification/Acceptance;
- restart/recovery;
- Approval/Policy;
- project hierarchy propagation;
- auditable history;
- runtime replacement or adapter substitution.

## Exit gate

A release is justified by end-to-end evidence, not by module count.

## G8 reviewed bounded evidence convergence — 2026-10-01

**Current status: FINAL CONVERGENCE REVIEW READY — not COMPLETE.** Human authorized this governance convergence after independent PASS for Slice 1–4 and CLOSED stability A1/A2. Reviewed test/Evidence HEAD: `7dad1894f802bdd6076a9320731c918a7a765e0a`; final CI [36857097373](https://github.com/zekepeng-a/multi-agent/actions/runs/36857097373) succeeded (Node 22 810 pass / 0 fail / 0 skip; Node 20 481 pass / 0 fail / 329 expected SQLite capability skips). This is not a production implementation expansion. No further B Slice is currently required. Final exit review and separate Human completion decision/commit remain necessary.

| Required proof area | Current reviewed bounded evidence |
|---|---|
| Human Goal → Task/Acceptance | SATISFIED BY BOUNDED EVIDENCE — Slice 1/4 intent, hierarchy, pinned contract |
| Controlled Command | SATISFIED BY BOUNDED EVIDENCE — Slice 1/2/4 concrete authorization/execution binding |
| Real runtime execution | SATISFIED BY BOUNDED EVIDENCE — real LocalProcess |
| Real Workspace | SATISFIED BY BOUNDED EVIDENCE — READ_ONLY actual files/root/revision |
| Effect/reconciliation | SATISFIED BY BOUNDED EVIDENCE — Slice 2 real filesystem provider/Reality |
| Evidence/Verification/Acceptance | SATISFIED BY BOUNDED EVIDENCE — Slice 1/3/4 real content and control-owned Acceptance |
| Restart/recovery | SATISFIED BY BOUNDED EVIDENCE — Effect UNKNOWN and completed-result process checkpoints |
| Approval/Policy | SATISFIED BY BOUNDED EVIDENCE — scoped permission and current authorization |
| Hierarchy propagation | SATISFIED BY BOUNDED EVIDENCE — contract-free Goal/Milestone/Project |
| Auditable history | SATISFIED BY BOUNDED EVIDENCE — identities, receipt, lineage, events, replay/reopen |
| Runtime replacement/substitution | SATISFIED BY BOUNDED EVIDENCE — Slice 4 LocalProcess↔DSH public contract |

**SATISFIED BY BOUNDED EVIDENCE != universal capability support.** Original authorization/execution, real Effect, durable/readable completed-result, meaningful Verification and adapter-substitution gaps are closed within reviewed scopes. Whole-chain in-flight and whole-project recovery remain unproven.

Real runtime in-flight reconciliation is **DEFERRED — D architecture gap candidate**, not implemented or silently treated as B. LocalProcess and DSH Workflow still declare resume=false/reconcile=false; provider-specific Reality re-binding semantics are not frozen. It is not a current G8 exit blocker under the Human-authorized reviewed bounded release scope. Future activation requires separate Human authorization and focused research/ADR; this governance task resolves no provider observation or recovery semantics.

Live DSH remains valuable future dogfood / not a current G8 exit blocker. Slice 4 proves DshWorkflowRuntimeAdapter public-contract substitution through an injected engine, not live installation/Harness host, parent Agent/model execution, filesystem isolation or live result durability. G8 uses real READ_ONLY Workspace. G6's bounded WRITE/overlay/integration implementation remains separate; extra real write dogfood is not required or activated.

G7.5 remains DEFERRED / D unresolved; G7.6 remains DEFERRED; leases/fencing remain NOT CURRENTLY REQUIRED. Slice 1–4 exposed no new concrete dependency requiring reactivation. No new Slice, production capability, domain, state, invariant or accepted ADR is introduced.

Evidence: [Slice 1](docs/architecture/G8_DOGFOOD_SLICE_1_EVIDENCE.md), [stability repair](docs/architecture/G8_SLICE_1_STABILITY_REPAIR_EVIDENCE.md), [Slice 2](docs/architecture/G8_DOGFOOD_SLICE_2_EFFECT_EVIDENCE.md), [Slice 3](docs/architecture/G8_DOGFOOD_SLICE_3_DURABLE_RUNTIME_RESULT_EVIDENCE.md), [Slice 4](docs/architecture/G8_DOGFOOD_SLICE_4_ADAPTER_SUBSTITUTION_EVIDENCE.md).

## 6. Current active boundary

Current durable phase boundary:

```text
COMPLETE: G0 Governance convergence
COMPLETE: G1 Baseline hardening
COMPLETE: G2 Durable Command boundary
COMPLETE: G3 External Effect + reconciliation boundary
COMPLETE: G4 Policy / authorization composition
COMPLETE: G5 Real Runtime Adapter boundary
COMPLETE: G6 Workspace / Reality / concurrency boundary
COMPLETE: G7.1 Project-level Acceptance
COMPLETE: G7.2 Project Decision
COMPLETE: G7.3 Project-control Memory — ADR-0008 implementation reviewed
COMPLETE: G7 convergence — implemented boundaries + explicit deferral
COMPLETE: G7.4 Context Capsule — ADR-0009; independent review #3 PASSED
DEFERRED: G7.5 Roadmap domain — unresolved D; no demonstrated control-loop or G8 dependency
DEFERRED: G7.6 Observability — reactivate only on demonstrated G8 auditability need
NOT CURRENTLY REQUIRED: leases/fencing
FINAL CONVERGENCE REVIEW READY: G8 reviewed bounded evidence
          Final exit review + separate Human completion commit required.
BLOCKED FROM BUNDLE CODING:
          Roadmap / Decision / Memory / Context Capsule / Project Acceptance /
          Observability / leases-fencing may not be implemented as one
          "complete the architecture" package.
```

G0–G6 each exited only after their documented exit gate was evidenced and the Roadmap boundary changed in Git.

G7 is intentionally different: each candidate object must be classified separately A/B/C/D/E and may proceed only with its own authority role and concrete control-loop need. A D-class candidate requires focused research + ADR first; an E-class change returns to the human.

No DSH/GPT report advances this boundary by itself.

A phase or candidate transition requires:

1. its exit/entry condition to be evidenced;
2. independent review against Git current reality;
3. the ROADMAP status to be changed in a commit.

That commit is the durable boundary change.

## 7. How DSH should be used under this roadmap

DSH receives **tasks from the active phase**, not authority to invent the next phase.

A normal DSH task should state:

- active roadmap phase;
- exact bounded objective;
- A/B/C/D/E classification;
- files it may change;
- files it must not change;
- required tests/evidence;
- stop conditions.

DSH must stop and report rather than self-expand when it discovers:

- a D architectural gap;
- an E direction change;
- a contradiction with a frozen invariant;
- an external effect whose outcome is UNKNOWN;
- required changes outside the task's authorized phase.

## 8. How GPT should be used under this roadmap

GPT does not turn each DSH report into the next development boundary.

GPT should:

1. compare the report with Git;
2. compare Git reality with Blueprint/architecture;
3. classify findings;
4. distinguish local bug from architectural gap;
5. use focused external research only when a D issue exists;
6. propose a roadmap change only when phase evidence warrants it.

The durable boundary remains this file.

## 9. Human decision boundary

The human is not expected to decide ordinary implementation details.

Human decision is required when work would:

- alter Project Control OS identity;
- merge Project Control authority into a runtime;
- materially change the five-layer model;
- weaken human authority/high-risk approval boundaries;
- change frozen invariants rather than implement them;
- split/rename/re-scope the product in a way that changes direction;
- introduce a major new product goal not represented by the Blueprint.

## 10. Roadmap maintenance rule

This file is mutable, but not casually.

Update it when:

- a phase exit gate is actually satisfied;
- a new verified dependency changes ordering;
- an ADR resolves a D-class gap;
- a human resolves an E-class direction decision;
- current reality proves a roadmap assumption false.

Do not update it merely because an agent suggested more work.
