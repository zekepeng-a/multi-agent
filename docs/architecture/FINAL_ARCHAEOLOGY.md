# Project Control OS — Final Control Archaeology

> Status: RESEARCH CONCLUSION / NOT YET IMPLEMENTATION AUTHORITY
>
> This document closes the three targeted archaeology questions:
> 1. Acceptance Gate Semantics
> 2. Revision / Version Lineage
> 3. Human Approval Boundary
>
> It records source-derived findings and the resulting architecture invariants.
> It does not choose a physical persistence technology.

---

## 1. Acceptance Gate Semantics

### 1.1 Acceptance is a relation, not a boolean

Source: `0xenzyme/agent-harness`
- `README.md`
- `docs/project-contract.md`
- `harness/specs/2026-09-01-run-checkpoint-and-recovery-protocol.md`

Observed:
- Task/Goal is the accepted-state authority.
- Run retains execution evidence/status and does not independently complete Task/Goal.
- Worker output remains candidate evidence until the accepted-state owner validates it.
- Completion requires accepted scope, fresh verification, required durable gates, and synchronized authoritative state.
- Checkpoint completion is explicitly not Goal completion.
- Contract drift makes the old Run `replan-required`; it cannot silently continue under a new contract.

Source: `SUNRNEHUI/agent-harness`
- `README.md`

Observed:
- A manager defines outcome, constraints, approval boundaries, observable `done_when`, and evidence/pass rules before execution.
- Worker self-report and harness scores are not completion evidence.
- Manager re-runs or inspects critical checks.
- Accepted closure requires evidence and no unresolved blocker or pending verification.

Source: `lordaeternus/agent-execution-harness`
- README / evidence-policy surface

Observed:
- Evidence is explicit and typed.
- Required evidence is derived from task surface and acceptance criteria.
- Missing required proof produces a non-complete state (`partial_validated`) rather than completion.
- Final claims are derived from verified claims.

Source: `BrianNguyen29/x-harness`
- `docs/ADMISSION_POLICY.md`

Observed:
- Admission is fail-closed.
- Success requires mapped criteria, evidence floor, no unresolved blocker, fresh-ground condition, verifier invocation, and read-only verification.
- Deep work additionally requires declared evidence scope, untested regions, risks, execution controls, rollback policy, verification artifacts, and read/write sets.
- A missing required approval blocks deep admission.

### 1.2 Acceptance therefore has five identities

The sources support separating:

1. **Acceptance subject** — the Task/Goal/Delivery outcome being judged.
2. **Acceptance contract** — the exact scope and `done_when` / criteria in force.
3. **Evidence set** — observations/checks that claim to prove the criteria.
4. **Verification** — the evaluation procedure/result applied to that evidence.
5. **Acceptance decision** — the authoritative transition recorded by the accepted-state owner.

A `verified=true` flag is insufficient because it does not identify what was verified, against which contract, over which scope, or whether the evidence is still current.

### 1.3 New invariant

**I-27 Acceptance is contract-bound and evidence-bound.**

A Task/Goal may enter ACCEPTED only when:
- the accepted contract revision is identified;
- required evidence exists;
- evidence covers the declared scope;
- verification was performed by the authorized acceptance path;
- evidence is fresh/valid for that contract;
- no blocking/reconciliation condition remains;
- the acceptance decision is recorded by the accepted-state owner.

---

## 2. Revision / Version Lineage

### 2.1 Revision is an identity boundary, not only a counter

Source: `0xenzyme/agent-harness`
- checkpoint protocol

Observed:
- Checkpoint has its own monotonic revision.
- Mutations require `expectedRevision`.
- Manifest binds the Run to its immutable contract.
- Checkpoint revision represents current control state.
- Contract drift cannot rebind the old manifest.
- The old Run becomes `replan-required`, then can become `superseded` only after a verified replacement Run exists.
- Historical evidence remains; it is not overwritten.

Source: `tt-a1i/archify`
- Architecture Delta / PR Proof implementation and changelog

Observed:
- Authored entities use stable IDs.
- Repository identity and full revision identity are checked before evidence can become revision-pinned.
- Input SHA-256 and semantic SHA-256 are tracked separately.
- Repository mismatch fails closed.
- Failed delivery preserves the previous verified artifact.
- Stale/superseded candidates do not silently replace the last verified artifact.

Source: `earthwalker17/agent-os`
- execution/recovery surfaces

Observed:
- Recovery creates child Run lineage (`recovery_of`) rather than overwriting the original Run.
- Patch workspaces carry manifest/audit artifacts.
- Detailed evidence remains separate from the compact run record.

Source: `ByteYellow/AgentProvenance`
- core model / evidence manifest / provenance graph

Observed:
- Evidence is content-addressed and hash-verified.
- Evidence graph preserves causal lineage.
- Evidence manifests provide run-level hash-indexed references.
- Cross-producer ordering is only guaranteed within a producer sequence; the system does not fabricate a total order where none exists.

### 2.2 New invariant

**I-28 Acceptance/evidence lineage must bind to a concrete revision identity.**

For any evidence that can influence acceptance, the system must be able to answer:

- Which subject/Task/Goal?
- Which acceptance-contract revision?
- Which artifact/source revision?
- Which Run/Attempt produced or observed it?
- Which verification produced the verdict?
- When was it observed?
- What superseded or invalidated it?

### 2.3 Consequences

