# ADR-0003 — Policy decision and Approval composition boundary

**Status:** ACCEPTED  
**Date:** 2026-09-30  
**Roadmap phase:** G4 — Policy / authorization composition  
**Related invariants:** I-08, I-12, I-25, I-29..I-31, I-40..I-45

## Context

G2 introduced durable Commands. G3 introduced durable Effects.

The remaining authorization gap is that the current Command gate still behaves as
if every Command requires Approval. The architecture already says this is wrong:

```text
Policy decides whether approval is required.
Approval is the durable human permission fact.
```

The Control Plane therefore needs a deterministic decision at the enforcement
point:

```text
ALLOW | DENY | REQUIRE_APPROVAL
```

without collapsing Policy into Approval or prompt text.

## External evidence

Focused G4 research is recorded in
`docs/architecture/SOURCE_TRACEABILITY.md §22`.

Implementation-backed references:

- Agent Execution Harness keeps command policy evaluation separate from command
  execution and fails closed on denied/not-allowed commands.
- AgentLedger normalizes PolicyRequest/PolicyDecision, composes deterministic
  findings into `allow / deny / require_approval`, evaluates before tool/effect
  execution, records policy decision information, and keeps Approval separate.

The transferable boundary is strong enough to settle G4 without reopening broad
archaeology.

## Decision

### 1. Policy evaluation is a deterministic control-plane gate

Policy is not model reasoning and not prompt text.

The engine receives a normalized request derived from durable/current facts:

```yaml
subject:
  id: string
command:
  id: CommandId
  version: integer
  target_type: string
  target_id: string
  target_version: integer
  action: string
  capability: string
  scope: string
  risk_level: string
resource:
  current_version: integer
context: object
policy_version: string
```

The Command fields are read from the durable Command, not supplied again by the
caller.

### 2. Decision effects are exactly three values

```text
ALLOW
DENY
REQUIRE_APPROVAL
```

Composition precedence is:

```text
DENY > REQUIRE_APPROVAL > ALLOW
```

A deny cannot be overridden by a human Approval.

### 3. PolicyDecision is an immutable audit/control fact

Each evaluation may be recorded as a distinct immutable PolicyDecision:

```yaml
id: PolicyDecisionId
command_id: CommandId
command_version: integer
target_version: integer
effect: ALLOW | DENY | REQUIRE_APPROVAL
policy_version: string
subject_id: string
context: object
reasons: string[]
matched_rule_ids: string[]
created_at: timestamp
```

PolicyDecision is not Project State and has no mutable lifecycle.

Multiple evaluations for one still-CREATED Command are allowed. This is important
because policy can be re-evaluated after waiting for Approval.

### 4. Authorization always uses a current PolicyDecision

Controller flow becomes:

```text
stored CREATED Command
  ↓
read current target
  ↓
evaluate Policy now
  ↓
record PolicyDecision
  ↓
DENY             → REJECTED
ALLOW            → AUTHORIZED
REQUIRE_APPROVAL → verify durable Approval
                     ↓
                   WAIT | AUTHORIZED | REJECTED
```

The Command still performs its own target-version/concurrency checks.

### 5. Approval only satisfies REQUIRE_APPROVAL

If Policy returns ALLOW:

- no Approval is required;
- no synthetic Approval is created;
- Command may authorize with `approvalId = null`.

If Policy returns REQUIRE_APPROVAL:

- missing/pending Approval → WAIT, Command stays CREATED;
- usable current Approval → AUTHORIZED;
- definite unusable Approval may reject according to the existing reason table.

If Policy returns DENY:

- Command becomes REJECTED;
- presenting an Approval changes nothing.

### 6. Command authorization records both policy and approval provenance

Command authorization gains:

```yaml
policy_decision_id: PolicyDecisionId
approval_id: ApprovalId?
authorized_at: timestamp?
rejected_at: timestamp?
reason: string?
approval_reason: string?
```

An AUTHORIZED Command must identify the PolicyDecision that allowed it.

An Approval id is required only when the decision effect was REQUIRE_APPROVAL.

