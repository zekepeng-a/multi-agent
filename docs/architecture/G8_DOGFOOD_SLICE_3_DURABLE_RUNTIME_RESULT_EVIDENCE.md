# G8 bounded dogfood Slice 3 — durable/readable completed Runtime result

**Status:** IMPLEMENTATION EVIDENCE — independent review pending.
**Date:** 2026-10-01.
**Branch:** `project-control/controller-v0.1`.
**Authorized baseline:** `9146ab3a23719b56789c801430efa1c0292074d7`.
**Code/test HEAD:** `fe92075eec878106e53a16afa0d7bb7eeba3361b`.
The subsequent Evidence-only commit changes no implementation. No G8 completion,
Slice 4 execution, accepted ADR or governance change is made.

## Settled boundary and ownership

ADR-0004's RuntimeResult contract is reused unchanged: outcome, runtimeRef,
resultRef, revision, completedAt, details. Runtime/provider owns the result
files; Project Control persists references and creates candidate Evidence.
The artifact itself is neither Evidence nor Acceptance authority.

`tests/helpers/g8-durable-local-process-runtime.mjs` extends LocalProcess only
for this test composition. It executes the real Node process, drains stdout/
stderr through child close and archives the completed result in an independent
test-owned `g8-durable-provider-*` temporary directory outside SQLite,
repository and read-only Workspace. No production file is modified. No general
Artifact Store, Artifact identity/domain, ownership, retention, addressing or
cross-runtime schema is introduced. Fixture cleanup removes these files.

Production LocalProcess still has an in-memory executions Map and advertises
resume=false, reconcile=false. This test adapter retains those capabilities.
It adds no in-flight resume/reconciliation. Saving execution output is not a
business Effect; no Effect is created.

The existing Slice 1 helper accepts a runtime class/verifier factory solely to
reuse its trusted authorization, Policy/Approval, exact launch configuration,
Workspace and Capsule checks. Defaults preserve Slice 1 behavior. For this
durable verifier, its old results Map is never populated or consumed.

## Artifact representation and resolver

Each provider result filename is `<RuntimeRef.externalId>.json` (UUID).
The finite JSON envelope is:

```text
schema: "g8-local-result-v1"
content:
  runtimeRef (full identity/metadata)
  runId / attemptId
  capsuleId / payloadHash / processFingerprint
  outcome / exitCode / signal
  stdout / stderr / error / completedAt
revision
```

Sorted-key deterministic UTF-8 JSON uses the existing finite-JSON encoder.
`revision = SHA-256(canonical content bytes)`.
`artifactHash = SHA-256(canonical complete envelope bytes)`.
`resultRef = file:///absolute/provider/<externalId>.json#sha256=<artifactHash>`.
Both hashes cover actual content; the URI is not itself proof. The wrapper's
revision must equal recomputed content revision and Evidence.revision.

Create uses `wx`; an exact repeated collection may reuse identical bytes.
Different content for the same identity conflicts and cannot overwrite the
winner. This is immutable create/replay behavior, not mid-write/power-loss
atomicity. Missing/partial/corrupt artifacts fail closed.

`resolveRuntimeResult` is read-only and limited to the configured test provider.
It requires the exact canonical file URL for the expected RuntimeRef UUID plus
SHA-256 pin, rejecting foreign scheme/root, traversal, alternate identity and
missing pin. Root and target must resolve to regular nonsymlink provider paths.
It checks actual byte hash, canonical encoding, exact envelope/content schema,
typed output fields, full RuntimeRef, Run/Attempt/Capsule/launch fingerprint
lineage and revision. It is not a general adversarial filesystem/security model
or global resolver service.

## Live and restart verification

The live inspection is the real Slice 1-style read-only Node program: it reads
Blueprint/package metadata and emits actual cwd, hashes, marker and ok flag.
Policy/Approval, Command binding, Capsule receipt and launch guards are reused.

The new verifier always resolves Evidence.contentRef from disk, even on the
live path. It checks exit/outcome/stderr, inspection output and contract hashes,
current Workspace revision, Run/Attempt/contract/Capsule ownership and Adapter
receipt binding. It has no result/Runtime memory shortcut. Runtime cannot create
Verification or accepted state; verifier only returns a Verification record.
The existing Controller records the verdict and applies Acceptance.

### Process A: lawful checkpoint

Real execution completes and the provider writes a durable result. Controller
persists RuntimeRef, Attempt.resultRef, Run/Attempt and candidate Evidence.
All five substantive content checks pass, but an explicit deterministic review
policy returns INCONCLUSIVE with diagnostic reason
`requires independent durable-result reproof`. It does not falsify output facts.
Existing Controller behavior places the Task in NEEDS_REVIEW; Evidence is
CANDIDATE and no final Acceptance occurs. Process A closes SQLite and exits.

### Process B: fresh reproof

A separate Node process opens SQLite, constructs a fresh runtime with an empty
executions Map and a disk-only verifier. There is no results Map; Runtime start
is guarded against accidental invocation. `reconcileTask` uses the existing
NEEDS_REVIEW recorded-Evidence path, rereads the exact provider artifact, checks
hashes/lineage/output and returns PASS. Only then the Controller accepts Task.

