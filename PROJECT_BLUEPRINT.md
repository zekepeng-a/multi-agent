# PROJECT_BLUEPRINT.md

**Status:** FROZEN DIRECTION / project constitution  
**Scope:** Project Control OS inside this repository  
**Authority:** This file defines the long-term direction and non-negotiable boundaries. It does **not** claim that every item is already implemented.  
**Read order for architecture work:** `PROJECT_BLUEPRINT.md` → `docs/architecture/PROJECT_CONTROL_OS_ARCHITECTURE.md` → current code/tests → `ROADMAP.md` (when present).

---

## 1. Project identity

This repository is evolving from a self-contained multi-agent runtime prototype into a **Project Control OS**.

The Project Control OS is a thin control layer above replaceable agent runtimes. Its purpose is to keep project intent, controlled execution, reality, evidence, verification, accepted state, decisions, and recovery consistent across long-running work.

It is **not** another multi-agent runtime.

DSH, Claude Code, Codex, OpenCode, DSH Workflow, DSH Agent Team, and future runtimes are execution substrates behind adapters. They are not the project-control authority.

The durable product is the control model and its guarantees, not one runtime implementation.

---

## 2. Core question

The project exists to answer:

> How can a project preserve intent, authority, state, evidence, and recovery semantics while multiple replaceable agents/runtimes perform work in a changing real environment?

It does **not** primarily answer:

> How can more agents cooperate with each other?

Agent collaboration is an execution concern. Project correctness is a control concern.

---

## 3. Canonical loop

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
Result / Effect
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

Control/reconciliation loop:

```text
Desired State
  + Current State
  + Current Evidence
        ↓
      Observe
        ↓
      Compare
        ↓
     Reconcile
        ↓
      Command
        ↓
      Runtime
        ↓
       Event
        ↓
   Current State
        ↓
   Observe again
```

---

## 4. Five-layer model

### L1 — Project Control

Owns project meaning and accepted state:

- Project
- Roadmap
- Milestone
- Goal
- Task
- Acceptance Contract
- Decision
- project-facing Memory
- Context Capsule

Question: **What are we trying to achieve, and what is accepted?**

### L2 — Control & Recovery

Owns legal change and recovery:

- Controllers
- Reconciliation
- Recovery
- Policy
- Approval
- Commands
- leases/fencing/ownership when required

Question: **Given desired state and observed state, what controlled action may happen next?**

### L3 — Execution

Owns attempts to perform work:

- Run
- Attempt
- Runtime Adapter
- Agent
- Workflow
- Team

Question: **How is the requested work executed?**

### L4 — Reality

The external world:

- Workspace
- Files
- Git
- Shell
- Browser
- Build
- Test
- Deploy
- External services

Question: **What actually happened?**

### L5 — Evidence & History

Owns durable proof and historical facts:

- Evidence
- Verification
- Event
- Effect
- Receipt
- Audit
- Artifact references

Question: **What proves what happened, and what historical facts must survive?**

Cross-cutting concerns:

- Identity
- Versioning
- Context
- Memory
- Observability
- Durability
- Correlation
- Concurrency

---

## 5. Authority model

### Human — Intent Authority

The human owns product/project direction and high-risk approval.

### Control Plane — State Authority

The control plane owns authoritative Project / Goal / Task / Run / Acceptance state and legal transitions.

### Runtime / Agent — Execution Authority

Agents and runtimes may perform granted work and produce results/evidence. They do not directly accept project work or mutate authoritative project state.

### Reviewer — Verification Authority

A verifier evaluates evidence and produces a verdict. Verification is not project-state authority.

### Acceptance Controller — Acceptance Authority

Acceptance is derived only through the declared contract, current evidence, verification, revision identity, and applicable policy.

### Approver — Permission Authority

Approval authorizes a concrete action on a concrete target/version/scope/capability. Approval is permission, not correctness and not proof of execution.

---

## 6. Fundamental boundaries

These distinctions must remain explicit:

- **Model ≠ Agent**
- **Agent ≠ Runtime**
- **Task ≠ Run**
- **Run ≠ Attempt**
- **Workflow ≠ Team**
- **Capability ≠ Permission**
- **Approval ≠ Acceptance**
- **Effect ≠ Evidence**
- **Verification ≠ Project State**
- **Command ≠ Event**
- **Event ≠ State**
- **Memory ≠ Current Reality**
- **Runtime State ≠ Project State**
- **Execution substrate ≠ Project Control**

DSH Workflow and Agent Team are execution strategies inside a Run. They are not Project, Goal, Task, Acceptance, or State Authority.

---

## 7. Truth hierarchy

When facts conflict, prefer:

```text
Current Reality
  > Verified Evidence
  > Accepted Project State
  > Decisions / Constraints
  > Promoted Memory
  > Historical Run records
  > Old conversation context
```

Chat history is never architectural authority.

A DSH report is evidence about an execution or audit. It is not automatically truth and does not define the roadmap.

---

