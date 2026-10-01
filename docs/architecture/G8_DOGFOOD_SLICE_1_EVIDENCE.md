# G8 bounded dogfood slice 1 — read-only repository inspection

**Status:** IMPLEMENTATION EVIDENCE — independent review pending; not G8 COMPLETE.
**Date:** 2026-10-01.
**Branch:** `project-control/controller-v0.1`.
**Authorized baseline:** `766801af0492d941de01ad334221b576de5f1cd3`.
**Code/test HEAD:** `326f8fbba1367390d4709137507f6319dcec65df`.
The subsequent Evidence commit changes only this document; its exact SHA and
remote CI run are supplied in the completion report/Git history, not invented
before the run exists. No governance status or accepted ADR is changed.

## Composition inventory and classification

Read Blueprint, canonical architecture (Command/Policy/Runtime/Workspace/Capsule
boundaries), current architecture, ROADMAP, ADR-0001/0003/0004/0005/0009 and
Persistence Boundary, then the concrete Controller/Store/adapter tests.

| Existing seam | Actual use in this slice |
|---|---|
| `Controller.createCommand` | Immutable Project-target action and parameters, real `control_command` collection; mutation replay id is separate. |
| `Controller.authorizeCommand` | Current StaticPolicyEngine evaluation, immutable PolicyDecision and existing Approval usability gate. |
| `Controller.reconcileTask` | Existing Run/Attempt creation, dispatch, real result collection, Evidence, Verification and Acceptance path. It does not universally enforce Command authorization. |
| `ContextCapsuleControl` | Existing generation, final byte budget, typed manifest, freshness, receipt, reservation and intent-bound replay. |
| `LocalProcessRuntimeAdapter` | Real Node OS process, cwd, stdout/stderr, exit code, output digest, RuntimeRef and Adapter-boundary receipt. |
| `WorkspaceManager` | Actual SHARED READ_ONLY root/revision, file reads and rejected write API. |
| Evidence/Verification/Acceptance | Existing Controller-generated candidate Evidence; injected verifier produces only Verification; Store owns acceptance. |
| Parent reconciliation | Existing child-side membership and contract-free Goal/Milestone/Project aggregation; no invented parent contract. |

The missing composition proof is addressed by **B — settled-boundary integration
glue**, exclusively in `tests/helpers/g8-dogfood-slice-1.mjs` and the integration
test. Production APIs, authority, Command lifecycle and schemas are unchanged.
No new canonical Task→Command relation, permission model, result persistence
authority or verifier authority is introduced. This is a bounded trusted
composition proof, not a universal execution-authorization API.

## Scenario, command and Workspace

Human intent: inspect this repository's Blueprint and package metadata without
writes. Create `g8-project → g8-milestone → g8-goal → g8-task`, pinned to Task
Acceptance `g8-contract@1`. Its required criterion records expected file hashes,
stdout marker, Workspace id/revision and the concrete process fingerprint.

Actual command is `process.execPath -e inspectionScript pass`. The committed
`inspectionScript` reads `PROJECT_BLUEPRINT.md` and `package.json`, hashes their
actual bytes, checks `Project Control OS` and package `type === module`, and
prints JSON with marker `G8_READ_ONLY_INSPECTION_V1`, cwd, hashes and `ok`.
It fails naturally for missing/invalid files; its explicit negative mode exits
7 after the same real reads. No FakeRuntime, FakeVerifier or FakeEffectDriver
participates. No shell command substitution, write, deployment or DSH is used.

The standalone local dogfood used the actual repository root. Its Workspace
digest before/after execution was equal. The integration suite uses a temporary
copy of **this repository's actual tracked files**, obtained from `git ls-files`,
not fabricated Blueprint/package fixtures. This prevents unrelated legacy tests'
ignored `.ai` writes from racing the all-file Workspace digest. The snapshot
diagnostic records source HEAD; its exact observed bytes are bound by Workspace
revision, not assumed from Git HEAD alone. All database/overlay fixtures are
outside the repository and cleaned up; no machine-specific path is committed.

`WorkspaceManager.createShared` binds same-project `g8-workspace`, READ_ONLY,
ACTIVE, no write scopes. Capsule includes Workspace/Reality pins and independently
timed observations. Launch config's cwd must equal this exact root. The fixed
process spec admits no caller-supplied env or substituted executable/arguments.
WorkspaceManager writes are rejected, and the normal slice configuration grants
no WRITE permission. **This is not an OS sandbox**: the Node process retains the
OS user's filesystem permissions. The proof concerns a trusted fixed read-only
action/configuration, not confinement of arbitrary hostile code. No cross-store/
filesystem atomic snapshot is claimed.

## Authorization → actual execution binding

`g8-command` requests Project-target `inspect.repository`, capability
`repository.read`, scope `task:g8-task`. Its immutable parameters include the
original Task record, contract pin, Workspace id/revision and exact process.
Project targeting is a genuine project-scoped inspection action, not relabeling
a Task revision or adding a Task→Command authority relationship. Project retains
its original revision during the existing Task-start bookkeeping.

