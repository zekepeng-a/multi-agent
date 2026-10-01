# SUPER_AGENT_CONSTITUTION.md

**Status:** PROPOSED CONSTITUTION — NOT YET ACCEPTED  
**Scope:** Future Super Agent product direction above Project Control OS and execution runtimes  
**Authority:** Proposal only. It becomes constitutional authority only after challenge review and explicit Human acceptance recorded in Git.  
**Baseline:** branched from G8-complete Project Control OS HEAD `79f03e1c0fc680b6876428e3dd26c6f616817cf7`.

## 1. Product identity

The target product is a **Super Agent system for large, long-running, complex projects**.

Its strength is not measured by agent count, prompt complexity, or orchestration depth. It is measured by whether it can preserve intent, make progress over long horizons, use the simplest sufficient execution strategy, recover from interruption, ground claims in reality, and produce evidence-backed project outcomes.

The Super Agent is not synonymous with:
- a multi-agent chat;
- DSH;
- Codex;
- Claude Code;
- a single planner;
- a workflow engine;
- or Project Control OS alone.

Proposed top-level composition:

```text
Super Agent
├─ Project Control OS
├─ Adaptive Execution Engine
├─ Runtime / Agent Providers
├─ Workspace / Reality
└─ Evidence / Evaluation
```

## 2. Core objective

The system exists to answer:

> How can one system reliably complete projects that exceed a single model turn, context window, process lifetime, runtime, or agent session without losing intent, authority, evidence, or recoverability?

It does not primarily answer:

> How can more agents talk to each other?

## 3. Proposed constitutional principles

- **S-01 — Outcome over agent count.** Capability is measured by reliable project completion, not number of agents.
- **S-02 — Simplest sufficient execution.** Multi-agent is an optional execution strategy, not the default.
- **S-03 — Model consensus is not evidence.** Agreement among models/agents cannot by itself establish truth.
- **S-04 — Self-report is not completion.** Runtime/agent claims remain candidate observations until verified.
- **S-05 — Reality outranks model narrative.** Current Reality and verified evidence outrank plans, reports, summaries and model-generated memory.
- **S-06 — Control authority is separate from execution intelligence.** Execution may propose, plan, route and act; Project Control owns authoritative project transitions.
- **S-07 — Complexity requires evidence.** Planner layers, reviewers, subagents, DAGs, dynamic teams and other orchestration complexity must demonstrate measurable value over a simpler baseline before becoming default architecture.
- **S-08 — Runtime/provider replaceability.** Product identity must not depend on DSH, Codex, Claude, OpenAI, LangGraph, Temporal or any single provider.
- **S-09 — Unverified model output cannot silently become durable project truth.** Promotion to Decision/Memory/Accepted State requires explicit authority and provenance rules.
- **S-10 — Failure classes must remain distinct.** Execution, infrastructure, plan, policy, evidence, reality-conflict and external-effect failures must not collapse into one generic retry loop.
- **S-11 — Long-horizon work must survive interruption.** Durable project continuity cannot depend on chat continuity or one process remaining alive.
- **S-12 — Durable repository/state beats chat memory.** Architecture, accepted decisions, current reality and authorized roadmap must be recoverable from durable artifacts.
- **S-13 — Execution strategy is adaptive.** A task may use direct tools, one agent, deterministic workflow, specialist delegation, DAG parallelism, or dynamic multi-agent only as justified.
- **S-14 — Verification must be independent of persuasion.** A reviewer/model may contribute evidence or analysis but cannot turn confidence or rhetoric into acceptance authority.
- **S-15 — Legacy assets have no inheritance privilege.** V0.5 components are reused only when independently justified by present requirements.
- **S-16 — No architecture-by-conversation.** New top-level concepts, invariants or authority boundaries require durable proposal/review/acceptance in Git.

## 4. Complexity ladder

The proposed execution ladder is:

```text
L0  Deterministic function / tool
L1  Single strong agent
L2  Explicit deterministic/agentic workflow
L3  Specialist delegation / agents-as-tools
L4  Parallel DAG / isolated subagents
L5  Dynamic multi-agent team
```

A higher level is not better by default. Promotion requires demonstrated need and measurable benefit.

## 5. Required evaluation dimensions

Any architecture claiming superiority for complex projects should eventually be evaluated against at least:
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

## 6. Relationship to Project Control OS

Project Control OS remains the current control-plane prototype and is not invalidated by this proposal.

The Super Agent architecture may consume, extend or challenge Project Control OS only through explicit governance. It must not silently move Project Control authority back into an execution runtime.

## 7. Relationship to legacy V0.5

Legacy DSH Multi-Agent Runtime V0.5 is a research prototype and evidence source, not future architecture authority.

Its components must pass the Legacy Asset Extraction Audit before reuse.

## 8. Anti-drift rule

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

## 9. Change gate

Until this constitution is accepted:
- no new Execution Engine implementation is authorized;
- no V0.5 feature development is authorized;
- no migration of V0.5 authority into Project Control is authorized;
- research, audit, challenge and benchmark design are authorized.

## 10. Acceptance condition for this constitution

This proposal may become accepted only after:
1. external reference research is recorded;
2. V0.5 asset audit is recorded;
3. contradiction/challenge review attacks these principles;
4. Project Control OS compatibility is checked;
5. Human explicitly accepts or revises the constitution;
6. the accepted revision and rationale are committed in Git.
