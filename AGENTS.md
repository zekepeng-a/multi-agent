# AGENTS.md — Repository operating rules

> **Current product direction:** Project Control OS.  
> **Legacy implementation present:** DSH Multi-Agent Runtime V0.5.  
> This file tells agents how to work in the repository; it is not the canonical architecture.

## Read order

Before architecture or implementation work, read:

1. `PROJECT_BLUEPRINT.md` — constitution: identity, authority boundaries, frozen invariants.
2. `docs/architecture/PROJECT_CONTROL_OS_ARCHITECTURE.md` — canonical detailed design.
3. `PROJECT_ARCHITECTURE.md` — current implemented reality.
4. `ROADMAP.md` — currently authorized development phase and stop rules.
5. `CHANGELOG.md` and relevant ADRs — evolution and durable decisions.
6. Code, tests and Git history — proof of concrete implementation claims.

If documents disagree with code/tests/Git about what is implemented, surface the disagreement. Do not silently normalize it.

## Repository eras

### Project Control OS

Current product direction. Implementation lives primarily under `project-control/`.

Project Control owns project intent/state/acceptance/recovery semantics above replaceable runtimes. A runtime or agent may execute work; it does not become Project State authority.

### Legacy DSH Multi-Agent Runtime V0.5

The root runtime files remain a real, useful implementation:

- `orchestrator.mjs`
- `executors.mjs`
- `planner-lifecycle.mjs`
- `file-wait.mjs`
- `distiller.mjs`
- `retriever.mjs`
- `context.mjs`
- `state-summary.mjs`
- `.ai/agents/registry.json`

Its architecture is documented in `docs/architecture.md`, which is explicitly **legacy-runtime scope**.

The V0.5 freeze applies to that runtime architecture. It does not override the Project Control OS Blueprint.

## Non-negotiable working rules

1. **Agent ≠ Model.** Agent is an execution identity/team member; Model is a binding/configuration.
2. **Runtime ≠ Project Control.** DSH/Claude Code/Codex/OpenCode/Workflow/Team are execution substrates.
3. **Report ≠ truth.** DSH/GPT output is evidence to verify against Git/current reality.
4. **Plan ≠ roadmap authority.** A model suggestion does not change `ROADMAP.md`.
5. **Do not cross phase boundaries.** Work only inside the active Roadmap phase.
6. **Classify changes A/B/C/D/E before implementation:**
   - A Implementation Bug → fix + regression proof.
   - B Missing Implementation → implement settled design.
   - C Architectural Conflict → resolve against Blueprint/invariants.
   - D Architectural Gap → stop coding; focused research + ADR first.
   - E Direction Change → return to human.
7. **Do not alter I-01..I-45 inside an implementation task.**
8. **UNKNOWN external effect means reconcile, not blind retry.**
9. **No agent/runtime directly manufactures accepted Project State.**
10. **Do not build missing modules for architectural completeness alone.**

## Current active boundary

Read `ROADMAP.md` for the authoritative phase.

At the time this guidance was rewritten, governance convergence (G0) was active. Do not rely on that sentence after the Roadmap changes; the Roadmap file is authoritative.

A phase changes only when its exit gate is evidenced and the Roadmap status changes in Git.

## Project Control code map

| Path | Role |
|---|---|
| `project-control/domain.mjs` | domain records/status vocabulary/invariants |
| `project-control/store.mjs` | shared durable control semantics |
| `project-control/memory-store.mjs` | in-memory backend primitives |
| `project-control/sqlite-store.mjs` | SQLite backend primitives |
| `project-control/controller.mjs` | reconciliation/control decisions for implemented scope |
| `project-control/fake-runtime.mjs` | deterministic test runtime |
| `project-control/fake-verifier.mjs` | deterministic test verifier |
| `tests/unit/project-control-*.test.mjs` | Project Control unit/contract tests |
| `tests/integration/persistence.test.mjs` | restart/transaction persistence proof |

## Legacy runtime map

| Path | Role |
|---|---|
| `orchestrator.mjs` | V0.5 Manager/orchestration |
| `executors.mjs` | legacy runtime adapters |
| `planner-lifecycle.mjs` | planner artifact lifecycle/identity |
| `distiller.mjs` | raw legacy history → derived memory |
| `retriever.mjs` | legacy memory retrieval |
| `context.mjs` | legacy context assembly |
| `state-summary.mjs` | legacy state summary generation |
| `.ai/agents/registry.json` | legacy Agent/model bindings |

Legacy rules remain:

- Model binding is manual; no automatic model routing.
- Legacy Memory is derived from raw history and may be rebuilt.
- Core runtime changes must preserve its own test expectations unless a roadmap item explicitly authorizes migration/refactor.

## Testing discipline

- Production/code changes require relevant tests.
- Full baseline is `npm test` unless a narrower task explicitly says otherwise.
- Real external-runtime E2E must be labeled separately from deterministic unit/integration tests.
- A report claiming tests passed is not equivalent to observing the test result when the claim matters to a phase exit.

## ADR rule

Use `docs/architecture/decisions/` for durable decisions that resolve a D-class architectural gap or materially settle a contested boundary.

An ADR must state:

- context/problem;
- decision;
- alternatives considered;
- consequences/tradeoffs;
- invariants affected;
- external evidence/precedent when used;
- implementation boundary;
- status.

Do not create an ADR for routine bug fixes.

## Stop conditions

Stop and report instead of self-expanding when work discovers:

- a D-class architectural gap;
- an E-class direction change;
- conflict with a frozen invariant;
- an UNKNOWN external effect;
- necessary work outside the active Roadmap phase;
- missing evidence required to claim a phase exit.
