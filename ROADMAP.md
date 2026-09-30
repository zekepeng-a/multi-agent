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

## Current facts

Already present:

- `PROJECT_BLUEPRINT.md`
- `docs/architecture/PROJECT_CONTROL_OS_ARCHITECTURE.md`
- `docs/architecture/ARCHAEOLOGY_CLOSURE.md`
- `docs/architecture/SOURCE_TRACEABILITY.md`
- `PROJECT_ARCHITECTURE.md`
- this `ROADMAP.md`

Still drifting:

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
4. the bounded G2 Command implementation is now **B — Missing Implementation**.

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

The bounded G3 implementation is now **B — Missing Implementation**.

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

The bounded G4 implementation is now **B — Missing Implementation**.

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

Project Control Run/Attempt identities stay separate from runtime Session/Workflow/Team/process identities. Runtime observations/results are normalized and non-authoritative. The bounded G5 implementation is now **B — Missing Implementation**.

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

The bounded G6 implementation is now **B — Missing Implementation**.

## Exit gate

**SATISFIED for the bounded local provider.** See `docs/architecture/WORKSPACE_G6_EVIDENCE.md`.

Parallel execution now has real isolated writable roots, enforced scopes, conflict-safe integration and deterministic ready-set ordering. `Promise.all()` alone is still never accepted as the concurrency model.

---

# G7 — Long-horizon Project Control objects

**Status: ACTIVE — G7.1 PROJECT ACCEPTANCE D-GATE**

This phase is intentionally decomposed. See `docs/architecture/G7_DECOMPOSITION.md`.

Current candidate sequence:

1. G7.1 Project-level Acceptance — D, active.
2. G7.2 Decision — D, queued.
3. G7.3 Project-control Memory — D, queued after Decision.
4. G7.4 Context Capsule — D, queued after Decision/Memory.
5. G7.5 Roadmap domain — D, queued; distinct from repository `ROADMAP.md`.
6. G7.6 Observability hardening — only to demonstrated G8 need.
7. leases/fencing — not currently required; do not implement without a concrete ownership problem.

## Current gate

G7.1 is the only active design question.

`PROJECT` already exists as an Acceptance target type, but Project has no pinned
Acceptance revision and no contract-bound completion flow.

Before code, settle:

- whether Project may optionally pin an Acceptance Contract like Goal/Milestone;
- whether all Milestones must first be COMPLETED;
- how aggregate Project Evidence identifies the child snapshot;
- which Project source states may enter acceptance;
- whether Project without a contract may continue aggregate completion;
- stale/superseded Project evidence behavior;
- exact atomic transition of Project + contract status.

Focused source review + ADR required before implementation.

## Exit gate

G7 is complete only when each implemented candidate has its own evidenced boundary,
and candidates without demonstrated need are explicitly deferred rather than added
for completeness.

---

# G8 — End-to-end dogfood and release convergence

**Status: FUTURE**

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
ACTIVE:   G7.1 Project-level Acceptance — D-GATE
NEXT:     G8 End-to-end dogfood + release convergence
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
