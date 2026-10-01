# SA0 Human Acceptance Packet

**Status:** READY FOR HUMAN DECISION — NOT ACCEPTED  
**Date:** 2026-10-01  
**Branch:** `super-agent/constitution-v0.1`  
**Baseline:** G8-complete Project Control OS HEAD `79f03e1c0fc680b6876428e3dd26c6f616817cf7`

## 1. Human direction being evaluated

Build toward a Super Agent capable of handling large, long-running, complex projects while:
- reducing model drift, memory loss and hallucinated architectural truth;
- avoiding further sunk-cost investment in the legacy V0.5 multi-agent design;
- preserving useful legacy ideas only when independently justified;
- grounding architecture in durable Git governance and external precedent.

## 2. SA0 artifacts produced

- `SUPER_AGENT_CONSTITUTION.md` — Proposed Constitution R2.
- `docs/super-agent/REFERENCE_RESEARCH.md` — external precedent research.
- `docs/super-agent/LEGACY_V05_ASSET_AUDIT.md` — first-pass static asset audit.
- `SUPER_AGENT_REALITY.md` — initial current-reality map.
- `docs/super-agent/EVALUATION_BASELINE.md` — benchmark/evaluation protocol R2.
- `docs/super-agent/CONSTITUTION_CHALLENGE_REVIEW.md` — adversarial review round 1.
- `docs/super-agent/CONSTITUTION_CHALLENGE_REVIEW_R2.md` — adversarial review round 2.
- `SUPER_AGENT_ROADMAP.md` — SA0-only authorization boundary.

## 3. External precedent synthesis

Research recorded from:
- OpenAI Agents SDK;
- LangGraph;
- Deep Agents;
- Microsoft Agent Framework;
- Temporal.

Recurring findings:
- use small core primitives;
- keep single-agent and deterministic workflow first-class;
- treat multi-agent as conditional;
- make state/recovery durable;
- separate external/nondeterministic effects from durable control logic;
- isolate/offload context intentionally;
- keep HITL/guardrails independent from model confidence;
- make tracing/evaluation explicit;
- keep providers replaceable;
- prefer simpler structure until complexity proves value.

## 4. Legacy V0.5 disposition

System-level classification:

> **valuable but epistemically unsafe research prototype**

Recommended future posture:
- no V0.6 feature-development line;
- no wholesale migration;
- extract only independently justified concepts/utilities;
- prohibit legacy state/memory/reviewer/planner authority from re-entering Project Control truth.

Strongest retained concepts:
- Agent != Model;
- provider-neutral execution/result boundary;
- DAG/dependency scheduling;
- conflict-aware parallelism;
- failure taxonomy;
- bounded retry/local replan;
- fail-closed review;
- artifact identity/provenance;
- bounded context/attribution as non-authoritative mechanisms.

Strongest retired patterns:
- global legacy Manager authority;
- `.ai/tasks.json` / `.ai/state.json` as project truth;
- Planner-generated decisions auto-promoted into long-term memory;
- expert/model consensus as trust;
- natural-language acceptance auto-pass semantics;
- unknown-provider fallback;
- sandbox/approval bypass as a normal execution path.

## 5. Proposed constitutional core

The R2 constitution proposes:
- outcome over agent count;
- simplest sufficient execution;
- model consensus != evidence;
- self-report != completion;
- Reality > model narrative;
- explicit Control Authority separate from execution intelligence;
- complexity must prove incremental value;
- provider replaceability with provider-specific optimization allowed behind contracts;
- no silent promotion of model output to project truth;
- distinct failure classes;
- interruption-safe long-horizon continuity;
- durable authority instead of chat-memory authority;
- adaptive execution pattern choice;
- verification/evaluation cannot manufacture acceptance;
- Human keeps direction/high-risk authority while unnecessary babysitting is minimized;
- legacy KEEP does not imply code reuse;
- no architecture-by-conversation.

## 6. Challenge-review result

Round 1: **PASS WITH REQUIRED REVISIONS**.

All ten required revisions were applied in Constitution R2.

Round 2: **PASS FOR HUMAN CONSIDERATION**.

Important limitation:
- both challenge passes were performed inside the same ChatGPT workstream;
- they are adversarial consistency reviews, not independent external authority.

No direct contradiction with existing Project Control I-01..I-45 was identified after R2.

## 7. Evaluation discipline

Before complex execution patterns can become defaults, compare them against a competitive simpler baseline.

Current proposed baseline:
- same Goal/Task/Acceptance/Workspace/Policy;
- strong single agent versus candidate orchestration;
- same provider/model when isolating orchestration effects where feasible;
- fair tools/permissions/budgets;
- holdout tasks;
- repeated trials where needed;
- failures/skips/human intervention all reported;
- objective Reality/tests preferred over LLM judges;
- benchmark result remains separate from Project Acceptance.

No benchmark results exist yet.

Therefore no claim currently exists that multi-agent, planning, DSH, Codex, Claude, DAG or any other execution mode is superior.

## 8. What acceptance would mean

Accepting Constitution R2 would authorize the **direction and invariants**, not an implementation.

It would **not** yet authorize:
- an Execution Engine implementation;
- a DSH plugin;
- multi-agent as default;
- a V0.6 legacy revival;
- a specific external framework dependency;
- rewriting Project Control OS;
- claiming superiority over current commercial agents.

After acceptance, the next work should be architecture archaeology/design under these constraints, followed by a separate implementation authorization.

## 9. Open non-blocking questions

Still intentionally unresolved:
- exact project-planning versus attempt-planning boundary;
- execution routing mechanism;
- whether durable execution is built, adopted or hybrid;
- exact strategy interface for single-agent/workflow/delegation/DAG/team;
- provider-specific integration contracts;
- benchmark corpus and public benchmark selection;
- whether local historical GPT↔DSH reports can be recovered for drift forensics.

These are not hidden gaps; they are deliberately deferred architecture/research questions.

## 10. Human decision options

### ACCEPT R2
Promote `SUPER_AGENT_CONSTITUTION.md` R2 to accepted product constitution and authorize the next **architecture/research** phase only.

### REVISE
Change specific constitutional principles before acceptance.

### REJECT
Do not adopt this Super Agent direction; keep G8 Project Control OS as the last accepted product milestone.

No implementation should begin until the Human decision is recorded in Git.
