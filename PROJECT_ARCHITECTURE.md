# PROJECT_ARCHITECTURE.md

**Status:** CURRENT REALITY MAP  
**Baseline branch:** `project-control/controller-v0.1`  
**Baseline commit when written:** `c9d365a0d66100327951602dcdfe4d4f6a676731`  
**Purpose:** describe what this repository actually implements now. This file is not a target design and must not promote documented intentions into implemented reality.

## 1. Authority and read order

For project-control work, read in this order:

1. `PROJECT_BLUEPRINT.md` — project constitution and frozen direction.
2. `docs/architecture/PROJECT_CONTROL_OS_ARCHITECTURE.md` — canonical detailed design.
3. **This file** — current implemented reality.
4. `ROADMAP.md` — approved development sequence from current reality toward the design.
5. Code, tests, Git history, and runtime evidence — final proof for any concrete implementation claim.

When this file disagrees with code/tests/Git, **code/tests/Git win and this file must be corrected**.

A DSH/GPT report is evidence to inspect, not project-state authority.

## 2. Repository identity today

This repository contains two distinct architectural eras:

### A. Legacy V0.5 Multi-Agent Runtime

The root runtime files (`orchestrator.mjs`, `executors.mjs`, `distiller.mjs`, `retriever.mjs`, `context.mjs`, `state-summary.mjs`) implement the earlier DSH Multi-Agent Runtime prototype.

`AGENTS.md`, `package.json`, and `docs/architecture.md` still primarily describe this era.

This code remains valid historical/runtime implementation. It is **not the current top-level product definition**.

### B. Project Control OS prototype

The newer `project-control/` modules implement a control-plane prototype above replaceable execution runtimes.

The current product direction is defined by `PROJECT_BLUEPRINT.md`: Project Control OS, not another multi-agent runtime.

Therefore the relationship is:

```text
Project Control OS                         current product direction
├─ Project Control prototype              new control-plane implementation
└─ Legacy V0.5 Multi-Agent Runtime        existing runtime/prototype asset
```

The legacy runtime is not deleted and is not silently reinterpreted as Project Control.

## 3. Status vocabulary

Every concept in this file uses one of these labels:

- **IMPLEMENTED** — concrete code and tests exist for the stated scope.
- **PARTIAL** — meaningful implementation exists, but the canonical design is not complete.
- **DOCUMENTED_ONLY** — architecture is described but no corresponding Project Control implementation exists.
- **RESERVED** — vocabulary/interface space exists intentionally, but behavior is deliberately unsupported.
- **MISSING** — required concept has no current Project Control implementation.
- **CONFLICT** — current repository documents or implementation contradict the Blueprint/canonical authority model.

These labels describe the baseline commit above only.

## 4. Current reality map

