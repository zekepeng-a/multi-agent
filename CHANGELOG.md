# CHANGELOG.md

This changelog records meaningful architectural and governance evolution. It is not a substitute for Git history and does not list every implementation commit.

## Unreleased — Project Control OS convergence

### Governance

- **G8 bounded evidence governance convergence (2026-10-01):** Slice 1 real authorized execution/meaningful Verification and stability A1/A2 repair independently passed; Slice 2 real Effect/reconciliation, Slice 3 durable completed-result restart reproof and Slice 4 adapter substitution independently passed. Reviewed test/Evidence HEAD `7dad1894f802bdd6076a9320731c918a7a765e0a`, CI `36857097373` (Node 22 810/0/0; Node 20 481/0/329 expected skips). Test-side Slices 2–4 added no production architecture expansion. G8 is FINAL CONVERGENCE REVIEW READY, not COMPLETE; final exit review and separate completion commit are next. In-flight recovery remains deferred provider-specific D; live DSH/write dogfood are not current blockers. Roadmap/Observability/leases are unchanged. Historical submission/failure/repair records are retained.

- **G7 convergence governance closeout (2026-10-01):** Human authorized COMPLETE through G7.1–G7.4's independently evidenced boundaries and explicit deferral. G7.5 remains MISSING / D, DEFERRED — no demonstrated control-loop or G8 dependency; reactivate only on a concrete requirement or G8 failure scenario. G7.6 is DEFERRED — reactivate only on demonstrated G8 auditability need, not COMPLETE. Leases/fencing remain NOT CURRENTLY REQUIRED. G8 becomes NEXT; actual dogfood requires a separate authorized task. This does not claim full Blueprint implementation or change accepted ADRs/invariants. Earlier phase-time entries and failed review history are retained.

