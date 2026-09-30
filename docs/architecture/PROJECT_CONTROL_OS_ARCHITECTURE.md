# Project Control OS — Canonical Architecture

**Version:** v0.2  
**Status:** DESIGN / architecture source of truth  
**Rule:** this document is the canonical architectural memory. Chat is for discussion; this file is for durable decisions.

---

## 0. Architectural Discipline

### Source-of-truth rule

The Project Control OS architecture must not depend on chat-history recall.

For every future architectural change:

1. Read the relevant current sections of this document.
2. Reuse existing concepts before introducing new ones.
3. Distinguish **CONFIRMED**, **PROPOSED**, **REFERENCE**, and **OPEN QUESTION**.
4. Change only the relevant sections.
5. Record material architectural decisions.
6. Never silently reinterpret a confirmed concept.

### Current design status

This is a design specification, not a production-proven system.

The architecture must be validated against real implementations and small executable prototypes before being called stable.

---

# 1. Purpose

Project Control OS is a **thin project-control layer above agent runtimes**.

It maintains:

- durable project state
- goals and tasks
- acceptance authority
- execution records
- workspaces
- evidence
- verification
- decisions
- project memory
- policy
- commands
- events
- external-effect reconciliation
- recovery

It is **not another multi-agent runtime**.

DSH, Claude Code, Codex, OpenCode, Workflow, and Agent Team are execution substrates that can be adapted behind a runtime boundary.

The core architectural question is therefore not:

> How do we make more agents cooperate?

It is:

> How do we keep project intent, execution, reality, evidence, and accepted state consistent while allowing different agents/runtimes to execute work?

---

# 2. Core Mental Model

## 2.1 Project execution loop

```text
Human Goal
  ↓
Goal
  ↓
Task
  ↓
Acceptance Contract
  ↓
Run
  ↓
Attempt
  ↓
Runtime / Agent
  ↓
Workspace / Reality
  ↓
Evidence
  ↓
Verification
  ↓
Acceptance
  ↓
Project State
  ↓
Decision / Memory
  ↓
Next Goal
```

## 2.2 Control/reconciliation loop

```text
Desired State
      +
Current State
      +
Evidence
      ↓
Reconcile
      ↓
Command
      ↓
Runtime
      ↓
Domain Event
      ↓
State Projection
      ↓
Observe Again
```

## 2.3 Fundamental boundary

```text
Model       = reasoning capability
Agent       = execution capability
Workflow    = known/deterministic process
Team        = role-based collaboration
Run         = one controlled execution
Task        = unit of project work
Evidence    = proof
Verification= evaluation of proof
Acceptance  = project completion decision
Project OS  = authority/state/control
Human       = final intent/high-risk authority
```

---

# 3. Five-Layer Architecture

## L1 — Project Control

Owns:

- Project
- Roadmap
- Milestone
- Goal
- Task
- Acceptance Contract
- Decision
- Memory
- Context Capsule

Question answered:

> What are we trying to achieve, and what is currently accepted?

## L2 — Control & Recovery

Owns:

- Controllers
- Reconciliation
- Recovery
- Policy
- Commands
- ownership/leases/fencing where necessary

Question answered:

> Given desired state and observed state, what controlled action should happen next?

## L3 — Execution

Owns:

- Run
- Attempt
- Runtime Adapter
- Agent
- Workflow
- Team

Question answered:

> How is the requested work executed?

## L4 — Reality

Includes:

- Workspace
- Git
- Files
- Shell
- Browser
- Build
- Test
- Deployment
- External systems

Question answered:

> What actually happened in the real environment?

## L5 — Evidence & History

Owns:

- Evidence
- Verification
- Domain Event
- Effect
- external Receipt
- Audit
- Artifact references

Question answered:

> What proves what happened, and what historical facts must remain durable?

### Cross-cutting

- Identity
- Context
- Memory
- Observability
- Durability
- Versioning
- Correlation

---

# 4. Identity Model

Identity domains must not be collapsed into one generic ID.

## Project-control identity

```text
ProjectId
RoadmapId
MilestoneId
GoalId
TaskId
AcceptanceId
DecisionId
MemoryId
```

## Execution identity

```text
RunId
AttemptId
WorkspaceId
EffectId
CommandId
```

## Evidence identity

```text
EvidenceId
VerificationId
```

## Runtime identity

```text
AgentId
RuntimeId
SessionId
WorkflowId
TeamId
```

## Observability identity

```text
EventId
TraceId
SpanId
CorrelationId
CausationId
```

A TaskId is not a RunId. A RunId is not a SessionId. A SessionId is not an AgentId.

---

# 5. Canonical Domain Objects

## 5.1 Project

Purpose: project boundary and lifecycle root.

Core fields:

```yaml
id: ProjectId
version: integer
name: string
description: string
status: ACTIVE | PAUSED | COMPLETED | ARCHIVED
current_revision: string?
created_at: timestamp
updated_at: timestamp
metadata: object
```

Authority:

- Human creates and directs.
- Control Plane maintains authoritative state.
- Agent cannot directly mutate Project State.

---

## 5.2 Roadmap

Purpose: longer-term direction.

```yaml
id: RoadmapId
project_id: ProjectId
version: integer
name: string
description: string
status: DRAFT | ACTIVE | COMPLETED | ARCHIVED
created_at: timestamp
updated_at: timestamp
```

Roadmap is direction, not execution.

---

## 5.3 Milestone

Purpose: bounded stage inside a Roadmap.

```yaml
id: MilestoneId
roadmap_id: RoadmapId
project_id: ProjectId
version: integer
name: string
description: string
status: DRAFT | READY | IN_PROGRESS | COMPLETED | BLOCKED | CANCELLED
goal_ids: GoalId[]
acceptance_id: AcceptanceId?
acceptance_version: integer?
created_at: timestamp
updated_at: timestamp
```

A Milestone that declares an `acceptance_id` also pins `acceptance_version`: the
pair names one concrete contract revision, exactly as it does for a Task. See
*Parent acceptance* under Goal (5.4).

In v0.1 the milestone also states its `project_id` explicitly. Roadmap has no
lifecycle yet, so the project a milestone belongs to is a fact recorded on the
milestone itself rather than derived through a roadmap — the same
child-side-link rule every other relationship follows.

---

## 5.4 Goal

Purpose: meaningful project outcome.

A Goal describes an outcome, not an implementation step.

```yaml
id: GoalId
milestone_id: MilestoneId?
project_id: ProjectId
version: integer
title: string
description: string
status: DRAFT | READY | IN_PROGRESS | BLOCKED | ACCEPTED | REJECTED | CANCELLED
task_ids: TaskId[]
acceptance_id: AcceptanceId?
acceptance_version: integer?
created_at: timestamp
updated_at: timestamp
```

### Parent acceptance (v0.1)

A Goal and a Milestone may carry their own Acceptance Contract. When one does, the
parent may **not** be accepted by aggregation:

