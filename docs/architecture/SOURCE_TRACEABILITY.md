# Project Control OS — Source Traceability (Research Draft)

> Status: RESEARCH / NOT ARCHITECTURE AUTHORITY
>
> Purpose: record where proposed capabilities actually come from in real repositories.
> This file is deliberately source-first: a concept is not considered a valid design input
> merely because its name is familiar. It must be traceable to implementation code or a
> clearly identified protocol/spec, with the distinction recorded.

## Traceability rule

For every candidate capability, record:

1. Source repository
2. Exact path(s)
3. Relevant class/function/type
4. What the code actually does
5. Problem it solves
6. Boundary/limitation visible in the source
7. Possible relevance to Project Control OS
8. Whether the source is implementation, protocol/specification, or documentation only

Do not promote a capability into the architecture merely from terminology.

---

## 1. DSH Agent Team

Source:
- Repository: https://github.com/deepseek-ai/deepseek-harness
- Package: `packages/experimental/agent-team/`

### Public service

Source:
- `packages/experimental/agent-team/src/index.ts`
- `TeamService`

Observed implementation:
- Public Cordis service façade.
- Composes `TeamActivity`, `TeamRuntimeLifecycle`, `TeamJournal`, `TeamRoster`, `TeamMailbox`, and `TeamTaskBoard`.
- Exposes membership, teammate spawning, durable messaging, task creation/read/update, wait-for-change, interruption, and membership lookup.
- Uses exact live Agent identity as the caller authority credential.
- Team configuration has explicit limits for members, tasks, pending messages, message size, and disposal timeout.

Meaning:
- DSH Team is not merely “multi-agent collaboration”.
- It is a concrete durable collaboration subsystem built on DSH Session infrastructure.

Boundary:
- Team owns Team-domain collaboration state and runtime coordination.
- It does not become the Project Control OS's project/goal acceptance authority.

### Transaction / journal

Source:
- `packages/experimental/agent-team/src/journal.ts`
- `TeamJournal`

Observed implementation:
- Maintains a per-Lead transaction tail.
- Serializes each Lead's asynchronous mutation operation.
- Performs append + session flush before publishing commit notification.
- Reads Team state through the registered Session projection.

Meaning:
- The source of Team's serialized durable mutation behavior is explicit.
- This is stronger evidence than saying “Team has persistence”.

### Durable mailbox

Source:
- `packages/experimental/agent-team/src/mailbox.ts`
- `TeamMailbox`

Observed implementation:
- Queues a durable peer message before attempting delivery.
- Tracks dispatch tails and in-flight messages.
- Observes target Session events to recognize durable receipt.
- Retries queued-but-not-delivered messages for a Team member.
- Applies pending-message and message-byte limits.

Meaning:
- “Reliable agent messaging” here is implemented as queue → dispatch → receipt/acknowledgement → recovery, not simply a function call between agents.

### Task board

Source:
- `packages/experimental/agent-team/src/task-board.ts`
- `TeamTaskBoard`

Observed implementation:
- Owns Team task limits, authorization, transitions, and derived views.
- Team task snapshots contain revision, status, owner, blockers, and write scopes.
- Task mutation uses compare-and-set semantics through expected revision.

Meaning:
- DSH already provides a concrete example of revisioned task mutation and durable task DAG behavior inside the Team domain.

---

## 2. DSH Workflow

Source:
- Repository: https://github.com/deepseek-ai/deepseek-harness
- `packages/workflow/workflow/src/index.ts`
- `packages/workflow/workflow-ptc/src/index.ts`
- `packages/workflow/tool-workflow/src/index.ts`

### Workflow seam

Source:
- `packages/workflow/workflow/src/index.ts`
- `WorkflowEngine`

Observed implementation:
- Workflow is an optional capability, not the core agent loop.
- `start(request)` returns a live `WorkflowRun`.
- Run exposes result/cancel/dispose lifecycle.
- Workflow events are observation snapshots rather than handles to mutable execution state.

### PTC implementation

Source:
- `packages/workflow/workflow-ptc/src/index.ts`
- `PtcWorkflowEngine`

Observed implementation:
- Validates workflow metadata and parses the script before publishing the run.
- Resolves the subagent provider before work starts.
- Enforces total-agent and concurrency ceilings.
- Executes workflow scripts inside the PTC runtime.
- Emits workflow start/phase/log/agent-start/agent-end/end events.
- Run result does not reject for ordinary script failure/cancellation; stop reason is represented in the result.

Meaning:
- DSH Workflow is a deterministic/model-written execution mechanism inside the runtime layer.
- It should not be recreated inside Project Control OS merely to obtain orchestration.