Assertions prove B startCalls=0, runtimeMapSize=0, one Run/Attempt/Evidence,
same EvidenceId/contentRef, preserved history, INCONCLUSIVE→PASS Verification
records, file bytes/hash/mtime unchanged and ACCEPTED surviving another reopen.
Terminal repeat reconcile is NOOP and adds no events. Nonterminal FAIL reproof
appends normal Verification records and never reexecutes or creates new lineage.

An actual targeted Windows restart trace used:

- Runtime externalId: `a52498e6-ba98-4f84-8a77-4c880e0aab79`;
- resultRef: `file:///C:/Users/ADMIN/AppData/Local/Temp/g8-durable-provider-MFX4G9/a52498e6-ba98-4f84-8a77-4c880e0aab79.json#sha256=fe7b56c91c689f5504f51833e7c2febc267dee6af179f593fe53b197a652d2b9`;
- artifactHash: `fe7b56c91c689f5504f51833e7c2febc267dee6af179f593fe53b197a652d2b9`;
- result revision: `f0458ecce9752722c64e61f7af3aac9d6b8f1ad02d483262a8e342e7418f6720`;
- Capsule input hash: `928a99c3502930610db339056e0bb055ac5e62de4db73b0b2217770aff25d1e8`;
- A state NEEDS_REVIEW, B state ACCEPTED. The fixture subsequently removed
  this temporary artifact; these are observed historical values, not retained
  artifacts or stable cross-run IDs.

## Negative proof and cleanup

MemoryStore and SQLite tests cover missing file, corrupt bytes, wrong RuntimeRef,
RunId, AttemptId, resultRef, Evidence revision and unsupported content schema.
Lineage corruption cases recompute valid artifact hash/revision and deliberately
inject the new pins into raw control records, proving valid hashes alone do not
launder wrong identity/schema. Every reproof yields FAIL/NEEDS_REVIEW, no new
Runtime/Run/Attempt/Evidence and no file repair. Hash mismatch remains distinct
from identity mismatch. Resolver tests reject foreign scheme/root/traversal/pins.

Additional real Process A→B cases delete or corrupt the artifact after A exits:
B returns FAIL and remains NEEDS_REVIEW, with zero execution and no accepted
Task. Failed Runtime exit 7 archives FAILED output but creates no candidate
Evidence or Verification and cannot accept Task. Immutable create conflict and
exact collection replay leave bytes/mtime unchanged.

Test runtime child has a 5-second SIGKILL deadline, a 7-second close deadline
and explicit close-uncertainty failure. Restart helper has a 30-second process
deadline/SIGKILL timeout policy and no barrier; normal A returns only after its
runtime child closes. All DB handles close before temporary directory cleanup.
These bounds do not claim general process-tree supervision or an OS sandbox.

## Verification and remaining G8 scope

- New Slice 3 suite: **27/27**, zero failures/skips on Node 22.
- Affected suite (Slices 1–3, runtime adapter, Controller/reverification,
  persistence, Capsule, SQLite stability): **247/247**, zero failures/skips.
- Full Node 22.23.3: **772 passed / 0 failed / 0 skipped**.
- Full Node 20.20.2: **462 passed / 0 failed / 310 expected SQLite capability skips**.
- Code/test HEAD remote CI: [36853031577](https://github.com/zekepeng-a/multi-agent/actions/runs/36853031577),
  **success**. Node 22 job 110338922124: SQLite capability check success,
  **772 passed / 0 failed / 0 skipped**. Node 20 job 110338922447:
  **462 passed / 0 failed / 310 expected SQLite capability skips**.
  The subsequent Evidence-only HEAD's CI is separately observed and reported;
  this code/test run is not used to assume its outcome.

New bounded evidence covers completed Runtime output durability/readability,
real Verification from references, continued Task Acceptance from recorded
Evidence, and real Controller/process restart at that completed-result checkpoint.
Existing authorization/Capsule and Effect proofs remain separate and intact.

Not proven: arbitrary in-flight Runtime recovery, LocalProcess resume or LOST
reconciliation, whole Project recovery, power-loss durability, universal durable
results across all adapters, DSH live host/substitution, write Workspace or a
general Artifact service. No new A/C/D/E issue was found; this is B integration
proof under existing accepted boundaries. Independent review remains required.
Further bounded dogfood should target a remaining demonstrated gap such as
adapter substitution or in-flight recovery; it requires separate authorization
and boundary audit, and is not started here.


## Independent review closure — recorded 2026-10-01

**Current reviewed status: PASS. Independent review outcome: PASS.** Provider-owned completed result durability, live disk resolver, lawful Process A/B restart reproof without old runtime memory and corruption/lineage fail-closed behavior accepted. No universal Artifact Store or in-flight recovery; no new C/D/E.

Human authorized this governance review-record convergence at baseline `7dad1894f802bdd6076a9320731c918a7a765e0a`. Original submission status, historical wording, test counts and failure/repair evidence above are retained. This section supplies current disposition. G8 is FINAL CONVERGENCE REVIEW READY, not COMPLETE; final exit review and separate governance completion remain necessary.
