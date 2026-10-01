# SUPER_AGENT_CONSTITUTION.md

**Status:** PROPOSED CONSTITUTION — REVISION 2 — NOT YET ACCEPTED  
**Scope:** Future Super Agent product direction for large, long-running, complex projects  
**Authority:** Proposal only. It becomes constitutional authority only after challenge review and explicit Human acceptance recorded in Git.  
**Baseline:** branched from G8-complete Project Control OS HEAD `79f03e1c0fc680b6876428e3dd26c6f616817cf7`.  
**Revision note:** updated after `docs/super-agent/CONSTITUTION_CHALLENGE_REVIEW.md` round 1.

## 1. Product identity

The target product is a **Super Agent system for large, long-running, complex projects**.

Its strength is not measured by agent count, prompt complexity, orchestration depth, or claims of universal superiority. It is measured by reproducible project outcomes across declared dimensions such as correctness, goal retention, recovery, evidence quality, cost, latency, provider substitution, and human intervention burden.

The Super Agent is not synonymous with:
- a multi-agent chat;
- DSH;
- Codex;
- Claude Code;
- a single planner;
- a workflow engine;
- or Project Control OS alone.

### Current architectural hypothesis — not constitutional decomposition

A plausible composition is:

```text
Super Agent
├─ Control Authority / Project Control
├─ Adaptive Execution
├─ Runtime / Agent Providers
├─ Workspace / Reality
└─ Evidence / Evaluation / Observability
```

This decomposition is a research hypothesis. The constitution freezes semantic boundaries and product goals, not package names or mandatory module topology.

## 2. Core objective

The system exists to answer:

> How can one system reliably complete projects that exceed a single model turn, context window, process lifetime, runtime, or agent session without losing intent, authority, evidence, or recoverability?

It does not primarily answer:

> How can more agents talk to each other?

The objective is falsifiable through declared benchmarks and evidence, not through “stronger than everything” rhetoric.

## 3. Proposed constitutional principles

- **S-01 — Outcome over agent count.** Capability is measured by reliable project completion, not number of agents.
- **S-02 — Simplest sufficient execution.** Multi-agent is an optional execution strategy, not the default.
- **S-03 — Model consensus is not evidence.** Agreement among models/agents cannot by itself establish truth.
- **S-04 — Self-report is not completion.** Runtime/agent claims remain candidate observations until verified.
- **S-05 — Reality outranks model narrative.** Current Reality and verified evidence outrank plans, reports, summaries and model-generated memory.
- **S-06 — Control authority is separate from execution intelligence.** Execution may propose, plan, route and act; authoritative project transitions belong to an explicit control authority. Current Project Control OS is the strongest implemented candidate for that role, not an immutable package requirement.
- **S-07 — Complexity requires evidence.** Planner layers, reviewers, subagents, DAGs, dynamic teams and other orchestration complexity must demonstrate measurable value over a simpler baseline before becoming default architecture.
- **S-08 — Runtime/provider replaceability.** Product identity must not depend on DSH, Codex, Claude, OpenAI, LangGraph, Temporal or any single provider. Provider-specific optimizations are allowed behind explicit capability and semantic contracts.
- **S-09 — Unverified model output cannot silently become durable project truth.** Promotion to Decision/Memory/Accepted State requires explicit authority, provenance and validity rules.
- **S-10 — Failure classes must remain distinct.** Execution, infrastructure, plan, policy, evidence, reality-conflict and external-effect failures must not collapse into one generic retry loop.
- **S-11 — Long-horizon work must survive interruption.** Durable project continuity cannot depend on chat continuity or one process remaining alive.
- **S-12 — Durable authority beats chat memory.** Architecture/governance truth must be recoverable from versioned durable artifacts such as Git; runtime/project truth must be recoverable from its authoritative durable store. Chat history is never the sole authority.
- **S-13 — Execution strategy is adaptive.** A task may use direct tools, one agent, deterministic workflow, specialist delegation, DAG parallelism, or dynamic multi-agent only as justified.
- **S-14 — Verification must be independent of persuasion.** A reviewer/model may contribute evidence or analysis but cannot turn confidence or rhetoric into acceptance authority.
- **S-15 — Legacy assets have no inheritance privilege.** V0.5 components are reused only when independently justified by present requirements.
- **S-16 — No architecture-by-conversation.** New top-level concepts, invariants or authority boundaries require durable proposal/review/acceptance in Git.
- **S-17 — Evaluation telemetry is not acceptance authority.** Traces, scores, benchmarks and model-judge outputs can inform improvement, but cannot silently manufacture accepted project state.
- **S-18 — Human authority with minimal babysitting.** Humans retain product direction and high-risk approval authority, while the system should minimize unnecessary corrective intervention as a measured product objective.
- **S-19 — Concept retention does not imply code reuse.** A legacy idea marked KEEP/KEEP CONCEPT is only precedent until a later migration decision selects a concrete implementation.

