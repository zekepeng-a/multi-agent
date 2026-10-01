# G8 bounded dogfood Slice 4 — Runtime Adapter Substitution

**Status:** IMPLEMENTATION EVIDENCE — independent review pending.
**Date:** 2026-10-01.
**Branch:** `project-control/controller-v0.1`.
**Authorized baseline:** `9c96b28ff57b47c72ab9ca33a7110fbb87ed53cb`.
**Code/test HEAD:** `66c91e8a064debf392fd56d7227ba7cbddba5cc5`.
The following Evidence-only commit does not change implementation. Its CI is
observed separately; no G8 completion, Slice 5 or governance transition is made.

## Boundary and ownership

This is B — bounded integration proof under ADR-0004 and ADR-0009.
Production Controller, RuntimeAdapter, LocalProcess, DSH, Capsule, Store, Effect,
Policy and Acceptance code are unchanged. Existing Slice 1/3 helpers are unchanged.
The new test composition reuses those production classes and trusted guard patterns.
It adds no universal result/artifact schema, permission domain, runtime-selection
authority, durable DSH results, recovery capability or provider-specific Controller branch.

Two independent MemoryStore/SQLite fixtures start with unexecuted, equivalent
Project/Milestone/Goal/Task/Acceptance records. Logical state IDs are equal across
the separate stores; records are never shared. Command IDs are local-command and
dsh-command. Generated Run/Attempt/Capsule/Evidence IDs have different prefixes.
Runtime references are independently allocated and never substitute for control IDs.
An ACCEPTED Task is not reused to execute the other adapter.

Both fixtures bind the same actual READ_ONLY temporary snapshot of tracked repository
files, isolated from legacy test writes. They inspect PROJECT_BLUEPRINT.md and
package.json, check product/package declarations, compute SHA-256 hashes and observe
the same Workspace revision. Snapshot and control directories are test-owned and
removed after database handles close; no write Workspace/integration is exercised.

## Equivalent meaning and distinct launch configuration

Both Acceptance criteria are identical: required inspection-v1, semantic marker
G8_SUBSTITUTION_V1, expected file hashes, Workspace identity/revision and semantics
version. There is no adapterId correctness criterion or provider process fingerprint
in Acceptance. Provider launch integrity is independently enforced at authorization
and Adapter start.

The same inspect.repository / repository.read / task:g8-task / LOW intent uses real
durable Command, StaticPolicyEngine REQUIRE_APPROVAL, scoped Human Approval and
Controller.authorizeCommand. Each fixture owns its own Command and Approval.
Stored Command parameters bind the concrete provider-specific serial launch intent.
Current Project/Task, Policy/Approval and Workspace bindings are rechecked before
execution and immediately before calling the production adapter. DSH parent is an
exact test-owned live handle checked by identity, not serialized into Command/Capsule.
This remains bounded trusted composition, not a universal authorization API.

LocalProcess launch is a real Node command/args/cwd; the child reads real file bytes,
computes hashes/revision, emits JSON stdout and is bounded by a 5-second kill timer
cleared on close. No fake LocalProcess is used.

DSH launch carries workflow script/meta/args/maxTotalAgents plus the live parent.
Production DshWorkflowRuntimeAdapter calls injected workflowEngine.start(request).
The contract-faithful engine validates the expected request and really reads the
same files through the test semantic observer; it does not use hard-coded success.
It returns WorkflowRun.id, a result Promise, cancel() and dispose(). This engine
simulates the public seam; it does not evaluate the script in a live DSH host.
Cancellation is requested through production Adapter.cancel(), not a synthetic
RuntimeResult shortcut. Completed, error and cancelled collections dispose once;
repeated completed collection does not dispose twice.

## Capsule and normalized results

Both executions use the existing generation/freshness/reservation/receipt boundary.
Each has its own RunId/AttemptId/CapsuleId, snapshot/hash and receipt. Source family,
REQUIRED/SUPPLEMENTAL role, authority and current/history meaning are compared.
Runtime capabilities/adapter pins and Command provenance can differ without changing
source authority. No liveHandle or complete DSH workflow script is archived as a
Capsule launch config. Receipt binds Capsule/hash/Project/Task/Run/Attempt/RuntimeRef
and proves only Adapter input acceptance, not final model input or execution correctness.
Decision/Memory are not seeded by this fixture; their existing source rules are unchanged.

LocalProcess result contains stdout/stderr/exit/signal and process-output:// reference;
DSH contains value/stopReason/error/agentsStarted and dsh-workflow-result:// reference.
Their raw revisions are intentionally different and follow the unchanged provider
algorithms. The Slice 3 durable artifact helper is not used or extended to DSH.

Test-only decoders check provider terminal facts and recompute each provider's own
revision. They decode stdout or Workflow value into common semantic facts. The common
verifier checks ok/marker/hashes, actual cwd and current Workspace revision, Evidence
revision/ref, pinned Task/Acceptance version, full RuntimeRef and Run/Attempt/Capsule
lineage, plus RECEIVED receipt binding. Decoder errors yield FAIL. Adapter identity
selects only decoding, never a correctness verdict. Verifier returns Verification
only; existing Controller/Store record it and apply Acceptance.