- **G8 readiness hierarchy repair independently CLOSED:** audit found cross-project Task→Goal aggregation pollution; reviewed repair HEAD `198ba74e26e6f1d4cb42ce612d37dde2947ac863` adds shared ownership, create/update/re-parent and Goal project mutation protection, defensive aggregation, backend parity and retained Capsule guards. CI [36820265823](https://github.com/zekepeng-a/multi-agent/actions/runs/36820265823) succeeded: Node 22 680 pass / 0 fail / 0 skip; Node 20 424 pass / 0 fail / 256 expected SQLite skips. This is A-class implementation bug closure, not a new architecture domain. Readiness supports bounded integration validation, not a proven full G8 loop; remaining proof gaps are authorization/execution binding, real Effect, durable/readable result, meaningful verifier, whole-chain restart and adapter substitution. Roadmap/new Observability/leases are not known blockers. This commit records governance only.

- **G7.4 Context Capsule governance closeout (2026-10-01):** Human authorized COMPLETE after review #3 passed all 25 accepted ADR-0009 exit criteria at implementation HEAD `1f9f208d8eef9fabcba02ac93772ff5713612f24`. Final CI [36815496417](https://github.com/zekepeng-a/multi-agent/actions/runs/36815496417) succeeded for Node 22 SQLite/full tests and Node 20 compatibility; targeted 77/77, full local regression 669/669. Review #1 failed on three implementation defects; review #2 closed them but found Attempt bookkeeping P2; after repair, review #3 passed with no new D/E issue. Failure and repair history remains in `CONTEXT_CAPSULE_G7_4_EVIDENCE.md`. G7.1–G7.4 are COMPLETE; G7 remains active. G7.5 is D / queued and not authorized for research or implementation; G7.6 depends on G8 need, leases/fencing remain NOT CURRENTLY REQUIRED. This commit changes governance only.

- **G7.4 Context Capsule architecture gate resolved:** Human accepted ADR-0009 on 2026-09-30 after bounded inventory and source/test research. G7.4 moves D → B — Missing Implementation. Accepted v1 choices include immutable single-Attempt full input snapshots, all ACTIVE project Decisions by default, required-content byte-budget failure, supplemental-drift regeneration, Adapter-boundary receipt only, UNKNOWN without blind resend, and no fixed TTL/history cleanup/leases/new Effect subsystem. This commit changes governance only; Capsule remains unimplemented and implementation execution requires a separate authorized task. G7.5 is not advanced.

- **G7.3 Memory governance closeout:** independent implementation review accepted HEAD `973f77e2d231ee6eaa4e9b348ebf2424da41f674`, found no new D/E issue or ADR-0008 authority/lifecycle violation, and confirmed CI run `36724720686` success. With explicit human authorization, ROADMAP now records G7.3 COMPLETE. G7 remains active; G7.4 Context Capsule is the next candidate with its own unresolved D-GATE. This closeout authorizes no Capsule research or coding.

- **G7.3 Memory architecture gate resolved:** human accepted `ADR-0008-project-control-memory-boundary.md`, including all-required current sources, no STALE resurrection, INFERRED opt-in and PROJECT_STATE exact-version invalidation. The bounded gap is now B — Missing Implementation. This governance-only acceptance does not implement Memory or complete G7.3; implementation execution is reserved for a subsequent task.

- **G7.2 Decision architecture gate resolved:** focused Agent Harness + ADR Tools evidence established proposal≠Decision, human direction precedence, mandatory provenance and append/supersede history. Accepted `ADR-0007-decision-authority-lifecycle.md`; bounded implementation is now allowed.

- **G6 architecture gate resolved:** targeted Agent Harness, DSH Agent Team, ExcelManus and Earthwalker Agent OS review established a conservative Workspace rule: parallel writers require distinct isolated roots, write scopes must be enforced, and only the control plane integrates patches into shared reality. Accepted `ADR-0005-workspace-isolation-boundary.md`.

- **G5 architecture gate resolved:** targeted DSH Workflow/Subagent/Agent Team and Codingns4DSH review established a capability-shaped Runtime Adapter. Accepted `ADR-0004-runtime-adapter-boundary.md`; implementation may now add normalized runtime contracts, a real LocalProcess adapter, and a DSH Workflow adapter without promoting runtime identities into Project State.

- **G4 architecture gate resolved:** targeted source review traced command policy and normalized policy-decision patterns from Agent Execution Harness and AgentLedger; accepted `ADR-0003-policy-approval-composition.md`. Policy may now be implemented as a deterministic gate with immutable PolicyDecision audit facts; Approval only satisfies REQUIRE_APPROVAL and never overrides DENY.

- **G3 architecture gate resolved:** accepted `ADR-0002-effect-reconciliation-boundary.md`. External effects must be persisted before dispatch, ambiguous outcomes become UNKNOWN, and retry is blocked until reconciliation. The bounded Effect implementation is now allowed; real runtime integration remains outside G3.

- **G2 architecture gate resolved:** accepted `ADR-0001-durable-command-boundary.md`. Durable Command is now defined as stored immutable intent + versioned authorization state; G2 may implement only `CREATED/AUTHORIZED/REJECTED`. Dispatch, Effect, UNKNOWN and retry/re-dispatch remain blocked until G3.

- **G1 Baseline hardening completed.** GitHub Actions now separates the Node 20 package-floor check from the Node 22 full SQLite baseline. The full baseline is 435/435 with 0 skipped on Node 22.23.3; detailed evidence is recorded in `docs/architecture/BASELINE_EVIDENCE.md`. The Roadmap boundary advanced to G2's architecture gate; Command coding remains blocked until an ADR is accepted.
- **G0 Governance convergence completed.** The durable boundary moved to G1 Baseline hardening only after governance/read-order, legacy-runtime scoping, reality map, Roadmap, Changelog and ADR convention existed in Git.

- Added `PROJECT_BLUEPRINT.md` as the project constitution and long-term authority boundary.
- Added `PROJECT_ARCHITECTURE.md` as the current-reality map, explicitly separating implemented, partial, reserved, documented-only, missing and conflicting concepts.
- Added `ROADMAP.md` as the durable development boundary. Phase changes require evidence + review + a Roadmap commit; DSH/GPT reports do not advance phases by themselves.
- Re-scoped `AGENTS.md` from V0.5-only guidance to repository-wide operating rules.
- Re-scoped `docs/architecture.md` as **Legacy V0.5 Runtime Architecture**, preserving history without letting it override Project Control OS authority.
- Established `docs/architecture/decisions/` as the location for durable ADRs resolving D-class architectural gaps.

### Project Control prototype

- **G7.4 Context Capsule implemented within ADR-0009.** Immutable per-Attempt canonical payload/hash and typed source manifest, required/supplemental UTF-8 budget, dispatch freshness/selection completeness, current-use Memory, receipt/UNKNOWN, transactional terminal bookkeeping, CAS/replay, MemoryStore/SQLite parity, real restart and independent-writer protection are evidenced. LocalProcess/DSH receipt proves only Adapter input, not final model tokens. No fixed TTL, history pruning, leases/fencing, new Effect subsystem or authority upgrade.

- **G7.3 Project-control Memory completed within ADR-0008.** Added trusted validation/Control Plane promotion, closed type/confidence/source admission, pinned source resolution and CURRENT/INVALID/UNRESOLVED validity, attributable staling, no STALE resurrection, atomic new-id supersession, eligibility-before-ranking queries, INFERRED opt-in and separate history. MemoryStore/SQLite parity, optimistic concurrency, events, intent-bound replay and real process restart/concurrent-writer proof are recorded in `docs/architecture/MEMORY_G7_3_EVIDENCE.md`. Verified final implementation CI: 592 passed, 0 failed, 0 skipped on Node 22. Legacy runtime and Decision/Approval/Policy/Acceptance authority remain unchanged; G7.4 is not implemented.

- **G7.2 Project Decision completed.** Added durable Decision authority (HUMAN/CONTROL_PLANE only), mandatory provenance, immutable decision meaning, ACTIVE→SUPERSEDED/REVOKED lifecycle, supersession lineage, attributable revocation and SQLite restart proof. Verified CI: 533/533, 0 skipped on Node 22.23.3.

- **G7.1 Project-level Acceptance completed.** Project now supports optional pinned PROJECT Acceptance revisions, deterministic Milestone aggregate Evidence, stale-evidence re-proof, PASS Verification gating and atomic Project COMPLETED + contract PASSED. Contract-free aggregate completion remains compatible. Verified CI: 518/518, 0 skipped on Node 22.23.2.

- **G6 Workspace / Reality / concurrency completed for the bounded local provider.** Added durable Workspace identity, SHARED/ISOLATED local roots, enforced write scopes, deterministic revision digests, touched-path conflict detection, deterministic integration order, optional Evidence workspace lineage and SQLite restart proof. Verified CI at the G6 test head: 501/501, 0 skipped on Node 22.23.2. See `docs/architecture/WORKSPACE_G6_EVIDENCE.md`.

- **G5 Runtime Adapter completed.** Added normalized capability-shaped runtime contracts, migrated FakeRuntime, added a real LocalProcessRuntimeAdapter and a DshWorkflowRuntimeAdapter over the public workflow seam, persisted opaque runtime refs on Attempts, and proved real-process execution plus restart identity separation. Full verified CI: 492/492, 0 skipped on Node 22.23.2.

- **G4 Policy / Approval composition completed.** Added deterministic StaticPolicyEngine, immutable PolicyDecision audit facts, ALLOW/DENY/REQUIRE_APPROVAL composition, deny precedence, per-attempt policy re-evaluation, backend parity and cross-process persistence proof. Full verified CI: 484/484, 0 skipped on Node 22.23.2.

- **G3 External Effect + reconciliation completed.** Added durable Effect records, persist-before-dispatch ordering, typed SUCCEEDED/FAILED_NO_EFFECT/UNKNOWN outcomes, fake effect driver, UNKNOWN retry prohibition, reconciliation with observation references, replay safety, and a real cross-process orphaned-DISPATCHED recovery proof. Full CI at the verified G3 head: 467/467, 0 skipped on Node 22.23.2.

- **G2 Durable Command completed.** Added a separate durable Command domain with stored immutable intent, MemoryStore/SQLite persistence, optimistic command versioning, CREATED→AUTHORIZED/REJECTED transitions, event history and restart proof. Existing store-mutation command replay rows remain separate. Full CI at the verified G2 head: 450/450, 0 skipped on Node 22.23.3.

The `project-control/` branch work introduced a separate control-plane prototype above runtimes:

- Project / Milestone / Goal / Task hierarchy with child-side relationship authority.
- Acceptance Contract revision pinning.
- Run and Attempt as separate execution identities.
- Evidence and Verification as separate proof/judgement records.
- Task acceptance flow and NEEDS_REVIEW re-verification.
- Goal/Milestone aggregate Evidence and parent Acceptance.
- LOST Attempt reconciliation with `confirmed_no_effect`, `confirmed_completed`, and `unknown`; UNKNOWN does not permit blind retry.
- Shared store semantics with MemoryStore and SQLite backends.
- version-aware optimistic concurrency, transactional state/event/idempotency persistence, restart tests.
- durable human Approval lifecycle with attribution, target-version binding, expiry/revocation and action/capability/scope matching.

### Approval boundary hardening

Commit `e7a0a7d07356980d5ba9c49be5ebfa06a1bebad8`:

- made Approval capability a mandatory authorization dimension;
- added `CAPABILITY_MISMATCH`;
- reserved but disabled COMMAND-target Approval because Command is not yet a durable control object;
- added invariants I-44 and I-45;
- strengthened unit/integration coverage around capability and legacy COMMAND records.

### Known current gaps

Current architecture/reality gaps are tracked in `PROJECT_ARCHITECTURE.md` and ordered in `ROADMAP.md`. G0–G7 have converged within bounded gates and explicit deferrals; G7.1–G7.4 are COMPLETE, while Roadmap remains MISSING / D / DEFERRED and Observability remains unimplemented / DEFERRED pending demonstrated G8 auditability need. Leases/fencing remain NOT CURRENTLY REQUIRED. G8 is NEXT, with actual dogfood requiring separate authorization; the full control loop is not yet proved. Broader production/provider/distributed capabilities and full Blueprint implementation are not implied. Earlier changelog entries retain their milestone-time status and test counts.

## V0.5 — Legacy DSH Multi-Agent Runtime

The repository previously converged on a self-contained DSH Multi-Agent Runtime with:

- Manager/orchestrator;
- two-phase Planner and planner artifact lifecycle;
- Agent registry and manual Model binding;
- Executor adapters;
- DAG scheduling and bounded parallel execution;
- Review/Evaluator/Replan loop;
- raw run history;
- derived Memory, Retriever, Context assembly and State Summary.

The V0.5 runtime architecture remains valid for that subsystem and is documented in `docs/architecture.md`. It is no longer the top-level product definition.
