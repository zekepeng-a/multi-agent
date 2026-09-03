# Usage

All commands below are real commands from this repository. The runtime is CLI-based (a Web UI belongs to a future release).

## 1. Start / run a goal end-to-end

```bash
node orchestrator.mjs "实现一个 Todo API 的 storage 模块，架构咨询 architect" --workdir /path/to/project
```

What happens (logs are printed to stdout; the event log is `.ai/logs/orchestrator.log`):
1. Planner phase 1 — decide whether experts are needed (may dispatch a real Architect consultation).
2. Planner phase 2 — produce plan + task DAG (`.ai/tasks.json`).
3. Plan Precheck — 7 checks; a bad plan is refused (`exit code 3`, `.ai/precheck.json`).
4. Execution loop — batches of independent tasks run in parallel; each task is validated, then (if flagged) reviewed.
5. Failures retry, then are evaluated; plan-level failures trigger local replanning.
6. Memory + state summary auto-refresh after every batch; final report at `.ai/report.md`.

Exit code `0` = all tasks terminal-complete. Failures that exhaust retries/replans still finish with 0 but are marked `failed` in `.ai/tasks.json` — check the summary line or `.ai/state.json`.

## 2. Re-run with an existing plan (no replanning)

```bash
node orchestrator.mjs "goal" --workdir /path/to/project --skip-plan
```

Uses the current `.ai/tasks.json`. Useful for retrying or continuing a project.

## 3. Inspect tasks

Read `.ai/tasks.json` (goal, plan, tasks with status/dependencies/assigned agent/retries).

```bash
node -e "const t=require('/path/to/project/.ai/tasks.json'); for(const x of t.tasks) console.log(x.id, x.status, x.assigned_agent||'')"
```

## 4. Inspect agents

Read `.ai/agents/registry.json` (team, capabilities, backend, model).

## 5. Inspect runs

Each dispatch produced a run: `.ai/runs/<taskId>-<ts>.json` plus the append-only `.ai/runs/runs.jsonl`. Human summary: `.ai/report.md`.

## 6. Inspect / rebuild memory

```bash
node distiller.mjs --workdir /path/to/project          # distill raw history → memory
node distiller.mjs --workdir /path/to/project --verbose
```

Memory lives under `.ai/memory/{decisions,knowledge,lessons,agents}`. Delete that folder and re-run to rebuild from raw history.

## 7. Inspect / regenerate the state summary

```bash
node state-summary.mjs --workdir /path/to/project
# → .ai/state.summary.md
```

## 8. Inspect failures / replans

- Failure reasons: `.ai/evaluations/<taskId>.json` (verdict + suggested action).
- Review verdicts: `.ai/reviews/<taskId>.json`.
- Replan history: `replan_count` in `.ai/tasks.json`; distilled decisions in `.ai/memory/decisions/`.

## Requires external runtimes

End-to-end goals need real Claude/Codex/DSH CLIs and their credentials on your machine. Pure logic (planning checks, distillation, retrieval, context budget, summaries) runs without them — see `tests/` and [testing.md](testing.md).