- A new Task contract revision does not automatically reuse old acceptance evidence.
- A new source/artifact revision does not automatically reuse old verification.
- Re-execution creates new Run/Attempt/evidence lineage; it does not rewrite the old execution history.
- `superseded`, `stale`, and `invalidated` are distinct from `failed`.
- Revision numbers provide optimistic-concurrency protection; hashes/content identities provide artifact/source identity. They solve different problems.
- The architecture must not require a single global version number or global total event order.

---

## 3. Human Approval Boundary

### 3.1 Approval is a durable control fact

Source: `Cloudflare Agents`
- `agents/design/think-durable-submissions.md`
- `agents/design/rfc-think-actions.md`
- `agents/docs/think/actions.md`

Observed:
- Durable submissions are accepted before execution and use idempotency keys.
- Human approval can park a long-running action in durable storage.
- Approval/rejection can occur without a live client connection.
- Approval resolution is idempotent: concurrent approval/rejection attempts do not both win.
- Approval descriptors carry stable identity, action, input, permissions, risk, and kind.
- Authorization is evaluated at the defined execution/approval boundary; the approval record is not itself an instruction to mutate arbitrary state.
- Pending approval is a first-class durable state, not a hung request.

Source: `0xenzyme/agent-harness`
- README / project contract / controller communication

Observed:
- Human retains product judgment, authorization, and true pause conditions.
- High-risk actions, unclear direction, credentials, paid APIs, production access, destructive actions, and external side effects can require a human gate.
- The accepted-state owner remains responsible for final project acceptance.
- Worker/executor output remains candidate evidence.

Source: `BrianNguyen29/x-harness`
- `docs/ADMISSION_POLICY.md`

Observed:
- Human approval is an explicit admission requirement for deep/high-stakes work.
- Missing approval is a rejection condition, not merely a warning.

### 3.2 New invariant

**I-29 Approval does not equal Acceptance.**

Human approval can authorize an action to proceed, but it does not prove that the resulting Task/Goal outcome satisfies its acceptance contract.

Therefore:

`Human Approval -> permission to perform`

does not imply:

`Task Accepted -> proof that the outcome is correct`

The two decisions must remain separately represented.

### 3.3 New invariant

**I-30 Approval is scoped, attributable, and revocable/terminal according to its domain.**

An approval record must identify at least:
- approver / authority identity;
- action or effect being approved;
- target/scope;
- relevant contract or request identity;
- risk/permission context;
- decision (approve/reject);
- time;
- expiration or terminal semantics where applicable.

A UI click is only a request to record such a decision. The UI must not directly mutate authoritative Project State.

### 3.4 New invariant

**I-31 Human authority is strongest at direction and authorization boundaries, not at evidence fabrication.**

Humans may:
- set/change product direction;
- accept or reject an intended high-risk action;
- resolve an explicitly human-owned ambiguity;
- override within a declared policy boundary.

Humans do not turn missing evidence into evidence merely by approving an outcome.

---

## 4. Combined conclusion

The three passes reveal three distinct control facts:

`Acceptance = "does this outcome satisfy this contract?"`

`Revision = "which exact version/lineage does this evidence belong to?"`

`Approval = "is this actor authorized to allow this action?"`

They must not collapse into one state flag.

### Final control chain

`Human Intent`
-> `Acceptance Contract`
-> `Authorized Command`
-> `Run / Attempt`
-> `Artifact / Effect`
-> `Evidence`
-> `Verification`
-> `Acceptance Decision`
-> `Project State`

Parallel safety chain:

`Approval / Policy`
-> `Authorization to Execute`

Uncertainty chain:

`Unknown External Effect`
-> `Reconciliation Required`
-> `Fresh Authoritative Observation`
-> `New Evidence`
-> `Decision`

### Final archaeology verdict

These three passes did reveal new invariants, but they did **not** reveal a new top-level architectural layer.

They refine the existing layers:

- PROJECT CONTROL gains contract-bound acceptance.
- CONTROL & RECOVERY gains revision lineage and human approval states.
- EXECUTION remains Run/Attempt/Runtime.
- REALITY remains Workspace/Git/Shell/Browser/Build/Deploy.
- EVIDENCE & HISTORY gains explicit provenance/lineage binding.

The research boundary has now been reached.

No further broad framework archaeology is justified unless implementation exposes a concrete unresolved boundary.

---

## 5. What is now frozen vs still open

### Freeze now

- I-01 through I-26 from the canonical architecture.
- I-27 Acceptance is contract-bound and evidence-bound.
- I-28 Evidence/acceptance lineage binds to concrete revision identity.
- I-29 Approval does not equal Acceptance.
- I-30 Approval is scoped and attributable.
- I-31 Human approval cannot manufacture missing evidence.
- Semantic authority remains separate from physical persistence.
- Controller authority remains separate from orchestration mechanism.

### Still intentionally open

- SQLite vs PostgreSQL vs event sourcing vs hybrid.
- Exact event schema.
- Exact Effect Ledger schema.
- Exact Policy Engine implementation.
- Whether Controller/Reconciler is one module or several.
- Whether DSH Workflow/Team or another runtime is selected for each Run.
- Distributed locks / multi-writer persistence.
- Full external-effect authority ledger.
- UI design.

These are implementation/convergence questions, not reasons to continue broad archaeology.

---

## 6. Source boundary

This document is research synthesis, not proof that every referenced project is production-mature.

Source types used:
- implementation-backed repository code;
- explicit repository protocols/specifications;
- project documentation where implementation details were not exposed in the inspected source.

Where a source was explicitly marked draft/proposed, its claims are treated as design evidence rather than production capability.