```text
Task acceptance  →  the children are ACCEPTED  →  parent acceptance
                                                (its own contract, not the sum)
```

Child completion is the **input** to the parent's acceptance, never the decision.
Without a contract, "every child is accepted" is a derived summary and the
Controller may write it directly. With a contract, the same observation is only a
claim to be verified, and the flow is the task flow one level up:

```text
pinned contract revision → Aggregate Evidence → Verification → Acceptance
```

Consequences recorded for v0.1:

- The pin is a fact about **that** parent: `acceptance_id` names a contract, the
  `(acceptance_id, acceptance_version)` pair names one revision of it, and the
  revision must target that record's own type and id. A Goal pinning a Milestone
  contract, or another Goal's contract, is refused at seed and at update.
- Both halves of the pin are required. A bare `acceptance_id` is not a revision,
  and a bare `acceptance_version` names nothing.
- `PROJECT` is a declared target type with **no v0.1 acceptance flow**: Project
  status is still only ever completed by observing completed milestones.
- A parent in a terminal state, or in `BLOCKED`, is never accepted by contract —
  the same source-state whitelist rule as a Task (`READY`, `IN_PROGRESS`).
- The acceptance write moves the parent's status and the contract's decision in
  one transaction, recording the lifecycle event for the status reached
  (`goal.accepted`, `milestone.completed`).

---

## 5.5 Task

Purpose: core actionable unit of project work.

```yaml
id: TaskId
project_id: ProjectId
goal_id: GoalId
version: integer
title: string
description: string
status:
  - DRAFT
  - READY
  - IN_PROGRESS
  - BLOCKED
  - NEEDS_REVIEW
  - ACCEPTED
  - REJECTED
  - CANCELLED
priority: LOW | NORMAL | HIGH | CRITICAL
dependencies: TaskId[]
acceptance_id: AcceptanceId
acceptance_version: integer
current_run_id: RunId?
latest_evidence_id: EvidenceId?
created_at: timestamp
updated_at: timestamp
```

A Task does not point at the Acceptance Contract's current head. It pins one
concrete contract revision:

```text
(AcceptanceId, AcceptanceVersion)
```

Changing contract content requires a new revision; an existing Task keeps the
revision it was created against and never drifts onto a newer one. See
*Acceptance relationship* below.

A Task can have many Runs:

```text
Task
 ├─ Run 1 → FAILED
 ├─ Run 2 → BLOCKED
 └─ Run 3 → COMPLETED
             ↓
         Verification
             ↓
          ACCEPTED
```

---

## 5.6 AcceptanceContract

Purpose: explicit, verifiable definition of completion.

```yaml
id: AcceptanceId
target_type: TASK | GOAL | MILESTONE | PROJECT
target_id: string
version: integer
criteria:
  - id: string
    description: string
    type: TEST | BUILD | BEHAVIOR | ARTIFACT | REVIEW | POLICY | MANUAL
    required: boolean
required_evidence: EvidenceId[]
status: PENDING | VERIFYING | PASSED | REJECTED | STALE | INVALIDATED
created_at: timestamp
updated_at: timestamp
```

An Acceptance Contract must be testable/verifiable.

Contract identity is the pair `(id, version)`. Contract **content** (`criteria`,
`required_evidence`, `target_id`, …) changes only by creating a new revision, and
one identity must never be reused for different content. `status` is the
acceptance **decision** state, not contract content: `PENDING → PASSED` is not a
contract revision change.

`target_type` makes a contract unambiguous about what it is about. A Task
contract is bound at creation; a Goal or Milestone contract is bound by the
parent's own pin, and the revision must target that record's type and id — so one
contract id can never be read as covering a task **and** a goal. In v0.1 only
`TASK`, `GOAL` and `MILESTONE` have an acceptance flow; `PROJECT` is defined but
not yet reachable.

A content fingerprint is stored beside every revision and re-checked on every
resolution, so a revision edited in place fails closed instead of being trusted.

---

## 5.7 Run

Purpose: one controlled execution process for a Task.

```yaml
id: RunId
project_id: ProjectId
task_id: TaskId
version: integer
status: CREATED | READY | RUNNING | COMPLETED | FAILED | BLOCKED | CANCELLED
execution_strategy: SINGLE_AGENT | WORKFLOW | TEAM | MANUAL
runtime_id: RuntimeId?
workflow_id: WorkflowId?
team_id: TeamId?
attempt_ids: AttemptId[]
workspace_id: WorkspaceId?
context_capsule_id: ContextCapsuleId?
result_ref: string?
started_at: timestamp?
completed_at: timestamp?
created_at: timestamp
```

Run is execution history, not project acceptance authority.

---

## 5.8 Attempt

Purpose: concrete worker execution inside a Run.

```yaml
id: AttemptId
run_id: RunId
attempt_number: integer
agent_id: AgentId
runtime_id: RuntimeId
session_id: SessionId?
status: CREATED | RUNNING | COMPLETED | FAILED | INTERRUPTED | LOST | CANCELLED
started_at: timestamp?
ended_at: timestamp?
error:
  code: string?
  message: string?
  category: string?
result_ref: string?
created_at: timestamp
```

A lost Attempt does not necessarily mean the Run is lost.

---

## 5.9 Workspace

Purpose: concrete reality in which execution operates.

```yaml
id: WorkspaceId
project_id: ProjectId
run_id: RunId
base_revision: string
current_revision: string?
path: string
isolation_mode: SHARED | WORKTREE | TEMPORARY | CONTAINER
write_scope:
  type: PROJECT | DIRECTORY | FILE_SET
  paths: string[]
status: CREATED | ACTIVE | DIRTY | CLEAN | MERGED | DISCARDED
created_at: timestamp
updated_at: timestamp
```

Parallel execution requires:

```text
isolated workspace
OR
provably non-overlapping write scopes
```

A simple `Promise.all()` is not a concurrency architecture.

---

## 5.10 Evidence

Purpose: durable proof of what happened.

```yaml
id: EvidenceId
project_id: ProjectId
source:
  run_id: RunId?
  attempt_id: AttemptId?
  agent_id: AgentId?
  workspace_id: WorkspaceId?
type:
  - TEST_RESULT
  - BUILD_RESULT
  - FILE
  - DIFF
  - GIT_COMMIT
  - SCREENSHOT
  - LOG
  - BROWSER_RESULT
  - DEPLOYMENT_RESULT
  - MANUAL_REVIEW
target:
  type: string
  id: string
acceptance_id: AcceptanceId
acceptance_version: integer
revision: string?
content_ref: string
sha256: string?
status: CANDIDATE | VERIFIED | ACCEPTED | STALE | SUPERSEDED
created_at: timestamp
```

Evidence that can influence acceptance identifies the acceptance contract
revision it is bound to. Evidence created for a different
`(acceptance_id, acceptance_version)` cannot support a PASS verification for
this Task.

### Aggregate Evidence

A Goal or a Milestone does not "run", so nothing external can produce evidence
about it. Its evidence is the Control Plane's **own observation** of the
authoritative child state, recorded in the same collection:

