# G5 Runtime Adapter — Implementation Evidence

**Roadmap phase:** G5  
**Architecture decision:** `ADR-0004-runtime-adapter-boundary.md`  
**Verified head:** `6d526ebdfca0884a1d721d38f32d979e535b8ad7`  
**CI run:** GitHub Actions `36682281123`

## Implemented boundary

G5 replaces the previous runtime-specific assumptions with a normalized,
capability-shaped Runtime Adapter contract.

Mandatory adapter semantics:

```text
capabilities()
start()
observe()
collectResult()
cancel()
```

Optional operations remain capability-gated and fail loud when unsupported.

Project Control continues to own RunId/AttemptId. Runtime identities are persisted
only as opaque RuntimeRef values on Attempts and never substitute for Project
Control identity.

## Runtime contract

Implemented in `project-control/runtime-adapter.mjs`:

- RuntimeState;
- RuntimeOutcome;
- RuntimeCapabilities;
- RuntimeRef;
- RuntimeObservation;
- RuntimeResult;
- unsupported-capability error;
- adapter contract validation helpers.

A RuntimeResult is execution output, not Verification/Acceptance.

## FakeRuntime migration

`FakeRuntime` now implements the normalized Runtime Adapter contract while
preserving deterministic historical probes used by controller tests.

This proves the existing Project Control execution/acceptance behavior does not
depend on the old single-call runtime result shape.

## LocalProcessRuntimeAdapter

`project-control/local-process-runtime.mjs` executes a real OS child process.

CI proves:

- zero exit → normalized COMPLETED;
- non-zero exit → normalized FAILED;
- explicit cancellation → normalized CANCELLED;
- stdout/stderr/result reference/revision are captured;
- runtime process identity is separate from RunId/AttemptId.

A Controller integration test uses LocalProcessRuntimeAdapter end-to-end:

```text
Task
 → Run
 → Attempt
 → real child process
 → normalized COMPLETED
 → Candidate Evidence
 → Verification
 → Acceptance
```

A failed real process creates no Evidence and no Acceptance.

## DshWorkflowRuntimeAdapter

`project-control/dsh-workflow-runtime.mjs` binds the current public DSH Workflow
seam through an injected `workflowEngine`.

Mapping:

```text
workflowEngine.start() → RuntimeAdapter.start()
WorkflowRun.id         → opaque RuntimeRef.workflowId
WorkflowRun.result     → collectResult()
WorkflowRun.cancel()   → cancel()
WorkflowRun.dispose()  → adapter-owned cleanup
```

DSH Workflow pause/resume are explicitly reported unsupported rather than silently
simulated.

The production adapter code calls the same public seam documented by current DSH;
contract tests use a faithful fake WorkflowEngine so CI does not require a live
DSH host.

## Controller normalization

The Task Controller now:

1. creates Project Control Run/Attempt identities;
2. calls RuntimeAdapter.start();
3. persists RuntimeRef on the Attempt;
4. collects normalized RuntimeResult;
5. maps only normalized COMPLETED into Candidate Evidence;
6. maps LOST to the existing blocked/reconciliation path;
7. maps FAILED/CANCELLED without manufacturing Evidence/Acceptance.

A compatibility branch remains for older injected runtimes while callers migrate,
but the repository's FakeRuntime and new adapters use the normalized contract.

## Runtime identity persistence

The cross-process SQLite restart probe now verifies that Attempt.runtimeRef:

- survives a real process restart;
- remains distinct from RunId;
- remains distinct from AttemptId.

Runtime identity is therefore recoverable without becoming Project authority.

## Verification

Latest full CI:

```text
Node 22.23.2
tests   492
pass    492
fail    0
skipped 0
```

Package-floor CI:

```text
Node 20.20.2
tests   492
pass    333
fail    0
skipped 159
```

Node 22 continues to assert built-in `node:sqlite` availability before tests.

## ADR-0004 exit criteria assessment

1. RunId/AttemptId independent of runtime ids — covered;
2. unsupported capabilities fail loudly — covered;
3. real child process COMPLETED normalization — covered;
4. non-zero process exit becomes FAILED — covered;
5. cancellation is explicit and does not imply Acceptance — covered;
6. Controller creates Candidate Evidence only from COMPLETED — covered;
7. failure/loss does not create PASS/Acceptance — covered;
8. RuntimeRef persists through restart — covered;
9. DSH Workflow start/result/cancel/dispose mapping — covered;
10. DSH pause/resume represented unsupported — covered;
11. runtime ids never replace Run/Attempt ids — covered;
12. FakeRuntime deterministic controller suite still passes — covered;
13. Node 22 full CI passes with zero skips — covered.

This satisfies the G5 exit gate.

## Boundary for G6

G5 proves Project Control can sit above replaceable runtimes.

G6 now addresses a separate authority problem:

> when multiple executions touch code/files, what Workspace identity, isolation,
> revision lineage and integration rules make those writes safe and auditable?

Runtime replaceability alone does not solve workspace concurrency.
