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


---

## 11. AgentLedger — durable side-effect ledger / idempotency / unknown-state handling

Source:
- Repository: https://github.com/yaogdu/AgentLedger
- `src/agentledger/tools.py`
- `src/agentledger/store.py`
- `src/agentledger/runtime.py`

### Tool contract carries side-effect semantics

Source:
- `src/agentledger/tools.py`
- `ToolSpec`
- `ToolGateway.call()`

Observed implementation:
- `ToolSpec` explicitly declares `side_effect`, `risk_level`, `idempotency_required`, `approval_required`, and sandbox requirements.
- `ToolGateway.call()` computes a request hash and an idempotency key before executing a managed side-effect tool.
- Managed side effects are recorded in a persistent Tool Ledger before execution.
- A previously `SUCCEEDED` ledger entry causes the stored response to be replayed instead of invoking the external tool again.
- An existing `PENDING_VERIFICATION` entry blocks another execution instead of blindly retrying.
- `RESERVED` / `RUNNING` entries are also treated as already in progress.

Meaning:
- Idempotency is not merely a prompt instruction. It is part of the runtime/tool contract and execution path.
- The runtime distinguishes ordinary computation from operations whose effects must be tracked.

### Side-effect uncertainty is represented explicitly

Source:
- `src/agentledger/tools.py` — exception path in `ToolGateway.call()`
- `src/agentledger/store.py` — `reserve_ledger()`, `update_ledger()`, `resolve_ledger()`

Observed implementation:
- After a managed side-effect tool throws, the ledger is moved to `PENDING_VERIFICATION`.
- `resolve_ledger()` only permits explicit resolution to `SUCCEEDED` or `FAILED_NO_EFFECT`.
- A successful manual resolution requires a response reference.
- Resolution writes a `tool_ledger_resolved` event containing resolver, reason, previous status, new status, external id, and response reference.
- A ledger row must belong to the current Run and must currently be `PENDING_VERIFICATION` before it can be resolved.

Meaning:
- This is direct implementation evidence for a durable **uncertain side-effect state**.
- The system does not equate a local exception with “the external operation definitely did not happen”.
- Recovery therefore begins with observation/reconciliation, not automatic duplicate execution.

### Durable event history and state versioning

Source:
- `src/agentledger/store.py`
- `append_event()`
- `commit_state_patch()`
- `mark_retry()`

Observed implementation:
- Events are appended with per-Run sequence numbers and optional state version / causal token / payload hash / payload reference.
- State patches require the worker lease to be valid and require the supplied `base_version` to equal the current Run state version.
- Successful state commit increments the version and records `state_committed` and `step_completed` events.
- Retry classification is recorded as an event before the step is either failed permanently or moved to `retry_scheduled`.

Meaning:
- Durable execution is not just “save some JSON”. It couples state revision, worker ownership, event history, and retry classification.
- This gives source-backed precedent for separating mutable state from append-oriented history.

### Runtime recovery boundary

Source:
- `src/agentledger/runtime.py`
- `Runtime.run_once()`

Observed implementation:
- A worker first claims a Step and receives a lease token / attempt number.
- The agent executes against a snapshot containing Run state and state version.
- Completion commits a state patch using the expected base version and lease token.
- Simulated crashes and retryable failures go through `mark_retry()`; non-retryable failures go through `mark_failed()`.
- Human approval is a separate waiting state.

Boundary:
- AgentLedger's Runtime owns execution durability and side-effect safety; it does not claim to own product/project planning or acceptance authority.

### Important limitation

AgentLedger is a strong implementation reference for runtime reliability, but it is not evidence that Project Control OS should reproduce AgentLedger wholesale. Its own stated scope is a reliability runtime beneath/alongside agent frameworks.

Status:
- **Implementation-backed reference.**
- Strong evidence for: Tool Ledger, idempotency keys, explicit uncertain side-effect state, durable event history, optimistic state revision, leases, and retry classification.
- Not yet evidence for: Project/Goal/Task acceptance semantics or the full Project Control model.

