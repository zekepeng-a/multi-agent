# Legacy V0.5 Asset Extraction Audit

**Status:** FIRST-PASS STATIC AUDIT — RESEARCH EVIDENCE  
**Subject:** Legacy DSH Multi-Agent Runtime V0.5  
**Rule:** legacy code has no automatic inheritance privilege.

## 1. Audit labels

- **KEEP** — implementation/concept has independent value and does not conflict with Project Control authority.
- **REBUILD** — idea is useful, but implementation/protocol should not be carried forward.
- **DEMOTE** — may remain runtime-local/advisory but must not become project truth.
- **RETIRE** — future architecture should not depend on it.
- **EVIDENCE ONLY** — retain as historical failure/learning material.

## 2. System-level verdict

V0.5 is best classified as:

> **valuable but epistemically unsafe research prototype**

It contains useful execution ideas, but its Planner/Manager/Memory loop can turn model-generated conclusions into future model context without sufficient independent truth promotion.

Do not continue a V0.6 feature line by default.

## 3. Asset disposition

| Asset | Disposition | Reason / future boundary |
|---|---|---|
| `orchestrator.mjs` Manager as global authority | RETIRE | mixes planning, scheduling, validation, review, replan, state and memory; conflicts with Project Control authority |
| Two-phase Planner | REBUILD | planning + consultation can help, but model output cannot own project truth |
| Expert consultation | DEMOTE / REBUILD | useful as specialist proposal; “expert opinion” must not be automatically trusted |
| DAG dependency model | KEEP CONCEPT | useful for execution ordering/parallelism; must remain Run/Attempt-local unless promoted through Project Control |
| conflict-free parallel batches | KEEP CONCEPT / REBUILD | practical execution optimization; future version should integrate authoritative Workspace semantics |
| Agent Registry | KEEP CONCEPT / REBUILD | Agent != Model is strong; static capability scores and manual role assumptions need evidence-based routing |
| Executor abstraction | KEEP CONCEPT / REBUILD | replaceable providers are valuable; old CLI/file protocol is legacy |
| Claude/DSH/Codex executor implementations | EVIDENCE ONLY / selective utility reuse | local-path coupling, polling result files, bypass flags, weak provider semantics |
| unknown backend -> Claude fallback | RETIRE | future system should fail closed on unknown capability/provider |
| worker Result normalization | KEEP CONCEPT | provider-neutral result boundary remains useful |
| Reviewer | REBUILD | independent review is useful; reviewer cannot own Acceptance |
| fail-closed invalid Reviewer verdict | KEEP PRINCIPLE | absence of valid verdict must never imply PASS |
| scheduler validation evidence passed to Reviewer | KEEP PRINCIPLE | reality evidence should outrank worker self-report |
| failure taxonomy/evaluator | KEEP CONCEPT / REBUILD | transient/infrastructure/plan failures need distinct recovery paths |
| bounded retry | KEEP PRINCIPLE | unbounded retry is unsafe |
| local replan preserving completed work | KEEP CONCEPT / REBUILD | useful Attempt-local adaptation; project-level replanning belongs to Project Control |
| Planner artifact identity/hash lineage | KEEP CONCEPT | content identity and lineage are useful |
| Planner file polling/finalization protocol | EVIDENCE ONLY | mostly compensates for LLM-writing-JSON control protocol |
| `file-wait.mjs` generic utilities | KEEP UTILITY | small reusable utility, not architecture |
| raw run/history provenance | KEEP CONCEPT | long-running systems need attributable execution history |
| `distiller.mjs` as project Memory promotion | RETIRE | converts planner/review/model artifacts into durable “decision/knowledge” and feeds them back |
| `retriever.mjs` | DEMOTE / REBUILD | deterministic retrieval useful; naive 2-gram ranking is not future architecture |
| `context.mjs` bounded context | REBUILD | context budgets/provenance useful; sources must come from trusted current control/reality |
| `state-summary.mjs` | DEMOTE | useful view only; must derive from authoritative state and never become truth |
| `.ai/tasks.json` authoritative Task state | RETIRE | conflicts with Project Control Task |
| `.ai/state.json` project truth | RETIRE | creates double-source-of-truth risk |
| legacy `.ai/memory/decisions` authority | RETIRE | unsafe promotion/self-reinforcement |
| memory attribution IDs | KEEP CONCEPT | useful to explain what context influenced a model, but attribution != validity |
| Agent communication file channel | EVIDENCE ONLY / REBUILD if needed | not proven necessary; avoid permanent message-bus complexity without need |

## 4. Confirmed anti-patterns

### 4.1 Self-reinforcing model memory

Observed path:

```text
Planner architecture_decisions
→ distiller
→ memory/decisions
→ retriever/context
→ future Planner
```

Provenance exists, but provenance alone does not prove validity.

**Future rule:** model output cannot auto-promote into authoritative Project Decision/Memory.

### 4.2 Model consensus mistaken for trust

Planner Stage 2 includes an instruction equivalent to “expert opinions already consulted, trust directly.”

**Future rule:** specialist output is candidate analysis, not evidence or authority.

### 4.3 Control protocol built around LLM-written files

Real regression history includes:
- half-written JSON;
- placeholder tasks;
- empty task sets;
- stale invalid JSON;
- incomplete but syntactically valid skeletons;
- missing done markers;
- polluted acceptance commands.

The resulting lifecycle machinery is technically careful, but much complexity compensates for the protocol itself.

**Future rule:** use typed/schema runtime interfaces for control facts whenever possible.

### 4.4 Weak acceptance

Natural-language acceptance criteria can become manual/no-objective-evidence paths, later compensated by an LLM Reviewer.

**Future rule:** no model/reviewer confidence may manufacture missing Evidence.

### 4.5 Unsafe fallback and permissions

Legacy executor behavior includes provider fallback and Codex sandbox/approval bypass.

**Future rule:** capability/provider mismatch fails closed; permissions come from explicit policy/workspace authority.

## 5. Assets worth carrying forward

Strongest reusable ideas:
- Agent != Model;
- Runtime/provider abstraction;
- provider-neutral Result;
- DAG/dependency scheduling;
- bounded parallelism and conflict awareness;
- distinct failure classes;
- bounded local retry/replan;
- fail-closed review;
- artifact identity/digest;
- execution provenance;
- context budgeting and attribution as non-authoritative mechanisms.

## 6. Evidence gap

The repository does **not** currently prove that V0.5 multi-agent orchestration outperforms a strong single-agent baseline on large projects.

Existing tests primarily prove software/protocol correctness and regression handling.

Before dynamic multi-agent becomes a default Super Agent strategy, future benchmarks must compare it against simpler baselines.

## 7. Missing historical evidence

Most runtime `.ai/` reports were intentionally git-ignored. Therefore this static audit cannot identify the exact conversation/iteration where GPT↔DSH architectural drift began.

If local historical reports are recovered, perform a separate **Legacy Drift Forensics** pass.

## 8. Hard contamination barrier

No V0.5 asset may:
- directly mutate Project Control accepted state;
- become Decision/Memory authority merely because a model emitted it;
- define Acceptance;
- create a second authoritative Task/Project state;
- silently choose a substitute runtime;
- bypass Project Control Policy/Approval/Workspace boundaries.

Reuse must be one-way:

```text
legacy idea/utility
→ explicitly selected implementation candidate
→ new contract
→ tests/benchmark/evidence
→ accepted into new architecture
```

Never:

```text
legacy component exists
→ therefore future architecture must support it
```
