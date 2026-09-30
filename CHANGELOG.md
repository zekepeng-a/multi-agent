# CHANGELOG.md

This changelog records meaningful architectural and governance evolution. It is not a substitute for Git history and does not list every implementation commit.

## Unreleased — Project Control OS convergence

### Governance

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

Current architecture/reality gaps are tracked in `PROJECT_ARCHITECTURE.md` and ordered in `ROADMAP.md`. Major gaps include durable Command, Effect ledger/reconciliation, Policy, real runtime adapters, Workspace/reality isolation, Roadmap domain, Decision, Project-control Memory, Context Capsule and Project-level Acceptance.

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