---

## 12. Temporal — durable execution and the exact-once trap

Source:
- Repository: https://github.com/temporalio/temporal
- `docs/architecture/README.md`
- Temporal documentation source: `documentation/docs/encyclopedia/activities/activity-definition.mdx`
- Temporal documentation source: `documentation/docs/encyclopedia/activities/activity-execution.mdx`

Observed implementation/architecture documentation:
- Temporal stores an append-only Event History for each Workflow Execution and reconstructs Workflow state by replay.
- Workflow code is required to be deterministic and side-effect free, while Activities are the units that interact with the outside world.
- Activities can be retried; a worker can successfully perform an external operation and then crash before reporting completion, causing the Activity to execute again.
- Temporal therefore recommends idempotent Activities and supports application-level idempotency keys.
- The documentation explicitly distinguishes **exactly-once observed completion** from the possibility that an Activity executes multiple times.
- Activity retry policy and durable retry state are runtime concerns, not Project Control acceptance state.

Important consequence:
- “Exactly once” must not be used loosely to mean “the external side effect happened exactly once”.
- A durable runtime can provide a single logical completion record while an external operation may have executed more than once unless the external service also provides suitable idempotency semantics.

Boundary:
- Temporal is strong evidence for durable execution and retry semantics, but not for our Project/Goal/Task acceptance authority.

Status:
- **Implementation-backed architecture reference plus official source documentation.**
- Strong evidence for: event history, deterministic workflow / side-effecting activity separation, retry semantics, and application-level idempotency.
- The external-side-effect exactly-once boundary must remain explicit.

---

## 13. Cross-source invariant: recovery is not retry

AgentLedger and Temporal independently support a more precise invariant than the earlier generic “retry with idempotency” wording:

1. Execution may be retried because durable runtime state says completion is absent.
2. The external world may nevertheless already contain the effect.
3. Therefore the runtime must distinguish **execution retry** from **external-effect duplication safety**.
4. Idempotency keys / external idempotency semantics reduce duplicate effects.
5. If the runtime cannot establish whether the effect happened, it needs an explicit uncertainty/reconciliation path rather than blind retry.

This aligns with the earlier Agent Harness `reconciliation-required` protocol, but the evidence now comes from a second independent runtime implementation.

### Architectural consequence — still research, not frozen

The current Persistence Boundary should eventually be checked against at least these runtime records:
- Run / Attempt
- Worker lease
- Command or Tool invocation
- Idempotency key
- Effect / Tool Ledger entry
- External receipt/reference
- Append-only event
- Uncertainty / reconciliation state
- Verification result

This is a research consequence, **not yet a schema decision**.

---

## 14. Research status after durable-execution pass

Newly source-traced:
- AgentLedger ToolSpec side-effect/idempotency contract.
- AgentLedger ToolGateway idempotency and ledger reservation/replay path.
- AgentLedger `PENDING_VERIFICATION` side-effect uncertainty state and explicit resolution path.
- AgentLedger lease + state-version + retry/event implementation.
- Temporal event-history / Workflow-vs-Activity boundary and retry/idempotency semantics.

Still not frozen:
- Project Control OS Effect Ledger schema.
- Project Control OS Command/Effect relationship.
- Whether reconciliation belongs to Controller, Effect subsystem, or a separate Recovery component.
- Whether a dedicated durable-execution runtime is needed at all, versus adapting DSH/external runtimes.

Next research target:
- **Acceptance / verification / artifact lineage**: trace how real systems bind evidence to a specific revision/artifact and prevent stale or mismatched evidence from completing a task.
- Then compare that source chain with our existing Acceptance/Evidence invariants before changing architecture.


---

## 15. Acceptance / verification / artifact lineage — source-backed pass

### Agent Harness: candidate evidence is not accepted state

Source:
- `plugins/agent-harness/references/worker-runner-contract.md`
- `plugins/agent-harness/references/artifact-lifecycle.md`
- `plugins/agent-harness/scripts/agent-harness.mjs`

