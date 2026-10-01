# ADR-0004 — Capability-shaped Runtime Adapter boundary

**Status:** ACCEPTED  
**Date:** 2026-09-30  
**Roadmap phase:** G5 — Real Runtime Adapter  
**Related invariants:** I-05, I-06, I-07, I-08, I-14, I-18, I-24, I-32, I-33

## Context

Project Control currently executes Task Runs through `FakeRuntime`. That proves
Controller semantics deterministically but does not yet prove runtime
replaceability against a real execution substrate.

The earlier conceptual adapter sketch listed:

```text
createRun()
start()
pause()
resume()
cancel()
getStatus()
getEvents()
collectResult()
```

Focused G5 research shows that this is too universal.

Current DeepSeek Harness Workflow exposes a live run with:

- `start()`;
- stable runtime id;
- terminal result Promise;
- `cancel()`;
- `dispose()`;
- observe-only workflow events.

It does not expose generic pause/resume/getStatus APIs.

DSH Subagent and Codingns4DSH show another important fact: capabilities vary by
provider. Resume, interrupt, send-message, permission interaction and streaming
are not universal.

Therefore Project Control needs a minimal mandatory execution seam plus explicit
optional capabilities.

## Decision

### 1. RuntimeAdapter is execution authority, not Project State authority

A RuntimeAdapter may:

- start external work;
- observe runtime state;
- cancel/interact where supported;
- collect runtime results;
- return opaque runtime references.

It may **not**:

- mark Task/Goal/Milestone accepted;
- create Verification verdicts;
- mutate Project State directly;
- reinterpret runtime success as Acceptance.

Controller remains the accepted-state owner.

### 2. Run / Attempt remain Project Control identities

Project Control creates and owns:

```text
RunId
AttemptId
```

before asking a runtime to execute.

The adapter returns runtime-domain references separately.

A runtime SessionId / WorkflowId / TeamId / process id is never reused as a RunId
or AttemptId.

### 3. Mandatory adapter core

Every RuntimeAdapter must provide:

```js
capabilities() -> RuntimeCapabilities

start({
  run,
  attempt,
  workspace,
  contextCapsule,
  signal?
}) -> RuntimeStartResult

observe(runtimeRef) -> RuntimeObservation

collectResult(runtimeRef) -> RuntimeResult

cancel(runtimeRef, reason?) -> void | Promise<void>
```

The exact language binding may vary, but these semantics are stable.

### 4. Capabilities are explicit and fail loud

RuntimeCapabilities includes at least:

```yaml
adapter_id: string
runtime_kind: string
resume: boolean
send_message: boolean
event_stream: boolean
reconcile: boolean
pause: boolean
```

Optional operations may exist only when the matching capability is true:

```text
resume()
sendMessage()
subscribeEvents()
reconcile()
pause()
```

A caller requesting an unsupported operation receives a typed/fail-loud error.

There is no silent degradation such as treating `resume` as a new start.

### 5. Runtime references are opaque to Project Control semantics

A normalized `RuntimeRef` may carry adapter-specific data:

```yaml
adapter_id: string
runtime_kind: string
external_id: string
session_id: string?
workflow_id: string?
team_id: string?
provider: string?
metadata: object
```

Project Control may persist this reference for recovery/observation.

Only the adapter interprets adapter-specific fields.

Controller/store code may compare identity and persist the object, but must not
branch on DSH-specific Session/Workflow/Team meaning.

### 6. RuntimeObservation is normalized and non-authoritative

Normalized runtime observation:

```yaml
state:
  - STARTING
  - RUNNING
  - WAITING
  - COMPLETED
  - FAILED
  - CANCELLED
  - LOST
observed_at: timestamp
runtime_ref: RuntimeRef
details: object
```

This is an observation.

It does not directly mutate Task State.

Controller maps observation to the existing Run/Attempt lifecycle.

### 7. RuntimeResult is candidate execution output, not Evidence by itself

Normalized terminal result:

```yaml
outcome: COMPLETED | FAILED | CANCELLED | LOST
result_ref: string?
revision: string?
runtime_ref: RuntimeRef
completed_at: timestamp?
details: object
```

Controller may use a valid COMPLETED RuntimeResult to construct **Candidate
Evidence** through the existing Evidence path.

The adapter itself does not create accepted Evidence.

### 8. Cancellation does not imply rollback or no external effect

`cancel()` means a stop request was issued to the runtime.

It does not prove:

- the runtime stopped immediately;
- already-performed external effects were undone;
- the Attempt is safe to retry.

If an external effect is uncertain, G3 Effect/Reconciliation rules still apply.

### 9. Reconciliation remains capability-gated

A runtime may offer a runtime-specific `reconcile(runtimeRef)` observation.

When unsupported, Project Control must use other evidence/effect observation or
remain blocked.

Runtime reconciliation must not bypass the durable Effect uncertainty rules.

### 10. DSH binding

A DSH Workflow adapter maps:

