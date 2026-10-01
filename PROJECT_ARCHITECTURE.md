# PROJECT_ARCHITECTURE.md

**Status:** CURRENT REALITY MAP  
**Baseline branch:** `project-control/controller-v0.1`  
**Initial baseline commit when written:** `c9d365a0d66100327951602dcdfe4d4f6a676731`
**Latest reviewed evidence:** `7dad1894f802bdd6076a9320731c918a7a765e0a`; Slice 1–4 independently reviewed PASS, stability A1/A2 CLOSED. Final CI `36857097373`: Node 22 810 pass / 0 fail / 0 skip; Node 20 481 pass / 0 fail / 329 expected SQLite capability skips. This test/Evidence HEAD is not a production-code expansion. Earlier hierarchy repair/G7 evidence remains historical.
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

`package.json` retains the legacy package identity. `docs/architecture.md` explicitly documents this era; `AGENTS.md` governs the current Project Control OS repository.

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

These labels describe the initial baseline plus the evidenced updates recorded below; the initial baseline commit is historical, not the revision of every current entry.

## 4. Current reality map

| Concept | Status | Current reality |
|---|---|---|
| Project | IMPLEMENTED | Durable project record, versioned lifecycle state, persistence, controller aggregation to completion. |
| Roadmap | MISSING / D / DEFERRED | `Milestone.roadmapId` remains future-facing; no Roadmap control object/lifecycle/store/controller exists. Its architectural gap is unresolved, with no demonstrated control-loop or G8 dependency. |
| Milestone | IMPLEMENTED | Durable/versioned object, child-side project relationship, aggregation from Goals, optional pinned Acceptance. |
| Goal | IMPLEMENTED | Durable/versioned object, project/milestone relationship, aggregation from Tasks, optional pinned Acceptance. |
| Task | IMPLEMENTED | Durable/versioned object, pinned Acceptance revision, Run linkage, lifecycle and acceptance flow. |
| Acceptance Contract | PARTIAL | Revisioned contracts exist for Task/Goal/Milestone/Project flows, including G7.1 Project-level acceptance; the full canonical design remains broader than this bounded prototype. |
| Run | IMPLEMENTED | Durable/versioned execution record distinct from Task. |
| Attempt | IMPLEMENTED | Concrete execution attempt distinct from Run, including LOST/FAILED/etc. states. |
| Evidence | IMPLEMENTED | Task execution Evidence and parent aggregate Evidence exist with lineage, revision/pinning and stale/superseded semantics. |
| Verification | IMPLEMENTED | Separate verification records and verdict flow exist; verifier does not directly own Project State. |
| Controller | PARTIAL | Task reconciliation and parent aggregation/acceptance exist. The full Blueprint control surface is not yet implemented. |
| Reconciliation | PARTIAL | Existing LOST Control Plane outcomes are settled. Slice 2 proves bounded real filesystem Effect UNKNOWN reconciliation across process restart. Real LocalProcess/DSH in-flight observation remains unsupported/deferred as a provider-specific D candidate. |
| Recovery | PARTIAL | Effect-only UNKNOWN restart/reconciliation and provider-owned completed Runtime result recorded-Evidence reproof/Acceptance across processes are evidenced by Slices 2/3. Arbitrary in-flight Runtime, real LocalProcess/DSH restart reconciliation and whole-project recovery remain unproven. |
| Approval | IMPLEMENTED | Durable scoped human approval lifecycle, target-version pinning, attribution, expiry/revocation, action/capability/scope checks, fail-closed semantics. |
| Policy | IMPLEMENTED / PARTIAL | Deterministic StaticPolicyEngine now evaluates stored Command/current-target facts with DENY > REQUIRE_APPROVAL > ALLOW precedence and fail-closed default. Immutable PolicyDecision audit facts persist in MemoryStore/SQLite and survive restart. Controller re-evaluates policy at every authorization attempt; Approval only satisfies REQUIRE_APPROVAL. External policy adapters/management remain future work. |
| Command | IMPLEMENTED / PARTIAL | Durable Command now exists with immutable stored intent, independent version, MemoryStore/SQLite persistence, CREATED→AUTHORIZED/REJECTED transitions, events, restart proof, and Command-based Controller authorization. DISPATCHED/EXECUTING/SUCCEEDED/FAILED/UNKNOWN Command transitions remain reserved; G3 implements separate Effect outcomes, not overall Command completion. Historical store-mutation replay rows remain a separate mechanism. COMMAND-target Approval remains intentionally refused. |
| Effect | IMPLEMENTED / PARTIAL | Durable Effect ledger and existing uncertainty/replay rules remain implemented. Slice 2 proves a bounded test-side real filesystem provider: persist-before-dispatch, UNKNOWN/Reality reconciliation, confirmed-no-effect safe retry and real restart. General/network providers and generic production provider support remain future work. |
| Event | IMPLEMENTED | Append-oriented events are persisted with authoritative mutations and survive SQLite restart. Event is kept distinct from State. |
| Decision | IMPLEMENTED | Durable Project Decision exists with HUMAN/CONTROL_PLANE authority, mandatory provenance, immutable meaning, ACTIVE→SUPERSEDED/REVOKED lifecycle, atomic supersession lineage, attributable revocation, optimistic concurrency, MemoryStore/SQLite persistence and restart proof. Runtime/model proposals are not Decision authority. |
| Project-control Memory | IMPLEMENTED (G7.3 COMPLETE) | ADR-0008 is implemented: trusted validation and Control Plane promotion, closed type/confidence/source admission, four pinned same-project source families, CURRENT/INVALID/UNRESOLVED validity, STALE/no-resurrection, atomic new-id supersession, read-only eligibility-before-ranking queries, INFERRED opt-in and separate history. MemoryStore/SQLite parity, CAS, events, intent-bound replay, restart and independent-writer concurrency are evidenced. Legacy derived memory remains separate; no Capsule assembly or authority upgrade is included. |
| Context Capsule | IMPLEMENTED (G7.4 COMPLETE) | Accepted ADR-0009 is implemented: immutable per-Attempt canonical JSON/hash snapshot, typed source manifest, required/supplemental UTF-8 budget, freshness/selection completeness, ADR-0008 current-use Memory, Adapter receipt, PREPARED/DISPATCHING/RECEIVED/NOT_RECEIVED/UNKNOWN, recovery/replay/CAS, MemoryStore/SQLite parity, real restart and independent-writer protection. LocalProcess/DSH integration proves Adapter input receipt, not final model tokens or source authority upgrade. See `CONTEXT_CAPSULE_G7_4_EVIDENCE.md`. |
| Runtime Adapter | IMPLEMENTED / PARTIAL | Existing normalized capability-shaped contract; real LocalProcess execution and reviewed Slice 4 LocalProcess↔DshWorkflowRuntimeAdapter public-contract substitution through injected workflowEngine. Live DSH host remains unproven; resume/reconcile remain false for both adapters. RuntimeRef remains separate from Run/Attempt; adapter capability does not establish Workspace write isolation. |
| Workspace | IMPLEMENTED / PARTIAL | Durable Workspace identity now exists with SHARED/ISOLATED kind, READ_ONLY/WRITE access, MemoryStore/SQLite persistence, optimistic versioning, deterministic revision digests, enforced write scopes, conflict-safe local overlay integration, deterministic integration order and restart proof. Git-worktree/container providers and distributed coordination remain outside current scope. |
| Workspace isolation | IMPLEMENTED / PARTIAL | Local WorkspaceManager gives parallel writers distinct roots, overlays reads over SHARED reality, records touched-path base digests, rejects out-of-scope/read-only/path-traversal writes, and detects integration conflicts before patch application. DSH Team writeScopes remain non-authoritative unless projected through this boundary. |
| Optimistic concurrency | IMPLEMENTED | Version-aware updates reject stale expected versions; persistence tests cover rollback/conflict behavior. |
| Store-mutation replay identity | IMPLEMENTED | Command-id replay/operation binding deduplicates store mutations; it is separate from durable Command identity and the Command's idempotency key. |
| Parent relationship authority | IMPLEMENTED | Child-side links are authoritative; parent cached ID lists are not used as relationship truth. |
| Goal/Milestone parent Acceptance | IMPLEMENTED | Aggregate child snapshots become identified Evidence and flow through Verification/Acceptance. |
| Project Acceptance | IMPLEMENTED | Project may optionally pin a PROJECT Acceptance revision. Contract-free projects still complete by Milestone aggregation; contract-bound projects require current Milestone aggregate Evidence + PASS Verification, with atomic Project COMPLETED + contract PASSED and restart proof. |
| Durable persistence | IMPLEMENTED | Memory and SQLite backends share control semantics; SQLite restart/transaction behavior is tested. |
| Observability identity | MISSING / DEFERRED | TraceId/SpanId/CorrelationId/CausationId domain is not implemented; reactivate only on demonstrated G8 auditability need. |
| Leases/fencing | MISSING / NOT CURRENTLY REQUIRED | No durable ownership lease/fencing model exists; no concrete multi-coordinator ownership need has been demonstrated. |

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

