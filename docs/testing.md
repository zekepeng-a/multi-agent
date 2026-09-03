# Testing

Tests use **Node's built-in test runner** (`node:test`) — no test-framework dependency. Unit and integration tests need **no external runtime** (no Claude/Codex/DSH). Real E2E that drives external CLIs is kept separate and is marked **`requires external runtime`**.

## Run

```bash
npm test                 # unit + integration (no network/LLM needed)
npm run test:unit
npm run test:integration
```

## Layout

```
tests/unit/
  retriever.test.mjs        # tokenize, scoring, filtering, typeFilter, determinism
  distiller.test.mjs        # review→lesson, pattern aggregation, idempotency,
                            # delete/rebuild, per-agent aggregation, replan→decision,
                            # malformed-data tolerance
  context.test.mjs          # budget never exceeded, current task never trimmed,
                            # priority, provenance, irrelevant filtering, read-only
  state-summary.test.mjs    # 9 sections, data provenance, idempotent, read-only
tests/integration/
  executors.test.mjs        # executor resolver, registry structure, Agent≠Model
```

## What the tests cover (map to capabilities)

| Capability | Where |
|---|---|
| Retriever ranking/filtering | `retriever.test.mjs` |
| Distiller dedup + aggregation + rebuild | `distiller.test.mjs` |
| Context token budget + priority | `context.test.mjs` |
| State summary generation | `state-summary.test.mjs` |
| Executor resolver + registry/Agent≠Model | `executors.test.mjs` |
| Reviewer-no-verdict ⇒ FAIL, Replan, Communication, DAG, parallel, conflict, retry | **E2E below** |

## E2E (`requires external runtime`)

These drive real backends and are intentionally **not** in `npm test` (CI cannot reach your Claude/Codex/DSH credentials):

1. **Smoke worker task** — a project with one simple task:
   ```bash
   node orchestrator.mjs "创建 hello.txt" --workdir <empty project> --skip-plan
   ```
2. **Review → Replan chain** — create a project whose task has `requires_review: true` and a `review_rules` entry that cannot pass; observe `Review FAIL → retry → Evaluator → Replan → new task succeeds` and `replan_count` in `.ai/tasks.json`.
3. **Memory delete/rebuild** — after any E2E, `Remove-Item .ai/memory -Recurse`, re-run `node distiller.mjs --workdir <project>`, verify entries are back.
4. **New-session retrieval** — new goal related to a past lesson; run planner and verify `.ai/logs/orchestrator.log` contains `planner-context memory=N`.

See `docs/usage.md` for the exact commands.