```text
Aggregate Evidence
  target_type / target_id   → the Goal or Milestone observed
  task_id / run_id / attempt_id = null
  acceptance_id + acceptance_version → the revision the target pins
  source_refs               → one ref per child: id, version, status, contract pin
  revision                  → sha256 of the canonical child snapshot
```

- Children are found through the **child's own parent link** (`Task.goalId`,
  `Goal.milestoneId`); the aggregate's cached `task_ids` / `goal_ids` are never
  consulted. A snapshot taken from a stale cache would be evidence about a list,
  not about the project.
- The **revision is the observation's identity**. The same child state always
  yields the same revision and therefore the same Evidence record: one
  observation, one record, no duplicate `evidence.recorded` on a repeated
  reconcile.
- When the child state moves, the new observation is a **new** record, and the
  record it replaces is marked `SUPERSEDED` — never deleted. Historical evidence
  stays readable, so a verification built on it can be seen to be stale.
- Observation fails closed: an aggregate with no children, or with even one child
  that has not reached its finished state, has no finished observation to record.
- Before a parent acceptance is written, the snapshot is re-derived from live
  records and must still match the evidence revision. **Current Reality outranks
  Historical Evidence**: a verification may be well-formed and still unable to
  accept, because the state it describes is gone.

Agent claim:

```text"done"
```

is not Evidence.

Example evidence:

```textcommand = npm test
exit_code = 0
revision = abc123
output_ref = artifact://...
```

---

## 5.11 Verification

Purpose: evaluate Evidence against Acceptance criteria.

```yaml
id: VerificationId
target_type: TASK | GOAL | MILESTONE
target_id: string
task_id: TaskId?
evidence_ids: EvidenceId[]
acceptance_id: AcceptanceId
acceptance_version: integer
verifier:
  type: AUTOMATED | AGENT | HUMAN
  agent_id: AgentId?
verdict: PASS | FAIL | INCONCLUSIVE
checks:
  - criterion_id: string
    verdict: PASS | FAIL | INCONCLUSIVE
    evidence_ids: EvidenceId[]
    details: string?
revision: string?
created_at: timestamp
```

Verification produces a verdict; it does not directly replace Project State.

A verification is about one target, and the target decides how it is proved:

- `TASK` verification: `task_id` is required, and the whole
  `Task ← Run ← Attempt ← Evidence` lineage is re-proved against the task the
  verification declares — and again against the task actually being accepted.
- `GOAL` / `MILESTONE` verification: no `task_id` at all. What replaces lineage is
  the snapshot identity: the evidence must belong to that target, must carry no
  Run or Attempt, must be of the revision the target pins, and must still
  describe the current child state.

`revision` must equal the revision of the evidence the verification reads, so a
verdict can never be attached to a different observation than the one it names.

---

## 5.12 Decision

Purpose: durable record of why a project direction or constraint was chosen.

```yaml
id: DecisionId
project_id: ProjectId
title: string
rationale: string
alternatives:
  - description: string
    rejected_reason: string?
decided_by:
  type: HUMAN | CONTROL_PLANE
  actor_id: string
status: ACTIVE | SUPERSEDED | REVOKED
source_refs:
  - type: string
    id: string
created_at: timestamp
```

---

## 5.13 Memory

Purpose: promoted project knowledge, not chat history.

Types:

```text
FACT
DECISION
CONSTRAINT
LESSON
```

Schema:

```yaml
id: MemoryId
project_id: ProjectId
type: FACT | DECISION | CONSTRAINT | LESSON
content: string
source_refs: object[]
confidence: VERIFIED | ACCEPTED | INFERRED
status: ACTIVE | STALE | SUPERSEDED
created_at: timestamp
updated_at: timestamp
```

Memory requires provenance.

---

## 5.14 ContextCapsule

Purpose: minimal task-relevant context supplied to a runtime.

```yaml
id: ContextCapsuleId
task_id: TaskId
task_ref: TaskId
acceptance_ref: AcceptanceId
project_state_ref: string
decision_ids: DecisionId[]
memory_ids: MemoryId[]
evidence_ids: EvidenceId[]
workspace_id: WorkspaceId
agent_id: AgentId
capabilities: string[]
policy_context_ref: string
generated_at: timestamp
expires_at: timestamp?
```

Do not inject the entire project history into every agent context.

---

## 5.15 Effect

Purpose: represent an external side effect and its reconciliation.

Examples:

- deploy
- create GitHub PR
- send message
- modify external database
- delete external resource
- external API mutation

```yaml
id: EffectId
project_id: ProjectId
run_id: RunId
requested_by: string
capability: string
action: string
destination: string
idempotency_key: string
status:
  - REQUESTED
  - AUTHORIZED
  - DISPATCHED
  - UNKNOWN
  - SUCCEEDED
  - FAILED
external_receipt:
  provider: string?
  receipt_id: string?
reconciliation:
  status: NOT_REQUIRED | REQUIRED | IN_PROGRESS | RESOLVED
created_at: timestamp
updated_at: timestamp
```

UNKNOWN is a first-class state.

---

## 5.16 Command

Purpose: one durable, concrete action requested by the Control Plane.

ADR-0001 freezes the boundary between **durable intent/authorization** and later
external execution. A Command is not the current replay-row mechanism and is not
an Effect.

Target schema:

```yaml
id: CommandId
version: integer
project_id: ProjectId?
target_type: PROJECT | MILESTONE | GOAL | TASK
target_id: string
target_version: integer
action: string
capability: string
scope: string
risk_level: LOW | MODERATE | HIGH | CRITICAL
requested_by: string
expected_version: integer?
parameters: object
idempotency_key: string
status:
  - CREATED
  - AUTHORIZED
  - REJECTED
  - DISPATCHED      # reserved until G3
  - EXECUTING       # reserved until G3
  - SUCCEEDED       # reserved until G3
  - FAILED          # reserved until G3
  - UNKNOWN         # reserved until G3
authorization:
  approval_id: ApprovalId?
  authorized_at: timestamp?
  rejected_at: timestamp?
  reason: string?
  approval_reason: string?
created_at: timestamp
updated_at: timestamp
```

### G2 supported lifecycle

G2 implements only the lifecycle whose semantics do not require an Effect ledger:

```text
CREATED
   ├──→ AUTHORIZED
   └──→ REJECTED
```

`DISPATCHED / EXECUTING / SUCCEEDED / FAILED / UNKNOWN` remain canonical future
states but are **reserved and non-writable during G2**. G3 owns their interaction
with Effect, runtime acknowledgement, external receipts, uncertainty and retry.

### Durable intent

The Command binds its target/action at creation. These facts do not change in place:

```text
target type/id/version
action
capability
scope
risk level
requested_by
expected_version
parameters
idempotency_key
```

The Control Plane reads `target_version` from current authoritative state when
creating the Command; a caller does not get to claim an arbitrary current version.

A materially different action is represented by a new Command.