Current durable collections include Project, Milestone, Goal, Task, Acceptance, Run, Attempt, Evidence, Verification, Approval, Command, Effect, PolicyDecision, Decision, and Workspace. Events and command-id replay records are also persisted by the backends.

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
- automatic provider/model routing.

### 7.4 Reality/workspace control

G6 now implements a bounded local WorkspaceManager: durable Workspace identity, SHARED/ISOLATED roots, enforced write scopes, deterministic revision observation, conflict-safe sequential integration, and optional Workspace-bound Evidence lineage. This proves the local control boundary; distributed leases/fencing, Git-worktree/container providers, and multi-coordinator ownership remain unimplemented.

### 7.5 Long-horizon project semantics

Project-level Acceptance (G7.1), durable Decision (G7.2) and Project-control Memory
(G7.3) are implemented and complete within their accepted ADR boundaries.
Memory control rules live in `project-control/project-memory.mjs`, use the existing
backend primitives, and are optionally exposed through trusted `Controller.memory`
composition. The retained `MEMORY_G7_3_EVIDENCE.md` maps all 23 ADR-0008 exit criteria
to tests, including real restart and independent SQLite writer competition.

Context Capsule (G7.4) is implemented and COMPLETE within accepted ADR-0009.
`project-control/context-capsule.mjs` composes the trusted assembler and existing
Store/runtime boundaries. It archives immutable per-Attempt full canonical JSON
UTF-8 payload/hash, typed source manifest/pins and versioned profile; separates
required/supplemental budget; rechecks freshness and selection completeness before
dispatch; and consumes only ADR-0008 current-use Memory. LocalProcess and DSH
Adapters integrate input-bound receipts. PREPARED / DISPATCHING / RECEIVED /
NOT_RECEIVED / UNKNOWN remain separate from execution status; CAS, events and
intent-bound replay preserve recovery and terminal Attempt bookkeeping atomically.
MemoryStore/SQLite parity, actual process restart and independent writer protection
are evidenced in `CONTEXT_CAPSULE_G7_4_EVIDENCE.md`.

