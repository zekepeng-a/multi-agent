# DSH Multi-Agent Runtime

A **DSH-powered Multi-Agent Runtime** that turns one goal into a coordinated team of coding agents: it plans, consults experts, builds a task DAG, executes in parallel, reviews, evaluates, replans, and **learns across sessions** through a derived, retrievable project memory.

> **Status**: V0.5 (architecture frozen). This is an open-source hardening pass — docs, reproducible tests, and configuration — not new features.

## What is this?

Give it a goal, e.g. *"design an architecture for a multi-module Node CLI and implement a JSON storage module with tests"*. The runtime will:

1. **Plan** — a Manager decides whether an expert (e.g. Architect) is needed, consults it for real, and turns the goal into a **task DAG**.
2. **Precheck** — validates the plan (dependency cycles, capability coverage, file conflicts) before executing anything.
3. **Execute** — dispatches tasks to **Agents** (Claude Code, Codex, DSH headless) through a unified **Executor** layer, running independent tasks **in parallel** with **file-conflict protection**.
4. **Review** — every `requires_review` task must pass a **Review Gate** (independent reviewer) before being marked done. No reviewer verdict ⇒ conservative FAIL.
5. **Recover** — failures are classified: transient errors retry; plan-level problems trigger **local replanning** (the Manager edits the plan, not just retries).
6. **Remember** — every run/review/evaluation is distilled into **structured project memory** (decisions, lessons, knowledge, agent stats). New sessions retrieve only the *relevant* memory — **a new conversation is never a blank slate**.

## Why a Multi-Agent Runtime?

- One LLM call in a chat cannot hold a whole project, retry robustly, enforce review, or remember yesterday's failure pattern.
- Separating **Agents (team members)** from **Models (their brains)** lets you keep architecture skills in one runtime and implementation in another, and swap models without touching code.

## Agent ≠ Model

**Agents are team members.** They live in the Agent Registry with a role, capabilities, backend and bound model.

| Agent (role) | Runtime (backend) | Model (bound, manual) |
|---|---|---|
| `manager` | orchestrator (DSH) | — (session brain) |
| `architect` | **Codex CLI** | `deepseek/deepseek-v4-pro` |
| `codex` | Codex CLI | `deepseek/deepseek-v4-pro` |
| `claude-code` | **Claude Code CLI** | *(empty ⇒ Claude settings default)* |
| `dsh-agent` | **DSH headless** | DSH `agent-default-model` |
| `dsh-analyst` / `dsh-reviewer` | DSH subagent | *(disabled: subagent is session-only)* |
| `doubao` | manual (GUI) | *(disabled)* |

The **model is configuration**, never hard-coded to a role. Editing `registry.json` to bind a different model to an Agent requires **zero code changes** (verified).

## Core capabilities

- Two-phase Planner (expert judgment → expert consultation → consolidated plan)
- Plan Precheck (7 checks) before execution
- Task DAG + dependency resolution + **parallel batches** (bounded concurrency) + **file-conflict detection** (conflicting tasks serialize)
- Unified Executor: `claude-code` / `dsh-headless` / `codex` (open-ai compatible) with a shared Result/Error contract
- Evaluator (transient failure vs plan problem) → **local Replanning** (Manager rewrites tasks)
- Review Gate (`todo → running → review → done`; conservative FAIL fallback)
- Agent communication (file-message channel, Manager-mediated)
- Run observability (`.ai/runs/*.json` + JSONL + auto-generated report)
- **Project Memory** (derived layer): Distiller → `memory/{decisions,knowledge,lessons,agents}` → Retriever (BM25-like) → Context Assembly (token budget) → State Summary → Planner
- Lifecycle auto-refresh of Memory + State Summary after every batch

## System architecture

```
User goal
  → Manager (orchestrator.mjs)
      → Planner (two-phase, + expert consultation)
      → Plan Precheck (7 checks)
      → Task DAG → parallel batches (conflict-free)
          → Agent (registry) → Model binding → Executor (claude/codex/dsh)
          → command validation → Review Gate
          → failure: retry → Evaluator → Replan (new DAG)
      → Run records (source of truth)
  → Distiller → Memory (derived) → Retriever → Context Assembly → back to Planner
  → State Summary (.ai/state.summary.md) for new sessions
```

See **[docs/architecture.md](docs/architecture.md)** and **[docs/memory.md](docs/memory.md)**.

## Requirements

- **Node.js ≥ 20** (developed on 24)
- **DSH** (the orchestrator runs as a plain Node script; the `dsh-headless` executor drives DSH sessions for analyst tasks)
- At least one worker runtime:
  - **Claude Code CLI** (`claude` on PATH) — default worker
  - **Codex CLI** (`codex` on PATH) — used by `architect` / `codex` agents
  - **DSH** — used by `dsh-agent` (analyst/researcher)
- Real LLM access for whichever backend you enable. Worker CLIs require their own auth (Claude subscription / Codex provider / DSH models).

## Installation

```bash
git clone <repo>
cd dsh-multi-agent-runtime
npm install   # no runtime deps today; installs nothing extra
```

Point the DSH headless executor at your DSH installation if it is not already on PATH:

```bash
export DSH_ORCH_DSH_ENTRY="/absolute/path/to/dsh/lib/bin.js"   # Windows: set env var
```

See **[docs/installation.md](docs/installation.md)**.

## Configuration

- **Agent Registry**: `.ai/agents/registry.json` — team members, capabilities, backend, model binding. (The committed file is the template; `.ai/` runtime state is git-ignored.)
- **Models**: edit `model` in the registry (manual binding, no auto-routing).
- Everything else via environment / CLI flags.

See **[docs/configuration.md](docs/configuration.md)**.

## Running

```bash
# Run one goal end-to-end in a project workspace:
node orchestrator.mjs "your goal here" --workdir /path/to/project

# Distill memory from raw history (also runs automatically after each batch):
node distiller.mjs --workdir /path/to/project

# Regenerate the project state summary:
node state-summary.mjs --workdir /path/to/project
```

See **[docs/usage.md](docs/usage.md)**.

## Testing

```bash
npm test            # unit + integration (no external runtime required)
npm run test:unit
npm run test:integration
```

Tests marked **`requires external runtime`** (real Claude/Codex/DSH E2E) are deliberately separate — see **[docs/testing.md](docs/testing.md)**.

## Adding a new Agent

1. Add an entry to `.ai/agents/registry.json` with `id`, `role`, `backend.type` (one of the registered executor types), `capabilities`, and an optional `model`.
2. If the backend is a new runtime, add an executor class + register it in `executors.mjs`.
3. Tasks will be routed by capability score automatically.

## Current limitations

- Reviewer/Worker CLI processes occasionally exit unexpectedly (handled safely: conservative FAIL / retry).
- No standalone Verifier, no Hook framework, no embedding/vector DB, no auto Model Routing (by design).
- Retriever is BM25-like keyword matching (Chinese 2-gram); no semantic embeddings yet.
- `orchestrator.mjs` is a single large file (correct, but a refactor target).
- External agent CLIs depend on your machine environment.

See **[docs/limitations.md](docs/limitations.md)**.

## Repository layout

```
orchestrator.mjs      # Manager: planning, scheduling, review, replan, run records
executors.mjs         # Executor adapters (claude-code / dsh-headless / codex)
distiller.mjs         # Raw history → derived project memory
retriever.mjs         # BM25-like retrieval over memory
context.mjs           # Context assembly with token budget
state-summary.mjs     # Project state summary generator
tests/                # unit + integration (node:test)
docs/                 # architecture, memory, installation, configuration, usage, testing, limitations
```
