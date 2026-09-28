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


---

## 7. Kubernetes controller-runtime — reconciliation source

Source:
- Repository: https://github.com/kubernetes-sigs/controller-runtime
- `pkg/reconcile/reconcile.go`
- `pkg/internal/controller/controller.go`
- `pkg/builder/controller.go`

### Reconciler contract

Source:
- `pkg/reconcile/reconcile.go`
- `TypedReconciler`
- `Request`
- `Result`

Observed implementation:
- A reconcile Request identifies the object by namespace/name; it does not carry the triggering Event or a snapshot of changed contents.
- The Reconciler performs a full reconciliation for the referenced object.
- Reconciliation is explicitly level-based: read current state and make it match the desired state, rather than branching on individual event types.
- Errors cause rate-limited requeue/backoff; explicit `RequeueAfter` requests a future reconciliation.
- `RequeueAfter` is distinguished from error retry: it is intended for waiting/polling external state, while errors use retry backoff.
- The implementation may change systems external to Kubernetes as well as Kubernetes objects.

Key invariant:
- **Events trigger reconciliation; current observed state determines what reconciliation does.**

### Controller runtime

Source:
- `pkg/internal/controller/controller.go`

Observed implementation:
- Controller starts event sources and a work queue, then launches workers.
- The queue/workers process reconciliation requests and ensure the reconcile handler is not concurrently invoked for the same object.
- Controller can apply a reconciliation timeout.
- Panic recovery is explicit and configurable.
- Leader election / warmup are runtime lifecycle concerns.
- Reconciler errors are recorded and fed into the queue retry behavior.

Key boundary:
- The Controller is the execution machinery around Reconcile; the Reconciler contains the domain reconciliation logic.

### Event-to-request translation

Source:
- `pkg/builder/controller.go`
- `Watches()`
- `Owns()`
- `WithEventFilter()`

Observed implementation:
- Watches connect object events to reconciliation requests through event handlers.
- Owned resources can enqueue reconciliation of their owner.
- Predicates can filter events before they create reconciliation work.
- The workqueue de-duplicates identical requests.

Important limitation for Project Control OS:
- Kubernetes controller-runtime is a concrete reconciliation runtime, not evidence that our Project Control OS must reproduce its workqueue/cache/leader-election machinery.
- The useful transferable invariant is the level-based reconciliation contract, not the entire Kubernetes implementation.

Status:
- **Implementation-backed reference.**
- Reconciliation semantics are sufficiently source-traced to inform the Project Control OS.
- Runtime machinery should remain a separate question.

---

## 8. Agent Harness — controller boundary / reconciliation-required

Source:
- Repository: https://github.com/0xenzyme/agent-harness
- `plugins/agent-harness/references/controller-communication.md`
- `harness/specs/2026-09-01-run-checkpoint-and-recovery-protocol.md`
- `docs/project-contract.md`
- `plugins/agent-harness/scripts/agent-harness.mjs`

### Controller boundary

Source:
- `plugins/agent-harness/references/controller-communication.md`

Observed implementation/protocol:
- Controller is defined as outcome owner and accepted-state owner.
- Controller communicates durable target, accepted scope, roots, Run/DAG node, ownership, verification, stop conditions, accepted-state owner, authoritative phase, and state-sync obligations.
- Host retains scheduling, delegation, concurrency, cancellation, and model selection.
- Executors return candidate evidence.
- Only the accepted-state owner records accepted Goal, Task, Run, gate, and bounded status state.

Important distinction:
- This project deliberately separates **outcome/state authority** from **runtime scheduling/execution**.

### Reconciliation-required

Source:
- `harness/specs/2026-09-01-run-checkpoint-and-recovery-protocol.md`
- `docs/project-contract.md`
- `docs/cli.md`

Observed implementation/protocol:
- If an external command may have started but its result is unknown, the system enters `reconciliation-required`.
- The same applies when an external action may have completed but checkpoint/state-sync failed, or when command return, project database, CI/CD, and Run evidence disagree.
- While reconciliation is required, blind retry is prohibited.
- Clearing reconciliation requires fresh evidence/reference and observation time.
- Explicit checkpoint updates carry `expected-revision`, control state, next action, pause reason, required evidence, prohibited actions, and reconciliation flag.

Meaning:
- Reconciliation is not simply “retry failed Run”.
- It is a **safe uncertainty state** whose next action is authoritative inspection.

---

## 9. Kubernetes + Agent Harness: common invariant

These two independent implementations provide unusually strong evidence for a common control-plane pattern:

1. Something observable changes or an execution result becomes available/uncertain.
2. A durable request/control state records what needs attention.
3. A controller/reconciler observes current authoritative state.
4. It compares current state with the desired/accepted outcome.
5. It chooses a bounded next action.
6. The action produces new observable state/evidence.
7. The controller observes again.
8. Uncertain external effects are not blindly repeated.

However, the implementations differ in an important way:

- Kubernetes primarily reconciles **desired resource state against observed system state**.
- Agent Harness primarily reconciles **accepted project outcome/state against execution evidence and synchronization state**.

Therefore “Controller/Reconciler” should not yet become one generic Project Control OS object. The source evidence suggests it may be a control pattern implemented over different authoritative domains.

---

## 10. Research status after Controller pass

Newly source-traced:
- Kubernetes level-based Reconciler contract.
- Kubernetes controller/workqueue/event-to-request machinery.
- Agent Harness controller ownership boundary.
- Agent Harness reconciliation-required uncertainty state.
- Agent Harness revision-safe checkpoint inputs.

Still not frozen:
- Project Control OS Controller API.
- Project Control OS Reconciler data model.
- Whether Controller and Reconciler are one module or separate modules.
- Whether Project Control OS needs a workqueue at all.
- Whether DSH Workflow/Team should be called by a reconciler directly or through a Runtime Adapter.

Next research target:
- **Durable execution + external side-effect uncertainty + idempotency**, traced to actual implementation code.
- Then compare that source chain with the existing Persistence Boundary proposal before changing the architecture.