```text
workflowEngine.start()     → start()
WorkflowRun.id             → RuntimeRef.external_id/workflow_id
WorkflowRun.result         → collectResult()
WorkflowRun.cancel()       → cancel()
workflow events            → optional subscribeEvents()
dispose()                  → adapter-owned cleanup
```

DSH Workflow has no universal resume/pause; those capabilities are false.

A DSH Subagent/continuable adapter may later expose resume/sendMessage/interrupt
because that provider seam supports them.

Agent Team identity is preserved only inside RuntimeRef/adapter metadata.

### 11. G5 implementation uses two proofs

G5 will implement:

1. **LocalProcessRuntimeAdapter**
   - executes a real OS child process in CI;
   - proves that the Project Control adapter contract handles real start,
     observation, cancellation and result collection without FakeRuntime.

2. **DshWorkflowRuntimeAdapter**
   - binds the real DSH Workflow contract through an injected
     `workflowEngine` object;
   - no hard dependency on the entire DSH application is required;
   - tests use a contract-faithful fake engine, while the production adapter code
     calls the real `start / result / cancel / dispose` seam when hosted in DSH.

The local process adapter supplies real execution proof; the DSH adapter supplies
the intended production integration boundary.

### 12. Existing Controller execution flow may be generalized, not duplicated

The current Task Controller flow already owns:

```text
Run
Attempt
runtime.start()
runtime result
Evidence
Verification
Acceptance
```

G5 should replace the FakeRuntime-specific assumptions with the normalized
RuntimeAdapter contract rather than add a second execution path.

FakeRuntime remains a deterministic adapter/test double.

## Alternatives considered

### A. Keep one maximal interface with pause/resume/getEvents everywhere

Rejected. Current DSH implementations do not provide those semantics uniformly.

### B. Make DSH SessionId the Project Control RunId

Rejected. It collapses runtime identity into Project Control identity and breaks
runtime replaceability.

### C. Let each runtime adapter update Task/Run state itself

Rejected. It moves state authority into replaceable execution plugins.

### D. Implement only a DSH-specific adapter with no generic contract

Rejected. It would couple Project Control to the current runtime and violate
I-24.

### E. Use only LocalProcessRuntimeAdapter and postpone DSH shape

Rejected for G5. It would prove a generic process seam but not that the intended
DSH integration fits the same authority boundary.

## Consequences

Positive:

- runtime capabilities become explicit instead of assumed;
- DSH Workflow, DSH Subagent, Codingns4DSH external Agents and local processes
  can fit behind one Project Control boundary;
- runtime-specific durable identities survive without becoming project
  authority;
- FakeRuntime remains useful for deterministic tests;
- real process execution can be tested in CI.

Costs:

- Run/Attempt records need an opaque `runtimeRef` or equivalent persistence
  field for recovery;
- current Controller runtime assumptions need normalization;
- DSH adapter cleanup/cancellation must honor holder ownership;
- a complete DSH integration smoke test still depends on running inside a DSH
  environment.

## Implementation boundary

After this ADR, the following becomes **B — Missing Implementation**:

- RuntimeCapabilities / RuntimeRef / RuntimeObservation / RuntimeResult vocabulary;
- RuntimeAdapter validation helpers / unsupported-capability error;
- adapt FakeRuntime to the normalized contract;
- LocalProcessRuntimeAdapter using a real child process;
- DshWorkflowRuntimeAdapter over injected `workflowEngine`;
- persist runtimeRef on Run/Attempt as needed;
- Controller maps normalized runtime results into the existing
  Run/Attempt/Evidence path;
- cancellation/LOST semantics remain fail-safe;
- contract tests across FakeRuntime and LocalProcessRuntimeAdapter;
- DSH adapter contract tests;
- at least one real local-process execution E2E in CI.

Still outside G5:

- workspace isolation/write scopes (G6);
- DSH Agent Team task DAG as Project Task authority;
- DSH/Codingns UI integration;
- automatic model/provider routing;
- policy authoring;
- Command completion aggregation;
- converting runtime events directly into Acceptance.

## Verification / exit criteria

G5 is complete only if tests prove:

1. Project RunId/AttemptId remain independent of runtime ids;
2. unsupported runtime capabilities fail loudly;
3. LocalProcessRuntimeAdapter executes a real child process and yields a
   normalized COMPLETED result;
4. a real non-zero process exit becomes normalized FAILED, not Acceptance;
5. cancellation is observable and does not imply Task acceptance;
6. Controller creates Candidate Evidence only from normalized COMPLETED result;
7. runtime failure/loss does not create PASS Verification or Acceptance;
8. runtimeRef survives the Project Control persistence path needed for
   observation/recovery;
9. DshWorkflowRuntimeAdapter maps start/result/cancel/dispose correctly;
10. DSH Workflow's lack of resume/pause is represented as capability=false;
11. adapter/runtime ids never replace Run/Attempt ids;
12. FakeRuntime still passes deterministic controller tests;
13. latest Node 22 full CI passes with zero skips.
