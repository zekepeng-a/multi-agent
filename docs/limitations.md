# Limitations & Known Issues

Honest list. Future plans are **not** described as current capabilities.

## Stability

- **Worker / Reviewer CLI processes occasionally exit unexpectedly** (exit code 1, no result file, typically seconds in). The runtime handles this safely — retries (×2) for workers, conservative **FAIL** for reviewers when no valid verdict arrives — but the underlying process flakiness is an environment issue, not yet fixed. Reviewer calls do not retry yet.

## Architecture gaps (by design / deferred)

- **No standalone Verifier role.** The Review Gate performs semantic verification; there is no separate verifier process.
- **No Hook framework.** There is no pre/post hook system (ExcelManus-style) yet; lifecycle refresh is a direct call in the orchestrator.
- **No automatic Model Routing.** Models are manually bound per Agent. This is a deliberate constraint.
- **No embedding / vector DB.** Retrieval is BM25-like keyword matching (English words + Chinese 2-grams). No semantic embeddings, no vector store.
- **No graph memory / conflict arbitration.** Decisions have a reserved `supersedes` field; automatic conflict resolution is not implemented.
- **`orchestrator.mjs` is a single large file** (~700+ lines) holding Manager responsibilities (planning, scheduling, review, replan, runs, communication). Correct and tested, but a refactor target — frozen for now.
- **Planner is a process inside the Manager**, not an independent module/service.

## Reproducibility / portability

- **`dsh-headless` executor entry path** defaults to the author's machine (`C:\Users\ADMIN\...`). Override via `DSH_ORCH_DSH_ENTRY`. The default must be changed/overridden on other machines.
- **External agent CLIs depend on local environment** (PATH, auth/accounts for Claude/Codex/DSH). Unit/integration tests do not need them; real E2E does.
- Registry template is committed (`.ai/agents/registry.json`); all other `.ai/` content is runtime state and git-ignored.

## Precision

- Lesson failure-pattern extraction is approximate: generic ALL_CAPS words in a reason (e.g. `FAIL`) can enter the pattern; it does not break same-pattern aggregation but is noisy.
- Chinese segmentation is naive 2-grams; short keywords can over/under-match.
- Character-based token budget (`estimateChars`) approximates real tokenizers.

## Knowledge gaps

- Web UI does not exist yet (CLI only).
- No multi-project dashboard, no distributed/remote orchestration.