### Authorization

Authorization operates on the stored Command, not on a new caller-presented copy
of its intent:

```text
Command(CREATED)
  ↓
read current target
  ↓
target_version + expected_version still current?
  ↓
Approval gate for stored target/action/capability/scope
  ↓
AUTHORIZED
```

A missing/pending permission returns WAIT and leaves the Command `CREATED`.
A definite fail-closed refusal may move the concrete Command to `REJECTED`
according to the implementation's explicit reason table.

`AUTHORIZED` means only:

> this exact stored Command passed the control gate against the authoritative
> state observed at authorization time.

It does **not** mean dispatch, runtime receipt, external effect, success, Evidence,
Verification, or Acceptance.

The authorization transition may therefore be recorded durably without claiming
Effect knowledge.

### Existing replay rows are not Commands

The current store-level replay registry:

```text
command_id → { operation, result_id }
```

is an idempotency mechanism for authoritative store mutations. It must not be
reinterpreted as the Command domain.

A durable Command uses a separate collection/storage shape.

`CommandId`, Command `idempotency_key`, and the existing store-mutation
`commandId` are separate identities with separate meanings.

### COMMAND-target Approval

Even after Command gains durable identity, G2 does not automatically enable
`ApprovalTargetType.COMMAND`.

Whether approval should target a Command or the underlying Project/Task action is
a later Policy/Approval-composition question. The current COMMAND-target Approval
boundary therefore remains fail closed in G2.

See `docs/architecture/decisions/ADR-0001-durable-command-boundary.md`.

---

## 5.17 DomainEvent

Purpose: immutable fact that something happened.

```yaml
id: EventId
event_type: string
aggregate:
  type: string
  id: string
  version: integer
correlation_id: CorrelationId
causation_id: CausationId?
actor:
  type: string
  id: string
payload: object
occurred_at: timestamp
schema_version: string
```

Events are history, not commands.

---

## 5.18 Policy

Purpose: runtime-enforced authorization.

Conceptual authorization tuple:

```text
Actor
+ Capability
+ Resource
+ Action
+ Context
```

Schema:

```yaml
id: PolicyId
actor:
  type: string
  id: string
capability: string
resource:
  type: string
  id: string
action: string
context:
  environment: string
  risk_level: string
  approval_state: string
decision: ALLOW | DENY | REQUIRE_APPROVAL
reason: string
created_at: timestamp
```

Policy is enforcement, not prompt text.

---

## 5.19 Approval

Purpose: a durable **permission** fact.

An Approval records that a named subject decided, within a stated scope, that one
specific action on one specific target version may proceed.

```yaml
id: ApprovalId
version: integer
request:
  target_type: PROJECT | MILESTONE | GOAL | TASK | COMMAND
  target_id: string
  target_version: integer?      # null for a COMMAND target
  action: string
  capability: string
  scope: string
  risk_level: LOW | MODERATE | HIGH | CRITICAL
requested_by: string
decision:
  status: PENDING | APPROVED | REJECTED | EXPIRED | REVOKED
  decided_by: string?
  decided_at: timestamp?
  reason: string?
revocation:                     # only ever set by a revocation
  revoked_by: string
  revoked_at: timestamp
  reason: string
command_id: string?             # the Command this permission is about
expires_at: timestamp?
created_at: timestamp
updated_at: timestamp
```

`capability` is part of the authorized action, not decoration: an approval for
`deploy.production` on `task-1` is not an approval to run `delete.production`
against it, even though the target, version, action name and scope are identical.
It is bound at request time like every other part of the request and is compared
exactly at authorization time (I-44).

`ApprovalTargetType.COMMAND` is **reserved but unsupported in v0.1**. Command is
not yet a durable control object, so an approval about one would be a control fact
claiming support for something the model does not have (I-45). Requesting, seeding
or consuming a COMMAND approval therefore fails closed with one explicit message.

### What an Approval is not

| Neighbour | The distinction |
|---|---|
| Evidence | Evidence is what happened; an Approval is what is permitted to happen |
| Verification | Verification judges evidence; an Approval is not a judgement about work |
| **Acceptance** | **Approval = permission fact · Acceptance = correctness/completion fact.** Neither implies the other: an approved deploy does not accept a Task, and an accepted Task produces no Approval |
| Policy | Policy decides whether approval is *required* (`ALLOW / DENY / REQUIRE_APPROVAL`); an Approval is the fact that satisfies `REQUIRE_APPROVAL` |
| Command | A Command is a requested action and its result; an Approval only lets one pass a control gate |
| Effect | Approving an effect is not performing it, and not knowing its outcome |

### Binding: what was approved

There is no shape of an Approval that means "the project is approved". Five
things are bound at request time and can never be edited afterwards:

```text
target     (target_type, target_id)  →  WHICH thing
version    (target_version)          →  WHICH state of it
action     (action)                  →  WHICH operation
capability (capability)              →  WHICH ability it exercises
scope      (scope)                   →  WHERE / HOW FAR
```

The target version is **read from the target**, not supplied by the requester: an
approval that merely claims to be about v3 while the target is already at v4 would
be a permission for a state that does not exist. `scope` and `capability` are
compared exactly in v0.1 — there is no wildcard, prefix, or hierarchy algebra, so
an approval for `production` is not an approval for `production-eu`, and an
approval to exercise `deploy.production` is not one to exercise
`delete.production`.

A `COMMAND` target is identified by its command id and has no version; the
approval binds that command and can be consumed by no other.

### Lifecycle

```text
PENDING ──► APPROVED ──► REVOKED
   │            │
   ├──► REJECTED│
   └──► EXPIRED ┘
```

- Every transition not drawn is refused: no re-decision (`APPROVED → APPROVED`),
  no resurrection (`REJECTED / EXPIRED / REVOKED → APPROVED`).
- A decision must be **attributable**: no named decider, no `APPROVED`.
- `REVOKED` means the permission no longer stands — not that the operation failed.
  It records who revoked it, when and why, and preserves the decision it
  superseded.
- `EXPIRED` is an observation about the clock, not a decision. Expiry is evaluated
  on every read; recording it durably (with an `approval.expired` event) is a
  separate explicit act. No scheduler exists anywhere in v0.1.
- Re-requesting is a NEW Approval, never an edit of the old one.

### Consumption

An Approval is consumed through one read-only proof
(`assertApprovalUsable`), which re-checks existence, effective status,
attributability, target type, target id, action, **capability**, scope, the bound
command, the deadline, and — the check that matters most — the target's **current**
version. A consumption must also SAY which capability it exercises: an unnamed
capability is not a wildcard, it is a request that cannot be authorized. Any
failure is a refusal with a machine-readable reason
(`MISSING`, `PENDING`, `REJECTED`, `REVOKED`, `EXPIRED`, `UNKNOWN`, `UNATTRIBUTED`,
`TARGET_TYPE_MISMATCH`, `TARGET_ID_MISMATCH`, `TARGET_MISSING`, `STALE`,
`ACTION_MISMATCH`, `CAPABILITY_MISMATCH`, `SCOPE_MISMATCH`, `COMMAND_MISMATCH`), so
a caller never has to parse a message to learn why. A status this version cannot
reason about is `UNKNOWN`, not "probably fine".