## 8. Persistence rule

The repository is the shared durable memory between humans, GPT, DSH, and other agents.

Durable architecture must be recoverable without relying on chat recall.

The governance structure is:

- `PROJECT_BLUEPRINT.md` — long-term identity, boundaries, non-negotiable invariants
- `docs/architecture/PROJECT_CONTROL_OS_ARCHITECTURE.md` — canonical detailed design
- `PROJECT_ARCHITECTURE.md` — concise description of what is actually implemented now
- `ROADMAP.md` — next intended development sequence
- `CHANGELOG.md` — architectural evolution and meaningful changes
- `docs/architecture/decisions/ADR-*.md` — decisions that need durable rationale

Existing detailed architecture documents remain valid inputs. These governance files organize them; they do not erase history.

---

## 9. Change classification

Before any implementation prompt, change request, or refactor, classify the work:

### A. Implementation Bug

The implementation violates already-decided architecture or invariants.

**Action:** fix it and prove the fix.

### B. Missing Implementation

The architecture already defines the behavior, but code does not implement it yet.

**Action:** implement the existing contract.

### C. Architectural Conflict

Two implemented or documented parts contradict the frozen blueprint/invariants.

**Action:** resolve the contradiction against the constitution and record the architectural impact.

### D. Architectural Gap

A required concept has no settled authority boundary, invariant, recovery rule, or persistence meaning.

**Action:** stop coding; research external precedent and write/decide an ADR first.

### E. Direction Change

The proposed change alters project identity, authority boundaries, core loop, or long-term product direction.

**Action:** return to the human. Do not silently decide it in code.

---

## 10. Research discipline

The project must avoid closed-world design.

Before introducing a new architectural mechanism, prefer this evidence order:

1. official/runtime-native behavior and documentation;
2. established open-source implementations;
3. smaller relevant community implementations;
4. local synthesis only after external evidence is understood.

External projects are precedent, not authority. We borrow mechanisms, not names or architecture wholesale.

Broad architecture archaeology is considered closed unless implementation exposes a genuinely unresolved:

- authority boundary;
- invariant;
- failure mode;
- recovery model;
- concurrency model;
- persistence requirement;
- or materially different external effect semantics.

Implementation questions may still trigger focused research.

---

## 11. Runtime replaceability

Project Control must remain usable if DSH is replaced.

The runtime boundary should converge on an adapter contract conceptually equivalent to:

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

Runtime metadata may include:

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

Project Control objects must not depend on a runtime-specific session model.

---

## 12. Context and memory

Context supplied to an execution should be a bounded **Context Capsule**, not an unstructured dump.

Conceptual contents:

- Task
- Acceptance Contract
- Constraints
- Relevant Decisions
- Relevant Memory
- Latest Evidence
- Current Project State
- Runtime Capability
- Policy / permissions

Memory must be source-referenced. Memory can help reasoning but cannot override current reality.

---

## 13. Concurrency and identity

Mutable authoritative state uses version-aware concurrency protection.

Historical evidence/events/verifications are immutable or append-only facts.

Identity domains must remain separate:

### Project-control identity
ProjectId, RoadmapId, MilestoneId, GoalId, TaskId, AcceptanceId, DecisionId, MemoryId

### Execution identity
RunId, AttemptId, WorkspaceId, CommandId, EffectId

### Evidence identity
EvidenceId, VerificationId

### Runtime identity
AgentId, RuntimeId, SessionId, WorkflowId, TeamId

### Observability identity
EventId, TraceId, SpanId, CorrelationId, CausationId

Parallel writes require isolated workspaces or proven non-overlap.

---

## 14. Recovery doctrine

Recovery is not blind retry.

If the outcome of an external operation is unknown:

1. observe/reconcile first;
2. establish whether the effect occurred;
3. only re-execute when non-occurrence is confirmed or the operation is otherwise proven safe/idempotent.

Exactly-once external effects are never assumed.

Recovery layers:

- L0 Runtime
- L1 Run
- L2 Project
- L3 External

Unknown external effect means **reconciliation required**, not “retry”.

---

## 15. Frozen invariants

The following are constitutional constraints. Detailed wording and implementation notes live in `docs/architecture/PROJECT_CONTROL_OS_ARCHITECTURE.md`.