Independent review #3 passed reviewed HEAD `1f9f208d8eef9fabcba02ac93772ff5713612f24`
after two failed reviews and repairs. Final CI `36815496417` succeeded for Node 22
SQLite/full tests and Node 20 compatibility; targeted 77/77, full local regression
669/669. All 25 exit criteria were confirmed, no new D/E issue was found, and Human
authorized governance closure on 2026-10-01.

Receipt proves only Runtime Adapter input receipt, not the final model token
sequence. There is no fixed TTL, history pruning, leases/fencing, new Effect
subsystem or authority upgrade. Legacy runtimeContextFactory remains a separate
compatibility interface. G7 is COMPLETE by evidenced implemented boundaries and explicit deferral: G7.5 remains MISSING / D and DEFERRED — no demonstrated control-loop or G8 dependency; G7.6 is DEFERRED pending demonstrated G8 auditability need. Leases/fencing remain NOT CURRENTLY REQUIRED. G8 is FINAL CONVERGENCE REVIEW READY; final exit review and separate Human completion decision remain required. This does not claim full Blueprint implementation.

### 7.6 G8 readiness and hierarchy repair — historical before Slice 1–4

The read-only readiness audit found a basis for bounded G8 integration validation, not a proven complete control loop. It found an A-class bug allowing cross-project Task→Goal links to pollute another Project's aggregation. Repair `198ba74e26e6f1d4cb42ce612d37dde2947ac863` is independently reviewed CLOSED: shared Task→Goal ownership on create/update/re-parent, Goal project mutation protection, defensive aggregation validation (including terminal ancestors), MemoryStore/SQLite parity and retained Capsule guards. Repair CI `36820265823` succeeded: Node 22 680 pass / 0 fail / 0 skip; Node 20 424 pass / 0 fail / 256 expected SQLite capability skips. No new architecture domain was added.