Consumption is deliberately **not recorded** in v0.1: there is no Effect ledger,
and a "used" flag would claim knowledge about the external world that this layer
does not have. Authorization is a decision, not a fact about what happened.

---

# 6. Authority Model

## Human — Intent Authority

Can:

- define project direction
- create/modify goals
- modify roadmap
- define constraints
- approve high-risk operations
- override project direction

## Control Plane — State Authority

Can:

- maintain authoritative Project/Goal/Task/Run/Acceptance state
- enforce legal transitions
- reconcile desired vs observed state
- dispatch commands

Agents cannot directly modify authoritative project state.

## Runtime / Agent — Execution Authority

Can:

- execute granted work
- choose implementation details
- use granted capabilities
- produce results
- produce evidence
- propose state changes

Cannot directly accept project work.

## Reviewer — Verification Authority

Can:

- inspect evidence
- run verification
- produce PASS / FAIL / INCONCLUSIVE

Does not directly own project state.

## Acceptance Controller — Acceptance Authority

Evaluates:

```textAcceptance Contract
+
Evidence
+
Verification
+
Revision
+
Policy
```

and causes the state transition through the Control Plane.

## Approver — Permission Authority

A human (or a named external authority) is the only subject that can grant,
refuse, or withdraw an Approval.

Can:

- approve or reject a named action on a named target state
- revoke a permission that still stands, with a reason
- see exactly what was asked (`target`, `version`, `action`, `scope`, `risk`)

Cannot:

- approve without being named — an unattributed `APPROVED` is refused
- approve an action, scope, or target version other than the one requested
- extend a grant to a newer version of the target
- make work correct: approving is not accepting, and not executing

The Control Plane records and enforces the decision, but it never manufactures
one: with no named approver there is no Approval, and the gate fails closed.

---

# 7. State Machines

## Task

```text
DRAFT
  ↓
READY
  ↓
IN_PROGRESS
  ├──→ BLOCKED
  │      ↓
  │   IN_PROGRESS
  │
  └──→ NEEDS_REVIEW
          ├──→ ACCEPTED
          └──→ REJECTED
```

CANCELLED is an explicit stop.

BLOCKED ≠ FAILED.

REJECTED means a result exists but acceptance failed.

## Run

```text
CREATED
  ↓
READY
  ↓
RUNNING
  ├──→ COMPLETED
  ├──→ FAILED
  ├──→ BLOCKED
  └──→ CANCELLED
```

## Evidence

```text
CANDIDATE
   ↓
VERIFIED
   ↓
ACCEPTED
```

It can later become:

```text
STALE
SUPERSEDED
```

Stale ≠ failed.

## Acceptance

```text
PENDING
  ↓
VERIFYING
  ↓
PASSED
  ↓
ACCEPTED
```

or:

```text
VERIFYING → REJECTED
```

Accepted results can later become STALE / INVALIDATED if their basis is no longer valid.

### Parent acceptance (Goal / Milestone)

```text
children finished
  ↓
Aggregate Evidence (snapshot revision = identity)
  ↓
Verification of that observation
  ↓
PASS → ACCEPTED (Goal) / COMPLETED (Milestone)
  └ not PASS → no transition; the parent stays open and the case is reported
```

The parent's decision and its contract revision move in one transaction. Without
a contract there is no acceptance decision at all: the parent's status is simply
synchronised from its children.

## Approval

```text
PENDING ──► APPROVED ──► REVOKED
   │            │
   │            └──► EXPIRED
   ├──► REJECTED
   └──► EXPIRED
```

- `REVOKED` withdraws a permission that still stood. It is not "the operation
  failed", and it is not a re-decision: the decision it superseded stays in the
  record and in the event history.
- `EXPIRED` is reached by the clock, not by a person, and is the only transition
  available from an already-granted approval.
- Rejection, expiry and revocation are terminal. A new attempt is a new Approval.

## Command authorization

v0.1 implements the **gate**, not the Command lifecycle:

```text
Command intent
  ↓
Approval check (existence, effective status, attribution, target, version,
                action, scope, bound command, deadline)
  ↓                    ↘
AUTHORIZED            WAIT (<reason>)
  ↓
(execution belongs to the Runtime / Effect layer — not implemented here)
```

- Passing the gate is not running the Command, and it is not recorded: there is
  no Effect ledger in v0.1, so authorization leaves no "consumed" fact behind.
- An Approval never waives the Command's own `expectedVersion`. A permission is
  not an exemption from optimistic concurrency.
- Nothing decides *when* approval is required yet. That is the Policy layer's
  question, and no per-object flag stands in for it.

## Effect

```text
REQUESTED
  ↓
AUTHORIZED
  ↓
DISPATCHED
  ↓
SUCCEEDED / FAILED
       or
     UNKNOWN
       ↓
   RECONCILIATION
```

---

# 8. Hard Architectural Invariants

**Numbering decision (recorded).** The archaeology track froze I-27…I-31 for
acceptance-bound, revision-lineage, and approval-boundary semantics
(`ARCHAEOLOGY_CLOSURE.md`, `FINAL_ARCHAEOLOGY.md`). Canonical numbering yields to
that frozen record: those five numbers are adopted here, and the four invariant
statements this document previously held at I-27…I-30 are **retained unchanged**
as I-32…I-35. No invariant statement was deleted or reinterpreted — only the
numbers of the four displaced statements moved. `FINAL_ARCHAEOLOGY.md` is a
research conclusion and is not implementation authority; its numbering is
adopted because the closure record already claimed it.