## Positive traces and observed identities

Local: Human fixture → Goal/Task/Acceptance → Command/Policy/Approval → Capsule →
real LocalProcess → RuntimeResult → Candidate Evidence → decoder → common PASS →
Task ACCEPTED → Goal ACCEPTED → Milestone/Project COMPLETED.

DSH: independent equivalent fixture → Command/Policy/Approval → Capsule → production
DSH adapter → injected WorkflowRun → RuntimeResult → Candidate Evidence → decoder →
same common PASS → identical parent propagation. Event type sequences are equal.
Terminal repeat invocation adds no event or runtime start. Both create zero Effects.

One observed Windows positive trace (temporary fixture subsequently cleaned):

- Local Runtime externalId: ee9aeee9-d5cc-4c32-a85a-43a8b55c9459;
  Run local-run-2 / Attempt local-attempt-3 / Evidence local-evidence-5;
  resultRef process-output://ee9aeee9-d5cc-4c32-a85a-43a8b55c9459;
  revision d61703c05e1c07f2e1b1462856b5ceb69da1fc4321bdb56ce9ad6362c3c4f7f8.
- DSH externalId/workflowId: workflow-478a5fa1-506f-494f-8b7d-fe8bfc423d1c;
  Run dsh-run-2 / Attempt dsh-attempt-3 / Evidence dsh-evidence-5;
  resultRef dsh-workflow-result://workflow-478a5fa1-506f-494f-8b7d-fe8bfc423d1c;
  revision 45e673e56ea2945c4fb4b79c98731666714d743279382a4a715fc6629726e882.
- Both semantic outputs: ok=true, marker G8_SUBSTITUTION_V1;
  Blueprint hash b0103e244ad56d7aba02ae4a8cc5d15e26898dbdc3b04585801e4f3829b85e5c;
  package hash 0f59ba99e88ee448ac9cddc28c80dd99c9b98df9fcb17222c02eb90f3a953203;
  Workspace revision sha256:afdf59cca18a6f37e331101771a95c28f467327094e7f1502bf99ea479687477.

These are observed historical values, not stable IDs or retained result artifacts.

## Negative proof and verification

Both backends and adapters cover COMPLETED but wrong ok facts → FAIL/NEEDS_REVIEW;
FAILED (real Node exit 7 / Workflow error) → no Evidence/Verification/Acceptance;
receipt mismatch → UNKNOWN, no Evidence and no repeated start; unapproved/stale/wrong
Command → zero runtime starts; incorrect process or DSH script/meta/parent launch →
explicit refusal before execution. DSH cancel → CANCELLED, no Evidence/Acceptance.
Direct common-verifier fault injections reject decoder/revision/RuntimeRef/missing
Attempt lineage and prove verifier does not mutate Task. Existing production Store
lineage checks and prior Capsule suites remain separate regression coverage.

- New Slice 4: **38/38**, zero failures/skips on Node 22 (19 per backend).
- Affected suite: **469/469**, zero failures/skips, including Slices 1–3, Runtime,
  Capsule/restart, Controller, Policy/Approval, Acceptance/hierarchy, Store parity,
  persistence and SQLite initialization/competition stability.
- Final code full Node 22.23.3: **810 passed / 0 failed / 0 skipped**.
- Final code full Node 20.20.2: **481 passed / 0 failed / 329 expected SQLite capability skips**.
- Code/test HEAD CI [36856664260](https://github.com/zekepeng-a/multi-agent/actions/runs/36856664260):
  success; Node 22 job 110350653903 SQLite availability success and 810/0/0;
  Node 20 job 110350653556 481/0/329 expected capability skips.

## Remaining scope

This provides bounded runtime adapter substitution evidence for the same workload
and Acceptance/control semantics. It does not prove live DSH host/installation,
real parent Agent/model execution, DSH filesystem isolation, arbitrary substitution,
all-provider durable results, in-flight or DSH restart recovery, or G8 COMPLETE.
Both adapters keep resume/reconcile/pause/sendMessage/eventStream=false.
No real reconciliation, Effect, leases/fencing, Observability or new authority is added.
No new A/C/D/E was found in this implementation; independent review is still required.
A later candidate should address a demonstrated remaining proof gap (e.g. live-host
integration or whole-chain restart); runtime-specific in-flight observation remains
a D candidate requiring its own boundary decision. No next Slice is executed here.


## Independent review closure — recorded 2026-10-01

**Current reviewed status: PASS. Independent review outcome: PASS.** Equivalent independent fixture substitution, real LocalProcess, DSH public seam, provider-neutral Acceptance, decoder/common-verifier separation, authorization/Capsule boundaries and wrong-content symmetry accepted. Independent direct Controller probes confirmed terminal NOOP and UNKNOWN no-blind-retry for both adapters/backends. Live DSH/in-flight recovery remain excluded; no new C/D/E.

Human authorized this governance review-record convergence at baseline `7dad1894f802bdd6076a9320731c918a7a765e0a`. Original submission status, historical wording, test counts and failure/repair evidence above are retained. This section supplies current disposition. G8 is FINAL CONVERGENCE REVIEW READY, not COMPLETE; final exit review and separate governance completion remain necessary.