| Concept | Status | Current reality |
|---|---|---|
| Project | IMPLEMENTED | Durable project record, versioned lifecycle state, persistence, controller aggregation to completion. |
| Roadmap | MISSING | Mentioned in architecture and `Milestone.roadmapId` is future-facing, but there is no Roadmap control object/lifecycle/store collection/controller. |
| Milestone | IMPLEMENTED | Durable/versioned object, child-side project relationship, aggregation from Goals, optional pinned Acceptance. |
| Goal | IMPLEMENTED | Durable/versioned object, project/milestone relationship, aggregation from Tasks, optional pinned Acceptance. |
| Task | IMPLEMENTED | Durable/versioned object, pinned Acceptance revision, Run linkage, lifecycle and acceptance flow. |
| Acceptance Contract | PARTIAL | Revisioned contracts exist for Task/Goal/Milestone flows. PROJECT is in the target vocabulary but Project-level acceptance is not implemented. |
| Run | IMPLEMENTED | Durable/versioned execution record distinct from Task. |
| Attempt | IMPLEMENTED | Concrete execution attempt distinct from Run, including LOST/FAILED/etc. states. |
| Evidence | IMPLEMENTED | Task execution Evidence and parent aggregate Evidence exist with lineage, revision/pinning and stale/superseded semantics. |
| Verification | IMPLEMENTED | Separate verification records and verdict flow exist; verifier does not directly own Project State. |
| Controller | PARTIAL | Task reconciliation and parent aggregation/acceptance exist. The full Blueprint control surface is not yet implemented. |
| Reconciliation | PARTIAL | LOST Attempt recovery distinguishes `confirmed_no_effect`, `confirmed_completed`, and `unknown`; this is not yet a general reconciliation subsystem for all external effects. |
| Recovery | PARTIAL | Safe recovery exists for the current LOST-attempt path; typed recovery across Command/Effect/runtime/project boundaries is not complete. |
| Approval | IMPLEMENTED | Durable scoped human approval lifecycle, target-version pinning, attribution, expiry/revocation, action/capability/scope checks, fail-closed semantics. |
| Policy | IMPLEMENTED / PARTIAL | Deterministic StaticPolicyEngine now evaluates stored Command/current-target facts with DENY > REQUIRE_APPROVAL > ALLOW precedence and fail-closed default. Immutable PolicyDecision audit facts persist in MemoryStore/SQLite and survive restart. Controller re-evaluates policy at every authorization attempt; Approval only satisfies REQUIRE_APPROVAL. External policy adapters/management remain future work. |
| Command | IMPLEMENTED / PARTIAL | Durable Command now exists with immutable stored intent, independent version, MemoryStore/SQLite persistence, CREATED→AUTHORIZED/REJECTED transitions, events, restart proof, and Command-based Controller authorization. DISPATCHED/EXECUTING/SUCCEEDED/FAILED/UNKNOWN remain reserved for G3. Historical store-mutation replay rows remain a separate mechanism. COMMAND-target Approval remains intentionally refused. |
| Effect | IMPLEMENTED / PARTIAL | Durable Effect ledger now exists with REQUESTED/DISPATCHED/SUCCEEDED/FAILED_NO_EFFECT/UNKNOWN semantics, MemoryStore/SQLite persistence, fake driver seam, idempotency/replay handling, typed reconciliation, and real restart proof for orphaned DISPATCHED state. Real provider/runtime integrations remain future work. |
| Event | IMPLEMENTED | Append-oriented events are persisted with authoritative mutations and survive SQLite restart. Event is kept distinct from State. |
| Decision | MISSING | No dedicated Project Control Decision object/store/lifecycle exists. |
| Project-control Memory | MISSING | The legacy runtime has derived memory machinery, but the Blueprint's source-referenced Project Control memory model is not implemented. |
| Context Capsule | DOCUMENTED_ONLY | Defined conceptually; no Project Control implementation assembles or persists bounded capsules. |
| Runtime Adapter | IMPLEMENTED / PARTIAL | Normalized capability-shaped Runtime Adapter contract now exists. FakeRuntime migrated, LocalProcessRuntimeAdapter executes real child processes in CI, and DshWorkflowRuntimeAdapter binds the current DSH Workflow seam through injected workflowEngine. RuntimeRef persists on Attempt and survives restart while remaining distinct from Run/Attempt identity. Workspace/isolation semantics remain G6. |
| Workspace | DOCUMENTED_ONLY / G6 READY | ADR-0005 now settles durable Workspace identity, SHARED vs ISOLATED semantics, enforced write scopes, deterministic revision digests, conflict-safe integration and optional Evidence workspace lineage. No Workspace implementation exists yet. |
| Workspace isolation | DOCUMENTED_ONLY / G6 READY | G6 design now requires distinct writable roots for parallel writers and control-plane integration; DSH Team writeScopes remain advisory until enforced by Project Control. Implementation is pending. |
| Optimistic concurrency | IMPLEMENTED | Version-aware updates reject stale expected versions; persistence tests cover rollback/conflict behavior. |
| Command idempotency key | IMPLEMENTED | Durable command-id replay/operation binding exists in store semantics, but this is not a durable Command domain. |
| Parent relationship authority | IMPLEMENTED | Child-side links are authoritative; parent cached ID lists are not used as relationship truth. |
| Goal/Milestone parent Acceptance | IMPLEMENTED | Aggregate child snapshots become identified Evidence and flow through Verification/Acceptance. |
| Project Acceptance | MISSING | Project can complete by milestone aggregation; it does not yet have the full contract/evidence/verification acceptance flow. |
| Durable persistence | IMPLEMENTED | Memory and SQLite backends share control semantics; SQLite restart/transaction behavior is tested. |
| Observability identity | MISSING | Canonical TraceId/SpanId/CorrelationId/CausationId domain is not implemented. |
| Leases/fencing | MISSING | No durable ownership lease/fencing model exists. |