```text
I-01 Task/Goal is project acceptance authority.
I-02 Evidence precedes Acceptance.
I-03 Candidate Evidence is not Accepted Evidence.
I-04 Run is not Task.
I-05 Attempt is not Run.
I-06 Runtime State is not Project State.
I-07 Model is not Agent.
I-08 Capability is not Permission.
I-09 Evidence is versioned/traceable.
I-10 Stale evidence cannot complete current acceptance.
I-11 BLOCKED is resumable and is not identical to FAILED.
I-12 Human retains authority for product direction and high-risk approval.
I-13 External effects are not assumed exactly-once.
I-14 Agent cannot directly modify Project State.
I-15 Command is not Event.
I-16 Event is not State.
I-17 Workflow is not Team.
I-18 Effect is not Evidence.
I-19 UNKNOWN external effect must be reconciled before unsafe retry.
I-20 Memory must have source references.
I-21 Current Reality outranks Memory.
I-22 Parallel writes require isolation or proven non-overlap.
I-23 Large artifacts are externalized; durable core state stores references/hashes.
I-24 Runtime can be replaced without changing the Project Model.
I-25 Human retains final authority for project direction/high-risk operations.
I-26 Exactly-once external side effects must never be assumed by default.
I-27 Acceptance is contract-bound and evidence-bound.
I-28 Acceptance/evidence lineage must bind to a concrete revision identity.
I-29 Approval does not equal Acceptance.
I-30 Approval is scoped, attributable, and subject to its declared terminal/revocation semantics.
I-31 Human approval cannot manufacture missing evidence.
I-32 A Run may have multiple Attempts without becoming multiple Tasks.
I-33 Verification evaluates evidence; it does not itself become Project State.
I-34 A command must not silently overwrite a newer authoritative version.
I-35 Historical Events are not rewritten to repair current state.
I-36 Child completion is not parent acceptance; a parent with its own contract is accepted only through that contract.
I-37 Aggregate Evidence is an observation with an identity: one snapshot, one record, and a superseded record is history, never garbage.
I-38 Evidence that no longer describes current reality cannot carry an acceptance.
I-39 A parent's contract pin is a fact about that parent: the revision must target its own type and id, and both halves of the pin are required.
I-40 Approval authorizes a specific action on a specific target and scope; it is not a generic permission over an object.
I-41 An Approval is bound to a concrete target version and cannot authorize a newer authoritative version.
I-42 Approval does not imply execution success or Acceptance.
I-43 A revoked, expired, rejected, or stale Approval cannot authorize a Command.
I-44 An Approval's capability is part of the authorized action and must match the capability presented at authorization time.
I-45 A control fact must not claim support for a target type whose authoritative control object does not exist in the current Project Control model.
```

---

# 9. State / Command / Event Separation

```text
Command = requested action
Event   = fact that something happened
State   = current projection
```

Example:

```text
Command:
accept_task(task-123)

      ↓

Event:
task.accepted

      ↓

State:
Task.status = ACCEPTED
```

They are separate concepts and should remain separate in implementation.

---

# 10. Versioning and Concurrency

Mutable authoritative objects should use optimistic concurrency.

A command may include:

```text
expected_version = 7
```

If the current object is already version 8:

```text
CONFLICT
```

rather than silently overwriting version 8.

Aggregate-local ordering is sufficient; a global total event order is not required.

Use:

```text
aggregate.version
correlation_id
causation_id
command_id
idempotency_key
```

to reconstruct causal chains.

For ownership-sensitive operations, use bounded:

```text
lease
expiry
fencing token
```

rather than permanent locks.

---

# 11. Recovery Model

Recovery is broader than retry.

## L0 — Runtime Recovery

Examples:

- worker crash
- process exit
- timeout
- session interruption

Typical response:

- restart
- resume
- abandon Attempt

## L1 — Run Recovery

Examples:

- Attempt lost
- Run blocked
- runtime adapter failure

Typical response:

- new Attempt
- change runtime
- pause
- replan

## L2 — Project Recovery

Examples:

- stale evidence
- workspace divergence
- rejected acceptance
- dependency invalidation

Typical response:

- reopen Task
- invalidate evidence
- create corrective Task
- reconcile project state

## L3 — External Recovery

Examples:

- external API timed out
- deployment receipt unknown
- GitHub mutation uncertain

Typical response:

```textUNKNOWN
  ↓
reconcile
  ↓
resolved state
```

Recovery is not synonymous with retry.

---

# 12. Execution and Runtime Boundary

Project Control depends on a Runtime Adapter.

Conceptual interface:

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

Adapter metadata should expose:

- identity
- capabilities
- launch
- interrupt
- resume
- status
- events
- result
- permissions
- runtime references

Candidate adapters:

```text
DSHAdapter
ClaudeCodeAdapter
CodexAdapter
OpenCodeAdapter
```

These are implementation candidates, not architecture commitments.

---

# 13. Workflow vs Team

## Workflow

Use when the process is known and relatively deterministic.

```text
step A
 ↓
step B
 ↓
parallel C/D
 ↓
step E
```

## Team

Use when role collaboration is dynamic.

```text
Lead
 ├── Architect
 ├── Implementer
 ├── Tester
 └── Reviewer
```

Both are execution strategies inside a Run.

Neither is the Project Control model itself.

---

# 14. Memory and Context

## Truth hierarchy

```text
1. Current Reality
2. Verified Evidence
3. Accepted Project State
4. Decision / Constraint
5. Promoted Memory
6. Historical Run
7. Old Conversation
```

Memory cannot override current reality.

## Context Capsule

Only provide the relevant slice:

```text
Task
Acceptance Contract
Current Project State
Relevant Decisions
Relevant Memory
Latest Evidence
Workspace
Runtime Capabilities
Policy Context
```

Do not use the entire conversation as runtime context.

---

# 15. Workspace and Parallelism

Parallel work requires:

```text
Run A → Workspace A
Run B → Workspace B
Run C → Workspace C
```

or explicit proof:

```text
write_scope(A) ∩ write_scope(B) = ∅
```

A same-file collision must be blocked, serialized, or explicitly resolved.

Parallel execution must have:

- isolation
- ownership
- merge/conflict semantics
- final verification

---

# 16. Effect and Idempotency

External side effects are not assumed exactly-once.

Every mutating effect should have a logical:

```text
EffectId
idempotency_key
requested_by
RunId
AttemptId
destination
status
external receipt
reconciliation state
```

The system must tolerate:

```text
timeout
duplicate delivery
replay
worker crash after external success but before local receipt
```

This is why UNKNOWN is necessary.

---

# 17. Authority Matrix — Initial Form

| Object | Create | Modify | Verify | Accept | Invalidate/Reject | Recover |
|---|---|---|---|---|---|---|
| Project | Human | Human/Control | — | Human/Control | Human/Control | Human/Control |
| Roadmap | Human | Human | — | Human/Control | Human/Control | Human/Control |
| Milestone | Human/Control | Control | Reviewer | Acceptance Controller | Control | Control |
| Goal | Human/Control | Control | Reviewer | Acceptance Controller | Control | Control |
| Task | Human/Control | Control | Reviewer | Acceptance Controller | Control | Control |
| AcceptanceContract | Human/Control | Control | Reviewer | Acceptance Controller | Control | Control |
| Run | Control | Run Controller | — | — | Run Controller | Run Controller |
| Attempt | Runtime/Controller | Runtime | — | — | Controller | Controller |
| Workspace | Controller | Workspace Controller | Reality checks | — | Controller | Controller |
| Evidence | Runtime | Immutable after creation | Reviewer | Acceptance | Control | Re-verify |
| Verification | Reviewer/Verifier | Append-only | — | Acceptance | Control | Re-run |
| Decision | Human | Human | — | Human | Human | Human |
| Memory | Control/Promotion | Control | Source verification | Control | Control | Re-promote |
| ContextCapsule | Controller | Regenerate | — | — | Controller | Regenerate |
| Effect | Controller | Effect Controller | Reconciler | — | Controller | Reconcile |
| Command | Controller | Controller | Runtime result | — | Controller | Controller |
| DomainEvent | Runtime/Control | Append-only | — | — | Never rewrite | Compensating event |