- **I-01** Task/Goal is project acceptance authority.
- **I-02** Evidence precedes Acceptance.
- **I-03** Candidate Evidence is not Accepted Evidence.
- **I-04** Run is not Task.
- **I-05** Attempt is not Run.
- **I-06** Runtime State is not Project State.
- **I-07** Model is not Agent.
- **I-08** Capability is not Permission.
- **I-09** Evidence is versioned/traceable.
- **I-10** Stale evidence cannot complete current acceptance.
- **I-11** BLOCKED is resumable and is not identical to FAILED.
- **I-12** Human retains authority for product direction and high-risk approval.
- **I-13** External effects are not assumed exactly-once.
- **I-14** Agent cannot directly modify Project State.
- **I-15** Command is not Event.
- **I-16** Event is not State.
- **I-17** Workflow is not Team.
- **I-18** Effect is not Evidence.
- **I-19** UNKNOWN external effect must be reconciled before unsafe retry.
- **I-20** Memory must have source references.
- **I-21** Current Reality outranks Memory.
- **I-22** Parallel writes require isolation or proven non-overlap.
- **I-23** Large artifacts are externalized.
- **I-24** Runtime is replaceable without changing the Project Model.
- **I-25** Human is final authority for project direction/high-risk approval.
- **I-26** Exactly-once external effects are never assumed.
- **I-27** Acceptance is contract-bound and evidence-bound.
- **I-28** Acceptance/evidence lineage pins a concrete revision.
- **I-29** Approval does not equal Acceptance.
- **I-30** Approval is scoped, attributable, and has terminal/revocation semantics.
- **I-31** Human approval cannot manufacture evidence.
- **I-32** Multiple Attempts in a Run do not create multiple Tasks.
- **I-33** Verification evaluates evidence; it does not own Project State.
- **I-34** A Command must not silently overwrite newer authoritative state.
- **I-35** Historical Events are not rewritten to repair current state.
- **I-36** Child completion does not equal parent acceptance; a parent with its own contract passes through that contract.
- **I-37** Aggregate Evidence is an identified observation of one concrete child snapshot; superseded observations remain history.
- **I-38** Evidence that is no longer current cannot carry acceptance.
- **I-39** A parent contract pin is a fact about its own target type/id and requires both acceptance id and version.
- **I-40** Approval authorizes a specific action on a specific target/scope.
- **I-41** Approval is bound to a concrete target version and cannot authorize a newer one.
- **I-42** Approval does not imply execution success or Acceptance.
- **I-43** Revoked, expired, rejected, stale, or otherwise unusable Approval cannot authorize a Command.
- **I-44** Capability is part of the approved action and must match the capability presented at authorization.
- **I-45** A control fact must not claim support for a target type whose authoritative control object does not exist in the current Project Control model.

If code or another document contradicts these invariants, that contradiction must be surfaced explicitly. It must not be silently normalized.

---

## 16. Current implementation boundary

This blueprint intentionally separates **direction** from **implementation status**.

At the current controller-v0.1 stage, several concepts exist only partially or are reserved for later rounds. In particular:

- Project / Milestone / Goal / Task lifecycle exists in prototype form.
- Task and parent Acceptance flows exist in prototype form.
- Run / Attempt / Evidence / Verification and reconciliation exist in prototype form.
- durable Approval exists in prototype form.
- COMMAND approval target is reserved but intentionally unsupported until a durable Command model exists.
- Effect Ledger is not yet implemented.
- Policy is architectural, not yet a complete runtime-enforced policy engine.
- Runtime adapters are still prototype-level and must remain replaceable.
- Roadmap is architectural and not yet a complete lifecycle domain.
- Project-level Acceptance is not implemented.

The detailed “what exists now” view belongs in `PROJECT_ARCHITECTURE.md`, after a repository reality audit.

---

## 17. Working loop for GPT / DSH / human

Every substantial change should follow:

```text
PROJECT_BLUEPRINT
      ↓
CURRENT PROJECT_ARCHITECTURE
      ↓
ROADMAP
      ↓
current task
      ↓
DSH / implementation
      ↓
tests + evidence
      ↓
architecture diff
      ↓
independent review
      ↓
accepted change
      ↓
update PROJECT_ARCHITECTURE / ROADMAP / CHANGELOG / ADR if needed
```

No actor may skip directly from “idea” to “architecture truth”.

---

## 18. Definition of progress

Progress is not measured by:

- number of agents;
- number of prompts;
- number of documents;
- model sophistication;
- or lines of orchestration code.

Progress means increasing the system’s ability to preserve:

- correct authority;
- traceable identity;
- current evidence;
- legal state transitions;
- safe external effects;
- recoverability;
- runtime replaceability;
- and human control.

---

## 19. Stop conditions

Implementation must stop and escalate when:

- a change would alter the project identity or authority model;
- an invariant would need to be weakened or removed;
- two sources of truth conflict and neither clearly dominates;
- an external effect cannot be safely classified or reconciled;
- a required target/control object does not exist but another object claims authority over it;
- evidence cannot prove the requested state transition;
- or a new architectural concept is being invented without external precedent or an explicit ADR.

Fail closed is preferred to silently pretending the architecture is more complete than it is.

---

## 20. Immediate governance objective

Before the next major control-plane feature:

1. establish this blueprint;
2. perform a **read-only Reality Audit** of the current branch;
3. create `PROJECT_ARCHITECTURE.md` from verified current code/tests;
4. create `ROADMAP.md` from the gap between blueprint and reality;
5. create `CHANGELOG.md` for architectural evolution;
6. only then resume feature implementation.

The next feature must be selected from the roadmap, not from conversational momentum.
