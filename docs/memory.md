# Memory

Project memory is a **derived layer**. Raw execution history is the Source of Truth; memory can be deleted and regenerated at any time.

## Full chain

```
Raw history (Source of Truth)
  .ai/runs/*.json + runs.jsonl      # run records
  .ai/reviews/*.json                # review verdicts
  .ai/evaluations/*.json            # failure classifications
  .ai/consultations/*.md            # expert opinions
  .ai/messages/*.json               # agent messages
  .ai/results/<task>.json           # worker results
        │
        ▼  distill  (distiller.mjs; runs automatically after each batch + manually)
Derived memory
  .ai/memory/decisions/  # technical decisions (with supersedes chain)
  .ai/memory/knowledge/  # expert opinions / long-lived facts
  .ai/memory/lessons/    # failure lessons (aggregated by failure pattern)
  .ai/memory/agents/     # per-agent stable stats (upsert, not append)
        │
        ▼  retrieve  (retriever.mjs — BM25-like, read-only)
Ranked, relevant entries
        │
        ▼  assemble  (context.mjs — token budget + priority)
Bounded context (current task + relevant decisions/lessons/knowledge/agent memory,
with provenance) → injected into the Planner prompt
        │
        ▼
state-summary.mjs → .ai/state.summary.md (first thing a new session reads)
```

## Source of Truth vs derived

| Raw (never modified by memory code) | Derived (rebuildable) |
|---|---|
| runs, reviews, evaluations, consultations, messages, results | decisions, knowledge, lessons, agents, state.summary.md |

Deleting `.ai/memory/` and re-running `node distiller.mjs --workdir <project>` regenerates everything from raw history (verified).

## Distillation rules (deterministic; no LLM)

| Raw | → | Memory | Rule |
|---|---|---|---|
| review verdict FAIL | → | lesson | "Review 否决: <task>" + reason |
| evaluation replan/FAIL | → | lesson | "任务被评估为计划问题" |
| tasks.json replan_count | → | decision | "计划修订 #N" (supersedes chain reserved) |
| consultation .md | → | knowledge | expert opinion (role + topic) |
| runs | → | agent_memory | stable per-agent stats (completed/failed/tasks) |

## Provenance

Every entry carries `source: { kind, task_id?, agent?, file? }` pointing back to the raw file. If provenance cannot be determined it is explicitly marked `unknown` — never fabricated. `lesson`/`agent_memory` keep a `recent_sources` trail (last 5).

## Deduplication & aggregation

- **decisions / knowledge**: content-hash stable ID → re-running is a no-op (`added=0`).
- **lessons**: stable ID from a deterministic **failure-pattern signature** (UPPER_SNAKE tokens with trailing digits normalized, or failure type). Recurrences of the same pattern **update** the existing lesson instead of creating duplicates.
- **agent_memory**: stable **per-agent** ID (`agent_memory-<agent>`), updated in place when stats change.

## Retrieval

`retriever.mjs` tokenizes queries (English words + Chinese 2-grams) and scores entries deterministically: title hits ×3, content hits ×1, tag hits ×2. `score = 0` entries never enter results; results are sorted descending; `typeFilter`/`topK` supported.

## Context Assembly & budget

`context.mjs` `assembleContext()` groups results into sections and packs them under a character budget (`estimateChars()`). Priority: **current task (never trimmed) > decisions/lessons > knowledge > agent memory**; within a type, score order. When budget runs out, the lowest-priority tail is dropped. Every selected entry keeps its provenance.

## State Summary

`generateStateSummary()` reads tasks/state/memory/project.md and writes `.ai/state.summary.md` with: goal, current status, completed/active tasks, important decisions, known problems, recent lessons, agent/task status, next recommended actions. Read-only on raw data; idempotent; delete-and-regenerate safe.

## Lifecycle refresh

The orchestrator calls `refreshMemoryAndState()` (distill + summary) after every batch and at the end — always after the latest state has been persisted, so distilled memory reflects final task states. Failures here are isolated (`try/catch` per step, logged only) and never affect task outcomes or raw history.