This matrix is **PROPOSED**, not yet frozen.

---

# 18. Relationship Model

```text
Project
 ├── Roadmap
 │    └── Milestone
 │         └── Goal
 │              └── Task
 │                   ├── AcceptanceContract
 │                   ├── Run
 │                   │    ├── Attempt
 │                   │    │    └── Agent / Runtime
 │                   │    └── Workspace
 │                   └── Evidence
 │                        └── Verification
 │
 ├── Decision
 ├── Memory
 └── ContextCapsule
```

The same chain exists one and two levels up, with aggregate evidence standing in
for the runtime product a parent never has:

```text
Task  → Evidence(run/attempt)      → Verification → Task.accepted
Goal  → Evidence(child snapshot)   → Verification → Goal.accepted
Milestone → Evidence(goal snapshot) → Verification → Milestone.completed
```

`Goal` and `Milestone` may each carry their own Acceptance Contract. A parent that
declares none is still a derived summary of its children; a parent that declares
one is a decision that has to be proved.

Control path:

```text
Controller
   ↓
Command
   ↓
Runtime
   ↓
DomainEvent
   ↓
State Projection
```

External path:

```text
Run
 ↓
Effect
 ↓
External System
 ↓
Receipt
 ↓
Reconciliation
```

---

# 19. Persistence Direction

Not frozen yet.

The architecture requires durable separation between:

### Authoritative state

Small, queryable, versioned records:

- Project
- Goal
- Task
- Run
- Acceptance
- Effect
- Decision
- Memory metadata

### Append-oriented history

- Domain Events
- Verification records
- Evidence metadata
- Effect receipts

### Externalized artifacts

Large objects:

- logs
- screenshots
- patches
- browser traces
- build outputs
- reports
- generated files

Core state should normally keep:

```textreference
hash
metadata
revision
```

rather than embedding large artifacts.

Exact storage technology is OPEN.

---

# 20. Policy Model

Capability and Permission are separate.

```text
Capability:
What the runtime technically can do.

Permission:
What it is allowed to do in this Run/context.
```

Policy should be evaluated using:

```textActor
+ Capability
+ Resource
+ Action
+ Context
```

Possible decisions:

```textALLOW
DENY
REQUIRE_APPROVAL
```

Policy must be runtime-enforced rather than merely expressed in prompts.

### Policy and Approval

`REQUIRE_APPROVAL` is a Policy decision; an **Approval** (§5.19) is the durable
fact that satisfies it. Keeping them apart is what makes each auditable:

```text
Policy:    should this action be allowed, denied, or gated on a human decision?
Approval:  a named human decided, for THIS action, on THIS target version,
           within THIS scope — and the decision is still current.
```

`context.approval_state` in the policy schema is therefore backed by a real,
queryable fact rather than a string nobody owns.

v0.1 deliberately implements **neither** a Policy Engine nor the `REQUIRE_APPROVAL`
decision: nothing in the prototype decides that an action must be approved. What
exists is the other half — the gate that refuses to authorize a command without a
current, attributable, correctly scoped Approval — plus the durable record of the
decision itself. Wiring "which actions require approval" onto that gate is the
next Policy problem, not a reason to guess per object today.

---

# 21. Architectural Precedent / Reference Map

These references are inputs to design reasoning, not automatic dependencies.

## DSH

Relevant concepts:

- Workflow as model-written JS orchestration
- Agent Team as explicit team substrate
- durable team/task/message identity
- session identity
- shared workspace
- runtime/plugin replaceability

Use DSH as runtime infrastructure, not as the Project Control domain model.

## Codingns4DSH

Relevant concept:

- external CLI agents can be hosted as first-class DSH execution participants
- DSH can project external Agent event streams
- Agent and Model remain distinct
- credentials can remain outside the plugin/runtime bridge

Use as evidence for the Runtime Adapter / Agent Bridge boundary.

## dsh-bridges

Relevant concept:

- bridge multiple agent ecosystems and project assets into DSH

Use as reference for Agent/skill ecosystem interoperability.

## Archify

Relevant concepts:

- typed architecture IR
- evidence tied to repository/commit/file/line
- validation and delivery gates
- artifact hashing
- provenance
- failed delivery preserving prior artifact

Use as reference for evidence/provenance discipline, not as the Project OS itself.

## Agent Harness

Relevant concepts:

```text
Roadmap → Milestone → Goal → Task → Run → Evidence → State Sync
```

Especially important:

> Task is not Run.

A Task can have multiple execution attempts.

## Agent Execution Harness

Relevant concepts:

```text
understand
→ plan
→ context
→ execute
→ verify
→ record evidence
→ verify claims
→ report
→ remember
```

Important memory distinction:

- Plan Artifact
- Codebase Memory
- Learning Memory

Important principle:

> memory cannot override current reality.

## Agent OS projects

Relevant concepts:

- Project-scoped memory
- Main Agent as brain / Coding Agent as hands
- task graph
- isolated workspaces
- verification gates
- recovery matrix
- durable artifacts/event traces
- human approval gates
- verification as ground truth for done

These are reference patterns, not dependencies.

## AgentLedger

Relevant concepts:

- durable execution
- tool/effect ledger
- evidence/replay
- policy/approval boundaries
- sandbox boundary
- idempotency
- unknown-state handling
- leases/fencing
- recovery

Important architectural boundary:

> planning belongs to an agent/workflow framework; durable state, effect tracking, evidence, policy, replay, and recovery belong to the reliability/control layer.

## Kubernetes

Relevant concepts:

- desired vs observed state
- resource version / optimistic concurrency
- stale update conflict
- reconciliation loop

These are conceptual references only.

## AWS Durable Execution

Relevant concepts:

- retries/replay can repeat operations
- external side effects need idempotency
- exactly-once semantics must not be assumed

## OpenFGA

Relevant concepts:

- actor/resource/action relationships
- contextual authorization
- authorization as explicit data/model rather than prompt wording

Do not introduce OpenFGA as a dependency unless later justified.

---

# 22. Confirmed Architecture

The following are currently CONFIRMED:

- Project Control is separate from execution runtime.
- Task, Run, Attempt, Evidence, Verification, Acceptance are distinct.
- Evidence is required before acceptance.
- Agent cannot directly modify authoritative Project State.
- Runtime State is separate from Project State.
- Command, Event, and State are separate.
- External effects require UNKNOWN/reconciliation semantics.
- Capability and Permission are separate.
- Approval and Acceptance are separate: permission is not correctness.
- A durable Approval binds one target version, one action and one scope, and must be attributable to a named decider.
- Current Reality outranks Memory.
- Parallel writes require isolation or proven non-overlap.
- Runtime should be replaceable behind an adapter boundary.
- A Task may have multiple Runs/Attempts.
- Acceptance must be based on explicit criteria and evidence.
- Memory requires provenance.
- Large artifacts should be externalized from core durable state.
- Recovery is broader than retry.

---