### 7. Policy rules are engine configuration, not durable Project objects in G4

G4 implements a small deterministic in-process PolicyEngine with explicit
versioned configuration.

The durable fact is the evaluated PolicyDecision.

This keeps the first implementation bounded while preserving the later ability to
swap in OPA/Cedar/enterprise policy adapters behind the same decision contract.

### 8. G4 default is fail closed

The reference/static engine defaults to DENY when no rule matches.

Rules may match exact normalized dimensions such as:

- subject;
- target type;
- action;
- capability;
- scope;
- risk level.

Rules are composed independent of declaration order using the precedence above.

### 9. Policy is re-evaluated at each authorization attempt

A prior PolicyDecision is historical evidence of what the gate decided then.

It is not a permanent permission token.

When a Command remains CREATED because Approval is pending, a later authorization
attempt evaluates Policy again using the current policy version/context.

### 10. G4 does not enable COMMAND-target Approval

Policy/Approval composition does not require changing the target of Approval.

The existing Approval model remains bound to the underlying Project/Task action
and target version in G4.

COMMAND-target Approval stays reserved/fail closed.

## Alternatives considered

### A. Keep “Approval always required” as implicit policy

Rejected. That is a hidden Policy Engine and prevents ALLOW/DENY semantics.

### B. Let Approval override DENY

Rejected. It collapses human permission into policy authority and makes deny
rules non-enforceable.

### C. Store mutable Policy objects/rules in the Project Control database now

Deferred. G4 needs a versioned evaluator and durable decision audit, not a full
policy-management product.

### D. Do not persist PolicyDecision

Rejected. Then later audit cannot distinguish “allowed by policy” from
“authorization bypassed policy”.

### E. Evaluate policy once when Command is created

Rejected. Authorization may happen later under changed policy/context; the
enforcement point must evaluate current policy.

## Consequences

Positive:

- Approval and Policy finally have non-overlapping authority;
- low-risk/explicitly allowed operations need not manufacture human approvals;
- DENY is genuinely enforceable;
- authorization audit can state which policy version/rules decided the gate;
- a future external policy engine can replace the static engine without changing
  Command/Approval semantics.

Costs:

- adds immutable PolicyDecision records;
- existing Command authorization APIs/tests must include policy evaluation;
- repeated WAIT attempts may create multiple PolicyDecision audit records;
- policy configuration/version must be explicit.

## Implementation boundary

After this ADR, the following is **B — Missing Implementation**:

- PolicyEffect / PolicyDecision domain vocabulary;
- immutable PolicyDecision collection in MemoryStore/SQLite;
- deterministic StaticPolicyEngine with version + fail-closed default;
- normalized request derived from durable Command/current target;
- Controller evaluates + records policy at every authorization attempt;
- Command authorization consumes stored PolicyDecision;
- ALLOW path without Approval;
- DENY path that Approval cannot override;
- REQUIRE_APPROVAL path using existing Approval semantics;
- backend parity, restart and audit/event tests.

Outside G4:

- external OPA/Cedar integration;
- policy authoring UI;
- enterprise identity/role directory;
- COMMAND-target Approval;
- real runtime adapter;
- effect dispatch policy beyond the Command authorization point.

## Verification / exit criteria

G4 is complete only if tests prove:

1. authorization without PolicyDecision is impossible;
2. PolicyRequest action/capability/target derive from stored Command;
3. unmatched rule defaults to DENY;
4. explicit DENY rejects even with valid Approval;
5. ALLOW authorizes without Approval;
6. REQUIRE_APPROVAL with no/pending Approval returns WAIT;
7. REQUIRE_APPROVAL with usable Approval authorizes;
8. stale/revoked/etc. Approval cannot satisfy REQUIRE_APPROVAL;
9. AUTHORIZED Command records policyDecisionId;
10. approvalId is optional only for ALLOW;
11. repeated WAIT re-evaluates current policy rather than reusing an old decision;
12. PolicyDecision is immutable and survives restart;
13. both backends share semantics;
14. Policy evaluation starts no runtime/effect;
15. full Node 22 CI passes with zero skips.