Remaining G8 proof gaps are authorization ↔ actual execution binding, real Effect, durable/readable result, meaningful verifier, whole-chain restart and adapter substitution. Roadmap, a new Observability system and leases/fencing are not known blockers; existing Event/Command/Run/Attempt/Effect/Capsule/RuntimeRef identities suffice to begin bounded dogfood. This governance update resolves none of these composition proof gaps.

### 7.7 Current G8 reviewed evidence

Slice 1–4 independently reviewed PASS; stability A1/A2 CLOSED. Slice 1/4 prove bounded trusted authorization→actual execution, meaningful content Verification and contract-free hierarchy propagation. Slice 2 proves a real filesystem Effect and UNKNOWN restart reconciliation; Slice 3 proves test-provider-owned durable completed output, live disk resolver and fresh-process recorded-Evidence reproof; Slice 4 proves equivalent independent workloads through LocalProcess and DSH public contract. Production-wide Task→Command enforcement, universal Artifact/result support and arbitrary substitution are not claimed.

Real G8 Workspace proof is READ_ONLY; G6 WRITE/overlay/integration remains separate. Existing LOST outcomes are implemented, but ordinary non-BLOCKED RUNNING reconciliation returns WAIT; fresh adapters cannot rebind live executions. Real in-flight recovery remains DEFERRED / D candidate, not a current exit blocker under reviewed bounded scope; whole-project recovery is unproven. Live DSH installation/host/Agent/model, isolation and result durability remain future dogfood. No new Roadmap/Observability/leases dependency was demonstrated.

G8 is FINAL CONVERGENCE REVIEW READY, not COMPLETE. See ROADMAP's reviewed bounded evidence matrix and Slice 1–4 Evidence review closures. Final exit review and separate Human governance completion are still required.

## 8. Current conflicts and documentation drift

### C-01 — repository identity drift — RESOLVED FOR DOCUMENT AUTHORITY

`AGENTS.md` now declares Project Control OS as the current product direction and defines the governance read order. `docs/architecture.md` is explicitly scoped as **Legacy V0.5 Runtime Architecture**.

The old runtime remains present and valid for its own scope. `package.json` still carries the historical package identity; that remaining packaging question is tracked separately below and does not control document authority.

### C-02 — package/runtime identity drift — CONSCIOUSLY DEFERRED

`package.json` still names/describes the published package surface as `dsh-multi-agent-runtime` version 0.5.0 and exposes legacy runtime scripts.

G1 deliberately does not rename or split the package. Repository-level product direction is governed by the Project Control documents; package publication identity remains historical/legacy-runtime-oriented until a human/product decision changes release scope. This does not block Project Control architecture work.

### C-03 — Node version boundary — RESOLVED AS A CAPABILITY MATRIX

The package declares Node `>=20`. CI now verifies that floor separately from the full persistence baseline.

Historical G1 baseline (not the latest suite count):

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
- that a live DSH Workflow smoke test or DSH Agent Team integration has been proven; the bounded Workflow adapter itself exists;
- that the Roadmap domain is implemented because it appears in architecture documents; Decision, Project-control Memory and Context Capsule are separately evidenced by G7.2/G7.3/G7.4;
- that current local Workspace isolation proves distributed multi-coordinator safety.

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