# 23. Proposed / Not Yet Frozen

- Exact persistence technology.
- Exact API/transport.
- Exact event-store implementation.
- Exact DSH integration mechanism.
- Exact Team/Workflow mapping.
- Exact Agent Bridge implementation.
- Exact Policy Engine (v0.1 has a durable Approval and a gate, but nothing decides
  that an approval is required).
- Command lifecycle states (v0.1 has the authorization gate, not a Command record
  with its own status).
- The COMMAND approval target: reserved in the vocabulary, refused everywhere in
  v0.1, and only meaningful once Command is a durable control object.
- Approval scope algebra (v0.1 compares `scope` exactly; no wildcards, prefixes,
  or containment).
- Whether approval consumption is recorded (that is an Effect-ledger question).
- Exact schema serialization format.
- Exact Controller/Reconciler implementation.
- Whether all mutable objects use identical version semantics.
- Final lifecycle states.
- Exact artifact store.
- Exact observability implementation.
- Exact lease/fencing implementation.

---

# 24. Open Questions

Q-01 What is the minimum persistence model?

Q-02 Which objects require independent version numbers?

Q-03 What exact Event schema is required?

Q-04 What exact Command contract is required?

Q-05 What is the minimum viable Controller/Reconciler?

Q-06 How should DSH Workflow and Agent Team map into Run?

Q-07 How should external Agent bridges map AgentId / RuntimeId / SessionId?

Q-08 Which Effects require human approval?

Q-09 What is the minimum durable artifact store?

Q-10 What is the smallest executable prototype that can validate the domain model without rebuilding an agent runtime?

Q-11 Which parts should be implemented by existing DSH capabilities rather than recreated?

Q-12 What existing GitHub implementations can falsify or simplify this model?

---

# 25. Change Discipline

Before adding a domain object:

1. Check existing objects.
2. Try a field/state/relationship first.
3. If insufficient, explain why.
4. Record the architectural decision.
5. Mark the new object PROPOSED.
6. Only freeze after validation.

Before changing an invariant:

1. Identify the invariant.
2. State the conflict.
3. Compare alternatives.
4. Validate against external precedent where appropriate.
5. Record the decision.
6. Update this document version.

Never silently reinterpret a confirmed concept.

---

# 26. Current Next Step

Do NOT jump directly into implementation.

The next architecture artifact should be:

**Authority + Relationship Matrix v0.1**

Then:

1. freeze the relationship model
2. freeze state transitions
3. define Command contract
4. define Event contract
5. define persistence boundary
6. define minimum Controller/Reconciler
7. map existing DSH capabilities onto the model
8. identify what does NOT need to be built
9. create a tiny validation prototype
10. only then decide implementation architecture

The goal is to avoid rebuilding an existing runtime and to validate the Project Control model itself.

---

# 27. Authority + Relationship Matrix v0.1

Status: PROPOSED

This matrix defines who may create, modify, execute, verify, and accept the canonical domain objects.

| Object | Human | Control Plane | Agent/Runtime | Reviewer | Acceptance Controller |
|---|---|---|---|---|---|
| Project | direct | maintain | read/propose | read | read |
| Goal | direct | maintain | propose | read | read |
| Task | direct/propose | authoritative lifecycle | execute/propose | read | accept through control plane |
| Run | direct cancel/approve | authoritative lifecycle | execute/report | read | read |
| Attempt | read/cancel | lifecycle | own execution | read | read |
| Workspace | approve scope | lifecycle | use within permission | inspect | read |
| Evidence | read/approve | record/retain | produce | inspect | consume |
| Verification | read | record | produce proposal | authoritative verdict | consume |
| Approval | **authoritative decision** | record/enforce, never manufacture | request only | read | read |
| Acceptance | direct high-level override | authoritative transition | cannot accept | verify | evaluate |
| Decision | authoritative direction | record | propose | advise | read |
| Memory | curate | maintain | propose with provenance | validate | consume |
| Effect | approve high-risk | authorize/reconcile | request/execute | verify result | read |
| Command | approve where required | issue/authorize | execute | read | read |
| Event | read | append/project | emit runtime facts | read | read |

### Relationship direction rules

- Project contains Roadmaps and Goals.
- Roadmap contains Milestones.
- Milestone contains Goals.
- Goal contains Tasks.
- Task references one Acceptance Contract revision and may have many Runs.
- Run contains Attempts and references Workspace and Runtime.
- Attempt may produce Evidence.
- Evidence is evaluated by Verification.
- Acceptance consumes Verification and Evidence.
- Decision and Memory influence future Context Capsules but do not override current Reality.
- Effects are external side effects and are reconciled separately from Evidence.

### Acceptance relationship

Acceptance is not a property an Agent may set directly.

The causal chain is:

Evidence → Verification → Acceptance evaluation → Control Plane state transition.

A Task references **one specific Acceptance Contract revision**:

```text
Contract identity = (AcceptanceId, AcceptanceVersion)

Task.acceptance_id + Task.acceptance_version                  →  that revision
Evidence.acceptance_id + Evidence.acceptance_version          →  the same revision
Verification.acceptance_id + Verification.acceptance_version  →  the same revision
```

- Changing contract content requires a new revision.
- Changing Acceptance `status` (`PENDING → PASSED`) is **not** a contract revision
  change.
- An existing Task does not drift with the Acceptance head revision: it stays
  bound to the revision it was created against.
- Acceptance is evaluated against that pinned revision, never against the newest
  one.

A Goal or a Milestone pins a contract revision the same way, and its evidence is
an observation of its own children rather than a Runtime product:

```text
Goal.acceptance_id + Goal.acceptance_version        →  that revision
Milestone.acceptance_id + Milestone.acceptance_version →  that revision
Evidence.source_refs (child snapshot)               →  the observed children
```

- A parent contract revision must target that parent's own type and id.
- A revised contract does not re-open an accepted decision, and a newer revision
  does not move an existing pin.

### Approval relationship

An Approval is about a target, not owned by it:

```text
Approval.request.target_type + target_id + target_version  →  what it authorizes
Approval.action + capability + scope                       →  how far it reaches
Approval.command_id                                        →  the command it is for
Approval.decision.decided_by                               →  who decided (required)
```

- It does not become part of the target's state: a Task with an approved deploy is
  still a READY Task, and no approval is created by accepting anything.
- It does not follow the target: when the target's version moves, the approval is
  STALE and authorizes nothing.
- It does not widen: matching target, version, action and scope with a different
  **capability** is a different authorization, and `CAPABILITY_MISMATCH` is its own
  refusal — the capability is not a label on the action, it is part of it.
- Project membership and approval scope are unrelated mechanisms: `scope` is an
  opaque, exactly-compared label in v0.1, not a tree of project resources.

### Project State authority boundary

Only the Control Plane may mutate authoritative project state. Agents and runtimes may emit execution facts, results, evidence, and proposals.

### Matrix status

This matrix remains PROPOSED until validated against executable prototypes and external implementations.
