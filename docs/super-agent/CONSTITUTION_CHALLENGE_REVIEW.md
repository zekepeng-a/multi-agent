# Super Agent Constitution Challenge Review

**Status:** ADVERSARIAL REVIEW — ROUND 1  
**Date:** 2026-10-01  
**Subject:** `SUPER_AGENT_CONSTITUTION.md` proposed revision on branch `super-agent/constitution-v0.1`

## 1. Review method

This review attacks the proposal rather than defending it.

Inputs:
- proposed Super Agent constitution;
- current Project Control OS constitution and G8-complete reality;
- legacy V0.5 static audit;
- reference research across OpenAI Agents SDK, LangGraph, Deep Agents, Microsoft Agent Framework and Temporal.

Question:

> Does the proposed constitution freeze only durable product principles, or does it prematurely freeze one architecture decomposition?

## 2. Findings

### C1 — Top-level module decomposition is too constitutional

The proposal visually defines:
- Project Control OS;
- Adaptive Execution Engine;
- Runtime / Agent Providers;
- Workspace / Reality;
- Evidence / Evaluation.

This is a useful **current hypothesis**, but a constitution should not make a particular module decomposition immutable before architecture archaeology completes.

**Required revision:** label this composition as non-authoritative hypothesis. Freeze semantics/authority, not package/module names.

### C2 — Named Project Control OS implementation is too strongly embedded in S-06

The durable principle is that accepted project state/control authority must remain separate from execution intelligence.

Whether the final Super Agent literally embeds today's `project-control/` package unchanged is an architecture decision, not yet a constitutional fact.

**Required revision:** define **Control Authority** semantically; treat current Project Control OS as the strongest implemented candidate/foundation.

### C3 — “Complexity ladder” implies a false total ordering

Direct tools, workflows, specialist delegation, DAG parallelism and dynamic teams are not strictly nested. A deterministic DAG may be operationally more complex than a bounded two-agent specialist call.

**Required revision:** rename to **execution pattern spectrum** and prohibit interpreting numeric order as architectural superiority.

### C4 — Git is appropriate for architecture truth, not all runtime truth

The proposal says durable repository/state beats chat memory. This is directionally correct, but runtime/project-control state may live in SQLite or another durable store.

**Required revision:** distinguish:
- Git/durable docs as architecture/governance authority;
- authoritative durable stores as runtime/project state authority.

### C5 — Benchmark requirement needs an explicit baseline

“Complexity requires evidence” is too vague without saying what simpler baseline means.

**Required revision:** initial benchmark baseline should be:
- same task/contract/workspace;
- strongest available single-agent/provider configuration;
- Project Control semantics held constant where applicable;
- compare only the execution strategy variable.

### C6 — “Super Agent” strength must remain falsifiable

“More powerful than existing agents” can become an unfalsifiable product slogan.

**Required revision:** constitutional objective must be expressed in measurable dimensions, not universal dominance. External systems should be benchmark references, not rhetorical targets.

### C7 — Provider replaceability must not prohibit provider-specific optimization

Provider independence is important, but the system may legitimately exploit DSH/Codex/Claude-specific capabilities behind explicit adapters/capability contracts.

**Required revision:** product identity must remain portable; optimized provider paths are allowed when capability/semantics are explicit.

### C8 — Evaluation and observability must not become acceptance authority

Tracing/evaluation tools are critical, but metrics, traces, or model judges must not silently become Project Acceptance.

**Required revision:** add explicit separation between evaluation telemetry and acceptance authority.

### C9 — Human authority needs a non-intervention objective

Project Control correctly preserves Human direction/high-risk approval, but a Super Agent intended for very large projects should also minimize unnecessary human babysitting.

**Required revision:** include human intervention burden as an optimization metric while preserving human authority.

### C10 — Legacy “KEEP” labels must not imply code reuse

Several audit entries say KEEP CONCEPT. Future agents may misread this as “port the old module.”

**Required revision:** constitution/roadmap must state that KEEP CONCEPT means conceptual precedent only unless a later migration decision explicitly selects code.

## 3. Compatibility with Project Control OS

No direct contradiction with I-01..I-45 was found if the above revisions are made.

Particularly compatible:
- runtime != Project Control;
- self-report != accepted evidence;
- model != agent;
- capability != permission;
- external effect != evidence;
- current Reality > Memory;
- no blind retry after unknown effects.

Potential risk:
- if future adaptive execution routing begins changing Task/Acceptance/project state directly, it would violate existing authority boundaries.

Therefore execution routing must remain a proposal/execution concern unless a future explicit direction change revises Project Control invariants.

## 4. Verdict

**PASS WITH REQUIRED REVISIONS.**

The product direction is coherent, but the first proposal over-fixes the module decomposition and under-specifies the evaluation baseline.

The constitution should be revised before Human acceptance.

## 5. Required next artifacts

Before SA0 exit:
1. revise `SUPER_AGENT_CONSTITUTION.md`;
2. create an explicit baseline/evaluation protocol;
3. perform at least one second-pass challenge against the revised constitution and evaluation design;
4. only then request Human acceptance.