Observed implementation contract:
- Each DAG node records Goal/Run, dependencies, ownership, allowed/forbidden scope, execution cwd, verification, stop conditions, and a candidate result artifact.
- Workers return changed files, verification, risks, State Sync Notes, and remaining work as **candidate evidence**.
- Workers never update accepted Goal, Task, status, Run, or gate state.
- The accepted-state owner validates candidate evidence and records durable state.
- A local-only Run path is explicitly described as a locator, not durable evidence by itself.
- Before a Run is pruned, configured durable evidence must retain the accepted conclusion, verification summary, and required audit reference.
- Nonterminal or invalid checkpoints remain operationally active and cannot be pruned merely because a legacy Run phase says `blocked`.

Meaning:
- Acceptance authority and execution artifacts are deliberately separated.
- A file path to a Run is not equivalent to durable proof.
- Artifact retention is part of correctness when historical evidence is required for later state decisions.

### Agent Harness: contract drift invalidates completion continuity

Source:
- `harness/specs/2026-09-01-run-checkpoint-and-recovery-protocol.md`
- `docs/cli.md`
- `CHANGELOG.md`

Observed behavior:
- Managed Run checkpoints use an expected revision.
- Contract/scope drift causes a checkpoint to become `replan-required`.
- Uncertain external state causes `reconciliation-required`, with an inspect-next action and prohibited blind retries.
- Checkpoint updates are revision-safe; concurrent record operations use Run locking and atomic artifact writes.
- The project contract states that postflight sync must use fresh verification and observed outcome; old evidence does not silently become current truth.

Meaning:
- Evidence has a **validity context**, not just a boolean verified flag.
- A Run can produce evidence and later become invalid for completion because its contract changed.

### Archify: repository evidence is pinned separately from authored claims

Source:
- Repository: `tt-a1i/archify`
- `archify/delta/architecture-delta.mjs`
- `archify/bin/archify.mjs`
- `archify/test/architecture-delta.test.mjs`
- `docs/research-architecture-delta-pr-proof-2026-07-23.md`

Observed implementation:
- Architecture entities use authored stable IDs; missing or duplicate IDs fail closed.
- Repository identity is compared before provenance can be treated as comparable.
- `proofLevel` becomes `revision-pinned` only when both sides have verified repository evidence and full 40-character revisions.
- The compare receipt records raw input SHA-256 and semantic SHA-256 separately.
- Repository evidence is treated as a distinct change classification from semantic/geometry changes.
- Rendered source evidence is checked for a verified repository URL, revision, and reference count before it can qualify as complete.
- Repository mismatch is a hard failure rather than an inferred correspondence.
- The implementation explicitly does not infer runtime impact, risk, causality, mergeability, or other claims from an architecture diff.

Meaning:
- Provenance is not merely a text field attached to an artifact; it has validation gates and identity checks.
- Exact input identity and semantic identity can legitimately be different and both matter.
- “Verified” must be scoped to a concrete source/revision and a defined claim.

### Earthwalker Agent OS: verification evidence is bounded and lineage is explicit

Source:
- Repository: `earthwalker17/agent-os`
- `backend/execution/recovery_matrix.py`
- `backend/execution/models.py`
- `backend/main.py`

Observed implementation:
- Recovery contracts define accepted evidence and verification separately for build/runtime/visual/integration/deployment/database/product recovery.
- Recovery evidence is bounded, redacted, and attached to a concrete failed Run.
- Recovery child Runs carry `recovery_of` lineage.
- Per-task patch workspaces keep a `manifest.json` audit artifact.
- The architecture describes `run.json` as a compact record-level view while detailed per-wave/per-task information lives in separate artifacts.

Meaning:
- Evidence should be bounded and attributable to a specific Run.
- Recovery creates lineage rather than overwriting the original execution history.
- Large/detail artifacts should remain externally referenced instead of bloating the authoritative Run record.

---

## 16. Cross-source invariant: Evidence needs identity + scope + freshness

The evidence now supports a stronger invariant than merely “Evidence before Acceptance”:

`Evidence is acceptable only relative to an explicit subject, source/revision, scope, verification method, and freshness/validity context.`

At minimum, source evidence suggests tracking some combination of:
- evidence_id
- subject (Task/Run/Artifact/etc.)
- source reference
- source revision / artifact identity
- scope covered
- verification method/result
- observed_at
- provenance / lineage
- validity or supersession state

This is still a **research invariant**, not a frozen storage schema.

Important distinction:
- **Evidence identity** answers “which observation/result is this?”
- **Artifact identity** answers “which concrete bytes/output does it describe?”
- **Source identity** answers “which repository/revision did it inspect?”
- **Acceptance** answers “does this evidence satisfy this Task's acceptance contract?”

These must not collapse into one `verified=true` flag.

---

## 17. Research boundary check

This pass materially changed the model in one way: it exposed **evidence validity/provenance** as a first-class boundary rather than a simple property of Evidence.

At this point the major control-plane failure classes have independent implementation-backed precedents:

1. current-state reconciliation — Kubernetes
2. accepted-state authority — Agent Harness
3. uncertain external effects — Agent Harness / AgentLedger
4. idempotent durable tool execution — AgentLedger / Temporal
5. optimistic revision / concurrent state safety — AgentLedger / Kubernetes / Agent Harness
6. artifact/provenance identity — Archify
7. candidate-vs-accepted evidence — Agent Harness
8. recovery lineage — Earthwalker Agent OS

This does **not** mean the architecture is finished. It means the next research should move from isolated mechanisms toward **cross-system boundary comparison** rather than collecting more projects that repeat the same vocabulary.

Next target:
- Compare the above systems' **command/event/state boundaries and controller authority boundaries**.
- Search for counterexamples or incompatible designs.
- Stop archaeology when new sources no longer reveal a new invariant, authority boundary, failure mode, or materially different persistence/recovery strategy.


---

## 18. Command → Event → State → Controller boundary comparison

This pass intentionally looked for architectures that disagree with a simple mutable-state control plane.

### Hyperkernel: strongest counterexample against collapsing Command/Event/State

Source:
- Repository: `hnordt/hyperkernel`
- `AGENTS.md`
- `docs/design/0006-error-handling-and-recovery.md`
- `docs/design/0008-process-orchestration-and-actor-model.md`

Observed design/proposed contract:
- Commands record intent; events record accepted facts; projections expose derived read models.
- A committed state-changing command emits events atomically rather than directly mutating a projection/authoritative table.
- Rejected commands emit no domain-state event.
- Optimistic concurrency is part of command acceptance.
- An unconfirmed outcome is a durable safety state requiring reconciliation.
- Replay must not redispatch external effects.
- The proposed actor/process layer explicitly remains below the command/event/projection contracts; its design record is still a draft/evaluation boundary.

Important limitation:
- Hyperkernel's actor/process orchestration material is explicitly draft, so it is evidence of a design hypothesis, not proof of production maturity.

Meaning:
- Command, Event, Projection/State, and long-running Process are useful separate boundaries.
- Recovery semantics belong to the boundary that knows enough context to decide whether retry/reconciliation is safe.
- A mutable `STATE` file should not be treated as the architectural source of truth merely because it is convenient.

### Kando: stronger counterexample against requiring a mutable authoritative state store

Source:
- Repository: `ucalyptus/kando`
- `tutorials/02-ledger-is-the-agent.md`
- `docs/adr/ADR-003-world-as-deterministic-projection.md`
- `docs/adr/ADR-012-hash-verified-replay.md`

Observed design:
- One append-only event ledger is the source of truth.
- World/object/relation state is a deterministic projection of the ledger.
- Snapshots are optimizations, not authority.
- Events are immutable and carry causal parent IDs.
- Kando's proposed hash-verified replay compares reconstructed world hashes to detect projection divergence.

Important limitation:
- ADR-012 is explicitly Proposed and not yet implemented; therefore hash-verified replay is a design proposal, not an implementation guarantee.