Policy `g8-read-only-v1` requires Approval. `g8-approval` is a real attributed
PROJECT Approval for the same target/version/action/capability/scope/Command.
Consumption means the existing read-only usability proof, **not a new consumed
flag or terminal Approval state**. A pending authorization remains CREATED/WAIT.

The trusted helper gates before `reconcileTask`, then during Capsule policy and
integrity construction/revalidation, launch configuration and immediately before
the real adapter call. It re-reads the stored Command, current Project version,
Task/contract/action parameters, current Policy evaluation and usable Approval.
Only the exact existing READY→IN_PROGRESS Task bookkeeping is admitted (version
+1 and the actual new Run id); unrelated Task updates fail closed. Current policy
must still match the recorded authorization; no historical ALLOW token is used.

Capsule POLICY provenance stores Command id/version/parameters fingerprint.
REQUIRED POLICY_DECISION and APPROVAL sources preserve their real identities,
pins and authority. Receipt and Capsule bind the real Project/Task/Run/Attempt.
The observation wrapper around LocalProcess rejects a mismatched config before
calling the real adapter; it delegates execution/receipt/result to that adapter.
It manufactures neither result nor receipt. Direct callers of the general
Controller API are outside this helper's guarantee; no global retrofit is claimed.

## Real result, verifier and durable audit

The observation wrapper captures the real `collectResult()` result in a Map
keyed by `resultRef`. The existing Controller records durable Evidence metadata
with that contentRef, output revision, Run, Attempt and contract revision. The
verifier resolves those actual details synchronously during the Controller's
completion flow. There is no Artifact Store or changed persistence contract.

Verifier PASS requires all of:

- COMPLETED, exit 0 and empty stderr;
- JSON marker, repository checks, exact cwd and file hashes match the contract;
- output digest equals Evidence revision, recomputed over stdout/NUL/stderr/NUL/
  exit code; observed Workspace still matches its declared revision;
- Evidence/Task/contract and Attempt/RuntimeRef/Capsule lineage agree;
- RECEIVED Adapter observation binds the archived payload hash; launched process
  fingerprint agrees with the contract.

It creates only `createVerification(...)`; it never mutates Task or Project.
Controller/Store apply PASS via existing contract-bound acceptance. A zero-exit
marker mismatch yields FAIL and NEEDS_REVIEW; nonzero exit follows the existing
FAILED execution path and creates no completed candidate Evidence. Parent
propagation is explicitly reconciled only after Task ACCEPT. The parent records
in this slice are contract-free, so their existing aggregation rules apply.

The Evidence's optional `workspaceId/workspaceRevision` fields remain null on the
unchanged Controller path. Workspace linkage is proved through Evidence→Attempt
→Capsule plus the pinned Acceptance criterion, not a claim that those fields were
filled. SQLite reopen retains Evidence, Verification, Attempt/receipt, Capsule
hash and events. This is same-process durable metadata proof, not whole-chain
process restart or durable stdout/stderr content availability.

### Observed standalone real-root trace

At baseline plus the uncommitted slice test files, on 2026-10-01:

| Fact | Observed identity/value |
|---|---|
| Command / Policy / Approval | `g8-command` / `g8-policy-1` / `g8-approval` |
| Run / Attempt / Capsule | `g8-run-2` / `g8-attempt-3` / `g8-capsule-4` |
| Adapter RuntimeRef external id | `901edf23-0fa1-4e88-ad9d-bdff8bc3f93a` |
| Capsule hash | `394d981aa37e54ae4f6a19fa6ed538f19c95e7777c348c7964a26b013b35fac9` |
| Evidence / Verification | `g8-evidence-5` / `g8-verification-6`, PASS |
| Result ref | `process-output://901edf23-0fa1-4e88-ad9d-bdff8bc3f93a` |
| Output revision | `0f4fdbb5246c24ae8b9a421217b7098cdf993e2fe10342ae2dcf995b0cf203b8` |
| Workspace revision | `sha256:616fbcb05893a8d978b63d176621b0f7c1e5eac2aee00754c136cd6b1892bd88` |
| Result | ACCEPT; all five verifier checks true; Workspace digest unchanged |

This historical invocation used MemoryStore; durable backend proof is the SQLite
integration path. It is not a reusable permission or a claim that the same digest
remains current after adding this document. Each suite run emits its own full
identity/hash/event diagnostic; positive test trace includes `evt-12`
command.authorized → `evt-18` capsule.prepared → `evt-20` delivery-observed →
`evt-24` evidence.recorded → `evt-25` verification.recorded → `evt-26` task.accepted
→ `evt-27/28/29` Goal/Milestone/Project terminal events (the WAIT policy evaluation
accounts for the different numbering from the standalone invocation).

