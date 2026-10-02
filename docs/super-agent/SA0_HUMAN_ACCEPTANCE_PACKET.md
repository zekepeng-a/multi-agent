# SA0 Human Acceptance Packet

**Status:** READY FOR FINAL HUMAN ACCEPT / REVISE — NOT ACCEPTED  
**Date:** 2026-10-02 (R3 convergence; R1/R2 history retained)  
**Branch:** `super-agent/constitution-v0.1`  
**Baseline:** G8-complete Project Control OS HEAD `79f03e1c0fc680b6876428e3dd26c6f616817cf7`

## 1. Human direction being evaluated

Build toward a Super Agent capable of handling large, long-running, complex projects while:
- reducing model drift, memory loss and hallucinated architectural truth;
- avoiding further sunk-cost investment in the legacy V0.5 multi-agent design;
- preserving useful legacy ideas only when independently justified;
- grounding architecture in durable Git governance and external precedent.

## 2. SA0 artifacts produced

- `SUPER_AGENT_CONSTITUTION.md` — Proposed Constitution R3 — independent-review revisions recorded, still not accepted.
- `docs/super-agent/REFERENCE_RESEARCH.md` — external precedent research.
- `docs/super-agent/LEGACY_V05_ASSET_AUDIT.md` — first-pass static asset audit.
- `SUPER_AGENT_REALITY.md` — current SA0 convergence reality map.
- `docs/super-agent/EVALUATION_BASELINE.md` — benchmark/evaluation protocol R3 — non-tradeable floors and preregistration.
- `docs/super-agent/CONSTITUTION_CHALLENGE_REVIEW.md` — adversarial review round 1.
- `docs/super-agent/CONSTITUTION_CHALLENGE_REVIEW_R2.md` — adversarial review round 2.
- `SUPER_AGENT_ROADMAP.md` — SA0-only authorization boundary.
- `docs/super-agent/LEGACY_MIGRATION_MAP.md` — full independent candidate map; not code migration permission.
- `docs/super-agent/SUPER_AGENT_INTELLIGENCE_LAYER_DESIGN.md` — non-authoritative boundary proposal.
- `docs/super-agent/SA0_CONVERGENCE_RECORD.md` — later independent-review outcome provenance and P1/P2 response matrix.

## 3. External precedent synthesis

Research recorded from:
- OpenAI Agents SDK;
- LangGraph;
- Deep Agents;
- Microsoft Agent Framework;
- Temporal.

Observed design tendencies and candidate hypotheses (not measured superiority findings):
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
- failure-aware bounded adaptation concepts, with retry/replan safety requiring rebuilding rather than inherited permission;
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

The R3 constitution proposes:
- outcome over agent count;
- simplest sufficient execution;
- model consensus != evidence;
- self-report != completion;
- factual Reality precedence for observation/validity/conflict detection only; it cannot override direction, Policy, Approval, Contract or legal transitions;
- explicit Control Authority separate from execution intelligence;
- optional complexity must prove preregistered primary benefit while meeting correctness/safety/recovery floors; authority, permission, Acceptance and UNKNOWN-effect safety are non-tradeable; required Verification is retained;
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

The historical internal R2 review identified no direct I-01..I-45 contradiction. It predates the later independent Codex review and does not establish final review success.

Subsequent independent Codex review: **PASS WITH REQUIRED REVISIONS**. Under the current Human direction, R3 addresses P1-01 promotion floors, P1-02 factual vs normative precedence, P1-03 preregistration, plus three P2 clarifications. See the convergence response matrix. This sync checks documented resolution; it is not a fresh independent review or an ACCEPTED verdict.

## 7. Evaluation discipline

Before complex execution patterns can become defaults, compare them against a competitive simpler baseline.

Current proposed baseline:
- same Goal/Task/Acceptance/Workspace/Policy;
- strong single agent versus candidate orchestration;
- same provider/model when isolating orchestration effects where feasible;
- fair tools/permissions/budgets;
- holdout tasks;
- repeated trials where needed;
- preregistered primary metric, permitted degradation and correctness/safety/recovery floors;
- frozen tuning opportunity/data/budget, trial count/stopping rules, failure denominator and environment reset;
- failures/skips/human intervention all reported;
- holdout, shared Memory/context, cross-strategy answers and residual Workspace isolated;
- objective Reality/tests preferred over LLM judges;
- benchmark result remains separate from Project Acceptance.

If provider/model variables cannot be isolated, results are whole-system comparisons, not proof of orchestration causality. Required Verification cannot be removed for lack of extra orchestration benefit.

No benchmark results exist yet.

Therefore no claim currently exists that multi-agent, planning, DSH, Codex, Claude, DAG or any other execution mode is superior.

## 8. What acceptance would mean

Accepting Constitution R3 would accept the **product direction and constitutional boundaries**, not an implementation. No acceptance occurs in this convergence task.

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

These are explicitly unresolved candidate questions, not mandatory modules or SA0 constitutional facts. Plan identity/automatic Replan/dependency readiness/recovery protocols require a D gate only when an adopted capability needs them; no implementation is authorized by their enumeration.

## 10. Human decision options

### ACCEPT R3
Explicitly accept the R3 product constitution and record the decision in Git. This does not automatically authorize an implementation, migration or new phase; any next bounded task needs separate scope/authorization.

### REVISE
Change specific constitutional principles before acceptance.

### REJECT
Do not adopt this Super Agent direction; keep G8 Project Control OS as the last accepted product milestone.

No implementation should begin until the Human decision is recorded in Git.

## 11. Current foundation and minimum success

Project Control OS is the current G8-complete bounded control-plane prototype and most mature implemented control authority foundation. It already offers bounded controlled execution; it is not merely design waiting for use, not the entire Super Agent, and not a permanently frozen package topology.

Current direction: existing Project Control OS + incremental intelligence/strategy capabilities + runtime/provider integrations + selectively rebuilt legacy concepts. Add capabilities, integrate runtimes and validate real outcomes against actual gaps; no comprehensive platform rebuild is authorized.

Minimum long-horizon success means authorized Goal/constraints survive boundaries, completion binds the current Contract, Evidence/Verification remain attributable and valid, interruption history is recovered rather than regenerated, and UNKNOWN effects remain safely uncertain until reconciliation. G8 bounded completion does not claim all such future capabilities are implemented.

Static audit/Migration Map support concept/risk/ecosystem classification, not specific code migration. Any migration requires concrete need, production call-chain evidence, compatibility review and Human authorization. Intelligence Layer is a semantic strategy responsibility, not a mandatory top-level subsystem or new authority; simplest sufficient execution remains the rule, with no HIGH-complexity=>multi-agent shortcut.

Repository extraction, monorepo split, new packages and physical migration are outside this task. Packaging is a later decision after semantic boundaries stabilize.

**Final gate: READY FOR FINAL HUMAN ACCEPT / REVISE. R3 remains PROPOSED; no production implementation authorization exists.**