Meaning:
- Our architecture must not hard-code SQLite mutable tables as the only legitimate state model.
- The Project Control model can define **semantic authority** (who/what is authoritative) without prematurely defining **physical persistence** (tables vs event log vs hybrid).
- A hybrid implementation remains possible: authoritative aggregates + append-only events/evidence + projections.

### Stratum: action admission can be event-driven without making events the project model

Source:
- Repository: `mihok-labs/stratum`
- README architecture description.

Observed design:
- Actions have runtime reversibility/risk classification.
- Higher-risk actions are parked for human resolution.
- An event bus carries action/escalation/audit events.
- State is described as a projection of the audit/event history.

Meaning:
- Event-driven orchestration is a viable execution/control technique.
- It does not prove that all Project Control semantics should be implemented as event choreography.

### Maka: log-first projection is another independent implementation pattern

Source:
- Repository: `maka-agent/maka-agent`
- `ARCHITECTURE.md`

Observed architecture statement:
- Runtime events are append-only facts.
- Session state, model context, TaskRun, self-check, and evolution evidence are projections for different consumers.
- Graph scheduling uses durable schedule metadata but sends execution back through the same Runtime.

Meaning:
- The same semantic separation appears in another Agent Runtime, independently of Hyperkernel/Kando.
- This strengthens the case for distinguishing execution facts from consumer-specific projections.

---

## 19. New synthesis: semantic authority ≠ persistence mechanism

After the counterexample pass, the architecture should freeze the following distinction:

**Semantic authority**
- Which object/process is allowed to declare a fact authoritative?
- Which evidence is sufficient for acceptance?
- Which controller owns reconciliation?
- Which command/event transition is legal?

**Physical persistence**
- SQLite mutable state
- append-only event log
- event log + projections
- relational state + append-only audit/event history
- external artifact/blob storage

The first is architecture-level and should be frozen.
The second remains an implementation choice until concrete persistence requirements force a decision.

This prevents two opposite mistakes:
1. treating `STATE.json` / SQLite rows as the source of truth merely because they are easy to inspect;
2. prematurely forcing full event sourcing because several interesting projects use it.

---

## 20. New synthesis: Controller authority is more stable than orchestration style

The archaeology now supports a stronger statement:

> The Project Control OS needs a clear **accepted-state owner** and reconciliation boundary, but it does not yet need to choose between centralized orchestration, workflow state machines, actor-style processes, or event choreography.

Evidence:
- Agent Harness separates accepted-state ownership from host scheduling/delegation.
- Kubernetes uses reconciliation around observed state.
- Hyperkernel keeps domain command/event/projection authority separate from a still-experimental process orchestration layer.
- Kando uses reactive responders instead of a central orchestrator.
- Stratum uses an event bus + DAG orchestrator for action execution.
- Maka uses log-first projections + graph control.

Therefore:
- **Controller / authority boundary = architecture invariant.**
- **Orchestration mechanism = replaceable execution strategy.**

This is materially stronger than the earlier framing.

---

## 21. Research boundary check — current status

The archaeology has now covered:
- state reconciliation
- command/event/state separation
- accepted-state authority
- evidence provenance
- artifact identity
- artifact lineage
- external-effect uncertainty
- idempotency
- optimistic concurrency
- leases/fencing
- event-log projection
- centralized orchestration
- event choreography
- actor/process orchestration
- workflow/runtime separation

The next pass should therefore **not** search broadly for more agent frameworks.

Only three questions remain worth targeted archaeology:

1. **Acceptance Gate Semantics**
   - How mature systems bind a verification result to the exact Task contract + artifact revision + evidence scope.
2. **Revision / Version Lineage**
   - How systems invalidate or supersede accepted state when source/artifact/project revision changes.
3. **Human Approval Boundary**
   - How approval, rejection, cancellation, and manual override are represented without allowing UI/runtime code to mutate authoritative state directly.

If these three passes do not reveal a new authority boundary, invariant, failure mode, or materially different recovery model, archaeology stops and architecture convergence begins.