## Required proof / test map

Test: `tests/integration/g8-dogfood-slice-1.test.mjs`, each case on MemoryStore
and SQLite (14 cases per backend, **28 total**).

| Requested proof | Concrete test / observed boundary |
|---|---|
| 1–5 hierarchy, Task contract, Command, Policy, Approval | Positive `Policy/Approval gate, actual input/result, Acceptance, hierarchy and replay`: real records and require-approval WAIT→approved authorization. |
| 6–7 unauthorized no start, authorized actual execution | Positive WAIT rejects helper invocation with 0 calls/0 Runs; approved path starts exactly one real process. |
| 8–11 Capsule/LocalProcess/Workspace/real result | Positive verifies exact input hash/receipt/cwd; actual process output captured, READ_ONLY manager write rejected. |
| 12–14 Evidence, meaningful verdict, PASS-only acceptance | Positive pins Run/Attempt/contract; `real nonzero process cannot be accepted`; `zero exit with a contract mismatch produces real verifier FAIL`. |
| 15 hierarchy propagation | Positive proves Task ACCEPTED → Goal ACCEPTED → Milestone/Project COMPLETED through existing reconciliation. |
| 16 containment remains protected | `cross-project containment remains rejected by Store before Capsule` uses its own valid Task contract, so ownership is the rejection cause. |
| 17 auditable same-invocation history | Positive links archived policy provenance, receipt RuntimeRef/hash, Evidence and Verification; asserts events, prints ids/hashes; SQLite reopen checks exact historical records/events. |
| 18 failure never accepts | Negative real exit 7 and real zero-exit contract FAIL preserve nonaccepted Task/active Project. |

Additional negatives: wrong project/target (raw fault injection of corrupted
Command), wrong selected Command, stale Project authorization, changed Task
objective, revoked Approval, Workspace root mismatch, required Goal drift after
Capsule generation, Approval revoked after generation, and launch cwd substitution.
All prevent real process start. Capsule dispatch replay uses its exact original
mutation id and intent and creates no second call/event. Repeated helper invocation
also never restarts terminal, failed or uncertain execution; recovery is not added.

## Validation and remaining proof

- Targeted Command/Policy/Controller/parent and Project Acceptance/hierarchy/
  Workspace/Capsule plus dogfood: **256 pass / 0 fail / 0 skip**.
- Full local Node 22: **708 pass / 0 fail / 0 skip** on earlier default-concurrency
  runs, and **708/0/0** on the final `--test-concurrency=1` run (80.9 seconds).
- Full local Node 20: **438 pass / 0 fail / 270 expected SQLite capability skips**.
- Remote final-HEAD CI must be observed before the completion report claims success.
  The test's diagnostics are also present in remote job logs.
- An initial simultaneous local Node 22/20 run hit an old legacy shared `.ai`
  evaluation-file rename EPERM in Node 20. Sequential rerun passed; this was not
  silently counted as success. The initial positive verifier test also failed
  because the new helper read receipt at the wrong level; it was corrected to
  the existing delivery observation, with no production change.
- A later local full-run attempt exposed an existing-path **A-class proof
  stability issue**: the Capsule competition fixture's writer failed during
  `SqliteStore` initialization at `PRAGMA journal_mode = WAL` with `database is
  locked` (errcode 261); an unhandled rejection left its sibling waiting on the
  unopened barrier. The exact test tree was terminated, and its failed log was
  retained outside the repository. Neither `sqlite-store.mjs` nor the race
  test/helper differs from baseline. This is not proof of payload overwrite or
  a new authority design gap. It remains unfixed/outside this bounded slice;
  independent review should assess the existing harness/startup contention.
  A subsequent `--test-concurrency=1` full suite retains the independent writers
  inside the competition tests; it does not disable those tests. It passed
  708/708; the default-concurrency remote CI result is reported separately.

New evidence covers a bounded read-only authorization/execution binding, real
LocalProcess + Workspace + Capsule, result-to-Evidence/meaningful Verification/
Acceptance, hierarchy propagation and linked durable history. Production code
and accepted architecture are unchanged. No new C/D/E was discovered; the
slice-specific missing integration proof is B. The existing-path A proof
stability issue above is disclosed, not fixed or declared closed. READ_ONLY is
not OS confinement.

Still **unproved by this slice**: real Effect driver/reconciliation, whole-chain
process restart, durable result content across Controller restart, DSH live host,
LocalProcess↔DSH semantic substitution and write integration. Runtime execution
was not relabeled Effect; the positive test asserts there are no Effect records.
Adapter receipt proves input-boundary reception only. G8 is not COMPLETE, and
Roadmap/Observability/leases remain deferred/not currently required.

Suggested next separately authorized slice: a concrete real Effect action with
existing dispatch/reconciliation and uncertainty proof, chosen from the actual
remaining gap; do not automatically run it or bundle restart/DSH/write features.