Boundary:
- Workflow does not itself become Project/Goal/Task acceptance state.

---

## 3. Agent Harness — authoritative completion / control boundary

Source:
- Repository: https://github.com/0xenzyme/agent-harness
- `plugins/agent-harness/scripts/agent-harness.mjs`
- `plugins/agent-harness/templates/worker-prompt.md`
- `docs/HARNESSES.md`
- `docs/project-contract.md`

Observed implementation/protocol:
- `Task/Goal` is the accepted-state authority.
- Run stores execution evidence/status rather than independently completing Task/Goal.
- Worker output remains candidate evidence until the accepted-state owner verifies it.
- Host owns scheduling, delegation, concurrency, and cancellation.
- Harness owns durable project control, dependencies, evidence, gates, and state synchronization.
- Path containment is checked lexically and through realpath/symlink checks.
- Enforced Run checkpoints use `expectedRevision` and atomic writes.
- State synchronization is treated as a durable completion condition.

Important distinction:
- These rules are backed by both implementation and deterministic tests/specs.
- They are stronger evidence for Project Control boundaries than generic “controller” terminology.

---

## 4. Agent Execution Harness — evidence / claims / task execution

Source:
- Repository: https://github.com/lordaeternus/agent-execution-harness
- `src/core/evidence.ts`
- `src/core/evidence-policy.ts`
- `src/core/claims.ts`
- `src/core/task-contract.ts`
- `src/core/task-graph.ts`
- `src/core/run-types.ts`
- `src/core/state-machine.ts`
- `src/core/runner.ts`
- `src/core/artifact-store.ts`
- `src/core/codebase-memory.ts`
- `src/core/command-execution.ts`
- `src/core/command-policy.ts`

Observed implementation surface:
- The repository has separate source modules for evidence, evidence policy, claims, task contracts, task graphs, run types, state machines, runner, artifacts, codebase memory, command execution, and command policy.
- This is direct evidence that “evidence”, “claims”, “task graph”, “run”, “policy”, and “memory” can be implemented as separate control concepts rather than one large agent loop.

Research note:
- The exact semantics of each module still need source-level reading before they are used as architecture precedent.
- Do not infer behavior from filenames alone.

---

## 5. Earthwalker Agent OS — recovery

Source:
- Repository: https://github.com/earthwalker17/agent-os
- `backend/execution/recovery_matrix.py`
- `backend/execution/recovery.py`
- `backend/execution/models.py`
- `backend/execution/background.py`

### Recovery Matrix

Observed implementation:
- `RecoveryContract` is a frozen per-failure-type repair contract.
- Contracts define accepted evidence, verification method, max attempts, auto eligibility, child budget cap, confirmation boundary, and audit note.
- `classify_failure(record)` is deterministic and has no LLM/I/O.
- Environment/operator failures are classified conservatively and prevented from inappropriate agent auto-repair.
- Recovery evidence is bounded and redacted.

Meaning:
- Recovery is not “retry”.
- It is typed diagnosis + bounded next action + verification + approval policy.

---

## 6. Earthwalker Agent OS — task graph / workspace / runner

Source:
- `backend/execution/planner.py`
- `backend/execution/models.py`
- `backend/execution/runner.py`
- `backend/execution/patch_workspace.py`
- `backend/execution/integration.py`
- `backend/execution/run_store.py`

Observed implementation:
- Persisted execution plan contains a task graph.
- Planner provides topological ordering, dependency failure handling, and wave computation.
- Parallel team execution uses isolated patch workspaces.
- Integration is deterministic rather than delegated to an LLM.
- Coordinator remains the sole writer for central run/plan records.
- Run store retains append-oriented event history and durable run artifacts.

Meaning:
- Parallelism requires workspace isolation and deterministic integration, not merely concurrent agent calls.

---

## 7. Current research consequence

The Project Control OS should not define a module merely because another project has a similarly named module.

For each candidate module, the next research pass must answer:

`What exact source implementation gives this capability, what invariant does that implementation enforce, and what boundary prevents it from taking authority that belongs elsewhere?`

Only after that source map is sufficiently complete should a new Project Control OS module be frozen.

## Current status

- DSH Workflow: source traced at package/class level.
- DSH Agent Team: source traced at service + journal + mailbox + task-board level.
- Agent Harness: source traced at control-script + worker protocol + project-contract level.
- Agent Execution Harness: source module map established; detailed semantic reading pending.
- Earthwalker Agent OS: recovery matrix + planner/runner/workspace source traced; detailed semantic reading pending.
- Controller/Reconciler: **do not design yet**. First identify concrete controller/reconciliation implementations and trace their code paths.
