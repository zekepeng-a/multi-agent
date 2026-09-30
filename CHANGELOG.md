# CHANGELOG.md

This changelog records meaningful architectural and governance evolution. It is not a substitute for Git history and does not list every implementation commit.

## Unreleased — Project Control OS convergence

### Governance

- Added `PROJECT_BLUEPRINT.md` as the project constitution and long-term authority boundary.
- Added `PROJECT_ARCHITECTURE.md` as the current-reality map, explicitly separating implemented, partial, reserved, documented-only, missing and conflicting concepts.
- Added `ROADMAP.md` as the durable development boundary. Phase changes require evidence + review + a Roadmap commit; DSH/GPT reports do not advance phases by themselves.
- Re-scoped `AGENTS.md` from V0.5-only guidance to repository-wide operating rules.
- Re-scoped `docs/architecture.md` as **Legacy V0.5 Runtime Architecture**, preserving history without letting it override Project Control OS authority.
- Established `docs/architecture/decisions/` as the location for durable ADRs resolving D-class architectural gaps.

### Project Control prototype

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
