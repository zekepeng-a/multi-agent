# Architecture

This document explains the frozen V0.5 architecture to a developer seeing the code for the first time.
**Conceptual model**: *Agents are team members; Models are their brains; Executor adapts Agents to runtimes; Manager is the scheduling/decision hub; Planner is a process inside the Manager — not a second orchestrator.*

## Overall

```
┌─ User Goal ───────────────────────────────────────────────────────┐
│                                                                   │
│  Manager / Orchestrator (orchestrator.mjs)                        │
│   ├─ Planner (two-phase)                                          │
│   │    phase 1: does this need an expert? (LLM judgment)          │
│   │    expert consultation: real Executor call (e.g. Codex)       │
│   │    phase 2: consolidate plan + task DAG (LLM, with context)   │
│   ├─ Plan Precheck (7 checks) — refuse bad plans                  │
│   ├─ Execution loop                                               │
│   │    ready tasks → conflict-free parallel batches               │
│   │    each task: capability match → Agent → Executor → run       │
│   │    command validation → Review Gate (optional per task)       │
│   │    failure → retry → Evaluator → local Replan (new DAG)       │
│   └─ Lifecycle auto-refresh: Distiller + State Summary            │
│                                                                   │
│  Memory chain (derived layer)                                     │
│   Raw history (.ai/runs|reviews|evaluations|messages)             │
│    → Distiller → .ai/memory/{decisions,knowledge,lessons,agents}  │
│    → Retriever → Context Assembly → injected into Planner         │
└───────────────────────────────────────────────────────────────────┘
```

## 1. Manager (`orchestrator.mjs`)

The single decision and scheduling hub. Owns:
- planning (delegated to the Planner process),
- expert consultation,
- plan precheck,
- dependency resolution and scheduling (`computeStatus`),
- worker selection (`pickWorker` — capability scoring over the registry),
- dispatch via the Executor layer,
- command-level validation (`validateTask`),
- retry / evaluation / replan decisions,
- run records and communication.

It is the **only** orchestrator. Nothing else schedules tasks.

## 2. Planner (inside Manager)

Not an independent orchestrator. It is `plan()` within the Manager:

1. **Phase 1** asks the session brain (Manager LLM) whether expert opinions are needed → `expert_consultations`.
2. For each consultation, `consultExpert()` dispatches a **real** task to the matched expert Agent (Architect → Codex etc.) and stores the opinion.
3. **Phase 2** feeds the expert opinions plus **relevant memory** and the **state summary** into the LLM to produce a structured Plan + task DAG.

Planner output = `tasks` array with dependencies, capabilities, acceptance criteria.

## 3. Agent Registry (`.ai/agents/registry.json`)

The team. Each Agent has: `id`, `role`, `backend.type` (which runtime), `capabilities` (scores per skill), `model` (manual binding), `status`, and optional `tools/permissions/skills`.

## 4. Agent

A team member with a role and capabilities. Routing = capability score (`pickWorker`). Backends:
- `claude-code` → Claude Code CLI
- `codex` → Codex CLI (also used by the Architect role)
- `dsh-headless` → DSH session

## 5. Model Binding

`registry.agents[i].model` is **manual configuration**. The orchestrator copies it onto the task and the Executor forwards it (`--model` for claude, `-m` for codex). Changing a model never requires code changes. DSH-headless models are governed by DSH's own `agent-default-model`. There is **no automatic model routing**.

## 6. Executor (`executors.mjs`)

The adapter between Agents and concrete runtimes. One shared skeleton, `executeWithResultFile()`:
- spawns the runtime process,
- waits for a structured result file (`.ai/results/<task>.json`), polling,
- enforces timeout, exit-code handling and a half-written-file retry (race fix),
- normalizes everything into a unified `Result` and `Error` (7 error types).

Classes: `ClaudeCodeExecutor`, `DSHHeadlessExecutor`, `CodexExecutor`. Resolution: `resolveExecutor(backendType)` (unknown types fall back to `claude-code`).

## 7. DAG

`tasks` with `dependencies`. Status per task computed from dependency completion (`computeStatus`): `pending → ready → running → completed/failed`, with `blocked` when a dependency failed.

## 8. Parallel Execution

Each loop iteration gathers ready tasks and builds a **conflict-free batch** (`hasFileConflict` checks declared `relevant_files`/`expected_output` overlap; conflicting tasks serialize to later batches). Batch tasks run concurrently as separate processes via `Promise.all(runTask(...))`, bounded by `MAX_PARALLEL` (default 3).

## 9. Review Gate

For tasks with `requires_review: true`, passing command validation is **not** enough: an independent reviewer process reads the produced files and returns a structured verdict (`PASS`/`FAIL` + checks). **No valid verdict ⇒ conservative FAIL** (never default PASS). FAIL goes into the normal failure pipeline (retry → evaluator → replan).

## 10. Evaluator

On failure after retries are exhausted, `evaluateFailure()` classifies using the **full failure history**:
- transient (timeout, non-zero exit, malformed, process error) → keep retrying (or fail),
- plan-level (validation contradictions, review FAIL, unavailable backend) → **replan**.

## 11. Replan

`doReplan()`: the Manager LLM receives the failed task, its reason, and the current plan, and rewrites the **affected** tasks (fix acceptance, add tasks, change capabilities/dependencies). Completed tasks are preserved — **local replanning**, never a full project rewrite. Bounded by `MAX_REPLAN`.

## 12. Run / Observability

Every dispatch writes a run record (`.ai/runs/<runId>.json` + append-only `runs.jsonl`): agent, model, task, start/end, status, result, files, review, messages, out-of-scope changes. A human-readable report is generated at the end (`.ai/report.md`). Raw run history is the **Source of Truth** and is never modified by the memory layer.

## 13. Memory (derived layer)

`Raw history → Distiller → memory/{decisions,knowledge,lessons,agents}`. Memory is **derived**: deletable and rebuildable; raw history is authoritative. See [memory.md](memory.md).

## 14. Retriever / Context Assembly

`retriever.mjs` scores memory entries against a query deterministically (title×3 + content + tags). `context.mjs` assembles a **bounded** context (token budget, priority: current task > decisions/lessons > knowledge > agent memory), preserving provenance for every entry. Both are read-only.

## 15. State Summary

`state-summary.mjs` generates `.ai/state.summary.md` (goal, status, completed/active tasks, decisions, problems, lessons, next actions) purely from structured data. It is the first thing a new session reads.

## Boundaries (frozen)

- Manager ≠ Planner ≠ Agent ≠ Executor ≠ Memory.
- Agent ≠ Model. Memory ≠ State. Memory = derived; Raw = truth.
- No second orchestrator. No hooks framework yet (documented debt). No embedding/vector DB/auto model routing (by design).