## 5. Implemented control-plane core

The current `project-control/` prototype has a real, bounded core:

```text
Project
  └─ Milestone
       └─ Goal
            └─ Task
                 ├─ Acceptance revision pin
                 └─ Run
                      └─ Attempt
                           └─ Evidence
                                └─ Verification
                                     └─ Acceptance / Task state
```

The store layer owns shared control semantics rather than duplicating them per persistence backend.

Current durable collections include Project, Milestone, Goal, Task, Acceptance, Run, Attempt, Evidence, Verification, and Approval. Events and command-id replay records are also persisted by the backends.

## 6. Verified architectural boundaries already represented in code

The current prototype materially enforces these boundaries:

- Task is not Run.
- Run is not Attempt.
- Evidence precedes Acceptance.
- Candidate Evidence is not automatically accepted Evidence.
- Verification is distinct from Project State.
- Acceptance is pinned to a concrete contract revision.
- Stale/current-reality mismatch invalidates evidence/approval use.
- Approval is permission, not Acceptance.
- Approval action, capability and scope are independent bound authorization dimensions.
- Approval is bound to a concrete target version.
- COMMAND-target Approval is reserved but unsupported until Command becomes a durable control object.
- UNKNOWN reconciliation does not authorize blind re-execution.
- authoritative parent membership comes from child-side relationships.
- parent completion with its own Acceptance contract requires parent aggregate evidence/verification.
- stale expected versions fail closed.
- command-id replay prevents duplicate authoritative mutation for the implemented store operations.
- state/event/idempotency writes share a transaction in SQLite.

These are implementation-level facts for the current prototype scope, not claims that every Blueprint invariant is fully realized across all future domains.

## 7. Known architecture/reality gaps

The following are not ordinary bugs; they represent missing system surface or unresolved architecture-to-implementation work:

### 7.1 Command and Effect

The canonical architecture defines durable Command and Effect lifecycles, including UNKNOWN external outcomes and reconciliation before unsafe retry.

Current reality now has:

- durable Command identity and immutable intent;
- independent Command versioning;
- CREATED → AUTHORIZED / REJECTED lifecycle;
- persistent Command records in both backends;
- command.created / command.authorized / command.rejected events;
- restart/idempotency proof;
- historical command IDs for store-mutation replay as a separate mechanism;
- LOST Attempt reconciliation.

It still does **not** have:

- overall Command completion aggregation;
- DISPATCHED / EXECUTING / SUCCEEDED / FAILED / UNKNOWN Command transitions;
- real provider/runtime Effect drivers;
- a generalized multi-worker ownership/lease model.

It **does** now have a durable Effect ledger and typed external-outcome reconciliation beside Command state.

Do not describe current command-id replay records as the Command domain, and do not describe AUTHORIZED as executed.

### 7.2 Policy

A bounded deterministic Policy layer now exists.

Current reality includes:

- StaticPolicyEngine with explicit versioned configuration;
- normalized request derived from stored Command/current target;
- ALLOW / DENY / REQUIRE_APPROVAL with deny precedence;
- immutable PolicyDecision persistence/audit history;
- per-attempt re-evaluation;
- Approval used only to satisfy REQUIRE_APPROVAL.

Current reality does **not** yet include:

- external OPA/Cedar/enterprise policy adapters;
- policy authoring/management UI;
- enterprise identity/role directory;
- COMMAND-target Approval.

### 7.3 Runtime replaceability

A normalized Runtime Adapter boundary now exists.

Current reality includes:

- explicit capabilities and fail-loud unsupported operations;
- RuntimeRef / RuntimeObservation / RuntimeResult normalization;
- FakeRuntime migrated to the adapter contract;
- LocalProcessRuntimeAdapter with real OS-process execution proof in CI;
- DshWorkflowRuntimeAdapter over the current DSH Workflow start/result/cancel/dispose seam;
- opaque RuntimeRef persisted on Attempt across restart;
- Controller mapping COMPLETED runtime result into Candidate Evidence only.

Current reality does **not** yet include:

- a live-in-DSH smoke test in CI;
- DSH Subagent/Agent Team adapters;
- workspace isolation/write scopes;
- automatic provider/model routing.

### 7.4 Reality/workspace control

Workspace identity, isolation, write scope, revision observation, deterministic integration and concurrent-write safety are architecturally defined but not enforced by Project Control code.

### 7.5 Long-horizon project semantics

Roadmap, Decision, Project-control Memory, Context Capsule and Project-level Acceptance remain absent or design-only.

## 8. Current conflicts and documentation drift

### C-01 — repository identity drift — RESOLVED FOR DOCUMENT AUTHORITY

`AGENTS.md` now declares Project Control OS as the current product direction and defines the governance read order. `docs/architecture.md` is explicitly scoped as **Legacy V0.5 Runtime Architecture**.

The old runtime remains present and valid for its own scope. `package.json` still carries the historical package identity; that remaining packaging question is tracked separately below and does not control document authority.

### C-02 — package/runtime identity drift — CONSCIOUSLY DEFERRED

`package.json` still names/describes the published package surface as `dsh-multi-agent-runtime` version 0.5.0 and exposes legacy runtime scripts.

G1 deliberately does not rename or split the package. Repository-level product direction is governed by the Project Control documents; package publication identity remains historical/legacy-runtime-oriented until a human/product decision changes release scope. This does not block Project Control architecture work.

### C-03 — Node version boundary — RESOLVED AS A CAPABILITY MATRIX

The package declares Node `>=20`. CI now verifies that floor separately from the full persistence baseline.

- Node 20.20.2: 435 discovered, 295 pass, 140 skipped, 0 fail; SQLite-backed tests are capability-gated because `node:sqlite` is unavailable.
- Node 22.23.3: 435/435 pass, 0 skipped; CI explicitly asserts `node:sqlite` availability before running tests.

Therefore `engines.node >=20` does not imply SqliteStore availability. Durable SQLite Project Control requires a runtime with built-in `node:sqlite`. See `docs/architecture/BASELINE_EVIDENCE.md`.

## 9. Legacy runtime boundary

The following concepts belong to the legacy V0.5 runtime unless explicitly bridged later:

- Manager/orchestrator
- two-phase Planner
- Agent registry
- Executor selection
- DAG scheduling
- Review/Evaluator/Replan loop
- legacy derived Memory/Context assembly

They may remain useful runtime assets. They do not become Project Control authority merely because they already exist.

In particular:

```text
legacy task DAG            ≠ Project Control Task authority
legacy run/review records  ≠ accepted Project State
legacy memory              ≠ Project-control Memory
legacy planner             ≠ Roadmap authority
legacy orchestrator        ≠ Project Control Controller
```

Any bridge between the two eras must be explicit.

## 10. What this baseline does not claim

This file does not claim:

- that the latest test suite was freshly executed while writing this governance file;
- that every invariant I-01..I-45 has complete implementation coverage;
- that the current persistence schema is production-migration-ready;
- that fake runtime tests prove real external-runtime behavior;
- that DSH Workflow/Team integration exists;
- that Command, Effect, Policy, Workspace, Roadmap, Decision, Project-control Memory or Context Capsule are implemented because they appear in architecture documents.

## 11. Change rule

A future implementation change may update this file only when code/tests/Git establish a new current reality.

Before implementation, classify the proposed work using the Blueprint categories:

- **A** Implementation Bug
- **B** Missing Implementation
- **C** Architectural Conflict
- **D** Architectural Gap
- **E** Direction Change

For D, stop implementation and resolve the architecture question with focused external research + ADR.

For E, return to the human.

No DSH or GPT output may move a feature from MISSING/PARTIAL to IMPLEMENTED by itself.
