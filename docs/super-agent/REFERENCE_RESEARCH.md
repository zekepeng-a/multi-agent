# Super Agent Reference Research

**Status:** RESEARCH EVIDENCE — NOT ARCHITECTURE AUTHORITY  
**Date:** 2026-10-01  
**Purpose:** identify mature precedents relevant to long-horizon, complex agent systems before architecture is chosen.

## 1. Research question

What patterns recur across mature agent/runtime systems for:
- long-running state;
- multi-agent composition;
- durable execution;
- tool/action safety;
- context management;
- human control;
- observability/evaluation;
- and complexity management?

The goal is not to copy any framework. The goal is to avoid inventing already-solved boundaries.

## 2. OpenAI Agents SDK

Sources:
- https://openai.github.io/openai-agents-python/
- https://openai.github.io/openai-agents-python/multi_agent/
- https://openai.github.io/openai-agents-python/tracing/
- https://openai.github.io/openai-agents-python/guardrails/

Observed:
- deliberately small primitive set: agents, tools/agents-as-tools, handoffs, guardrails;
- manager orchestration and handoff are separate patterns;
- sessions provide persistent working context;
- tracing records model generations, tool calls, handoffs and guardrails;
- human-in-the-loop and sandbox-agent concepts are first-class;
- guardrails can fail fast instead of letting model confidence substitute for permission.

Implication:
- complex behavior does not require a large permanent hierarchy of agent roles;
- delegation is one tool among several;
- observability and validation are infrastructure, not optional narrative reports.

## 3. LangGraph

Sources:
- https://github.com/langchain-ai/langgraph
- https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/overview.mdx
- https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/checkpointers.mdx

Observed:
- explicitly targets long-running, stateful agents/workflows;
- durable execution, checkpoints, persistence and human-in-the-loop are core;
- deterministic and agentic steps can coexist in one graph;
- durability has explicit tradeoffs/modes rather than pretending all execution has identical guarantees;
- debugging/tracing is treated as essential for complex behavior.

Implication:
- the future Super Agent should separate flexible reasoning from durable execution semantics;
- persistence/recovery guarantees should be explicit per boundary.

## 4. Deep Agents

Sources:
- https://github.com/langchain-ai/deepagents
- https://github.com/langchain-ai/deepagents/blob/main/libs/ARCHITECTURE.md
- https://github.com/langchain-ai/docs/blob/main/src/oss/deepagents/overview.mdx

Observed:
- positioned as an opinionated harness for long-horizon work, not a new runtime;
- planning is optional capability, not universal authority;
- filesystem/context offloading keeps long tasks manageable;
- subagents use isolated/fresh context and return bounded results;
- model-agnostic and backend-pluggable;
- evaluation is a separate package;
- experimental long-running host documents its own security and restart limitations instead of overclaiming.

Implication:
- harness behavior can be layered above a runtime;
- context isolation is a concrete reason to spawn subagents;
- complex delegation should solve measurable context/parallelism problems.

## 5. Microsoft Agent Framework

Sources:
- https://learn.microsoft.com/en-us/agent-framework/overview/
- https://learn.microsoft.com/en-us/agent-framework/workflows/
- https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/
- https://learn.microsoft.com/en-us/agent-framework/journey/workflows

Observed:
- separates agents, harness agents, workflows and integrations;
- explicitly advises using simpler patterns first;
- workflows are appropriate when explicit execution order/control is needed;
- supports sequential, concurrent, handoff, group-chat and Magentic manager patterns;
- checkpoints/resuming, HITL, observability, metrics/events and workflow topology are production concerns;
- a workflow can be exposed as an agent, showing that product interface and execution structure need not be identical.

Implication:
- there is no single best orchestration topology;
- execution should choose among patterns based on task structure;
- workflow durability and observability are separate from agent intelligence.

## 6. Temporal

Sources:
- https://docs.temporal.io/workflow-definition
- https://docs.temporal.io/ai
- https://docs.temporal.io/child-workflows
- https://docs.temporal.io/tasks

Observed:
- deterministic workflow logic is separated from nondeterministic external work;
- model/API/database/tool calls belong in Activities rather than replayable deterministic workflow code;
- event history reconstructs durable state after worker failure;
- Temporal explicitly recommends simpler Activities/single Workflows before introducing Child Workflows without a demonstrated need;
- current AI integrations wrap agent frameworks with durable workflow/activity semantics.

Implication:
- Super Agent control flow and external model/tool effects should remain semantically distinct;
- restart/replay design must not blindly repeat nondeterministic effects;
- hierarchy should not be introduced merely for code organization.

## 7. Cross-source recurring patterns

Across these systems, recurring patterns are:

1. **Small core primitives beat permanent role hierarchies.**
2. **Single-agent / deterministic workflow remain first-class options.**
3. **Multi-agent is conditional, not synonymous with advanced capability.**
4. **Durable state and recovery are runtime/control concerns.**
5. **External side effects require explicit boundaries.**
6. **Context isolation/offloading is a legitimate delegation driver.**
7. **Human approval and guardrails are independent from model reasoning.**
8. **Tracing/evaluation are necessary to improve complex systems.**
9. **Provider/runtime replaceability is common and valuable.**
10. **Production systems expose limitations rather than converting them into model assumptions.**

## 8. Tensions / open questions

The references do not settle:
- whether Super Agent should build its own durable execution runtime or adopt/integrate one;
- how much planning should be model-driven versus controller-driven;
- when DAG planning provides measurable benefit over one strong coding agent;
- whether Project Control OS should remain a standalone package or become a broader Super Agent control core;
- whether dynamic multi-agent teams outperform isolated specialist calls for software projects.

These remain research/benchmark questions.

## 9. Research conclusion

The strongest shared precedent is not “use many agents.” It is:

> Keep the control model durable and observable, make execution strategy replaceable, and increase orchestration complexity only when the task demonstrates a need.

This conclusion supports — but does not itself accept — the proposed Super Agent constitution.