## 4. Execution pattern spectrum

The following patterns are candidate strategies, not a strict ranking:

- deterministic function / direct tool;
- single strong agent;
- explicit deterministic/agentic workflow;
- specialist delegation / agents-as-tools / handoff;
- parallel DAG / isolated subagents;
- dynamic multi-agent team.

Different patterns may combine. “Higher” complexity is not inherently better.

## 5. Required evaluation dimensions

Any architecture claiming advantage for complex projects should eventually be evaluated against at least:
- correctness / acceptance rate;
- goal retention / drift;
- rework and rollback rate;
- recovery after interruption;
- evidence coverage;
- context efficiency;
- latency;
- cost/token/tool usage;
- human intervention burden;
- external-effect safety;
- reproducibility across model/runtime substitutions.

The initial comparison protocol is defined in `docs/super-agent/EVALUATION_BASELINE.md`.

## 6. Initial baseline rule

When evaluating an added execution mechanism, hold the control contract and task constant where possible and compare against the strongest practical simpler baseline.

Initial default comparison:

```text
same Goal / Task / Acceptance / Workspace
                    ↓
      strong single-agent execution
                    vs
      candidate added orchestration
```

When isolating orchestration effects, use the same provider/model where feasible.

## 7. Relationship to Project Control OS

Project Control OS remains the current G8-complete bounded control-plane prototype and the strongest implemented candidate for Super Agent control authority.

The Super Agent architecture may consume, extend or challenge it only through explicit governance.

No execution mechanism may silently move Project/Goal/Task/Acceptance/Decision/Policy authority back into a runtime.

This constitution does **not** require that the final product preserve today's `project-control/` package boundaries unchanged.

## 8. Relationship to legacy V0.5

Legacy DSH Multi-Agent Runtime V0.5 is a research prototype and evidence source, not future architecture authority.

Its components must pass the Legacy Asset Extraction Audit before reuse.

A KEEP/KEEP CONCEPT result does not authorize code migration.

## 9. Anti-drift rule

When sources disagree, proposed precedence is:

```text
Current Reality
> Verified Evidence
> Accepted Project State
> Accepted Decisions / Constraints
> Promoted Memory
> Research findings
> Historical runtime reports
> Model-generated plans
> Chat history
```

Architecture/governance truth should be reconstructable from Git/versioned durable documents. Runtime truth should be reconstructed from its authoritative durable state and reality evidence.

## 10. Change gate

Until this constitution is accepted:
- no new Execution Engine implementation is authorized;
- no V0.5 feature development is authorized;
- no migration of V0.5 authority into Project Control is authorized;
- research, audit, challenge and benchmark/evaluation design are authorized.

## 11. Acceptance condition for this constitution

This proposal may become accepted only after:
1. external reference research is recorded;
2. V0.5 asset audit is recorded;
3. contradiction/challenge review attacks these principles;
4. an explicit baseline/evaluation protocol exists;
5. Project Control OS compatibility is checked;
6. a second-pass challenge verifies that required revisions are resolved;
7. Human explicitly accepts or revises the constitution;
8. the accepted revision and rationale are committed in Git.
