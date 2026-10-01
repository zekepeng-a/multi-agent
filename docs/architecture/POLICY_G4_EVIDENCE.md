# G4 Policy / Approval Composition — Implementation Evidence

**Roadmap phase:** G4  
**Architecture decision:** `ADR-0003-policy-approval-composition.md`  
**Verified head:** `779dac5d861189da227cec22cddeab122bb3057d`  
**CI run:** GitHub Actions `36681046933`

## Implemented boundary

G4 introduces deterministic Policy evaluation between stored Command intent and
Command authorization.

The authorization control flow is now:

```text
stored CREATED Command
  ↓
read current target
  ↓
evaluate current policy
  ↓
persist immutable PolicyDecision
  ↓
DENY             → REJECTED
ALLOW            → AUTHORIZED
REQUIRE_APPROVAL → Approval gate
                     ↓
                   WAIT | AUTHORIZED | REJECTED
```

Approval is no longer an implicit universal policy.

## Policy engine

`project-control/policy-engine.mjs` provides the bounded reference engine:

- explicit policy version;
- exact normalized rule matching;
- deterministic composition;
- precedence `DENY > REQUIRE_APPROVAL > ALLOW`;
- fail-closed default DENY when no rule matches.

Policy evaluation derives action/capability/target/risk/subject from the durable
Command plus current target state. A caller does not get to substitute those
facts at authorization time.

## Durable PolicyDecision

PolicyDecision is persisted as an immutable audit/control fact in both MemoryStore
and SQLite.

It records:

- command id/version;
- target version;
- subject id;
- effect;
- policy version;
- context;
- reasons;
- matched rule ids;
- creation time.

Multiple decisions may exist for a still-CREATED Command because each
authorization attempt re-evaluates current policy.

PolicyDecision is not Project State and has no mutable lifecycle.

## Approval composition

### ALLOW

- no Approval is required;
- no synthetic Approval is created;
- successful Command authorization records `policyDecisionId` and
  `approvalId = null`.

### DENY

- Command is rejected;
- presenting a valid Approval does not override DENY.

### REQUIRE_APPROVAL

- missing/pending Approval → WAIT; Command stays CREATED;
- usable Approval → AUTHORIZED;
- stale/revoked/expired/mismatched Approval remains unusable.

COMMAND-target Approval remains unsupported. G4 continues to bind Approval to
the underlying Project/Task action/version.

## Runtime/effect boundary

Policy authorization itself:

- starts no Runtime;
- creates no Run/Attempt;
- creates no Effect;
- changes no Task/Goal Acceptance state.

Policy decides whether a stored Command may pass the gate. It does not execute
the Command.

## Backend and restart proof

The PolicyDecision collection exists in both MemoryStore and SQLite.

The real process-restart probe now reopens the database in a second OS process
and verifies that the exact PolicyDecision used for Command authorization still
exists with the same:

- id;
- `REQUIRE_APPROVAL` effect;
- policy version;
- command id/version;
- target version;
- subject id.

The replayed authorization does not manufacture another PolicyDecision or a
second authorization event.

## Verification

Latest full CI:

```text
Node 22.23.2
tests   484
pass    484
fail    0
skipped 0
```

Package-floor CI:

```text
Node 20.20.2
tests   484
pass    325
fail    0
skipped 159
```

The Node 22 job continues to assert built-in `node:sqlite` availability before
the test suite.

## ADR-0003 exit criteria assessment

1. authorization without PolicyDecision is impossible — covered;
2. normalized policy request derives from stored Command facts — covered;
3. unmatched rule defaults to DENY — covered;
4. DENY cannot be overridden by Approval — covered;
5. ALLOW authorizes without Approval — covered;
6. REQUIRE_APPROVAL missing/pending → WAIT — covered;
7. REQUIRE_APPROVAL + usable Approval → AUTHORIZED — covered;
8. unusable Approval cannot satisfy REQUIRE_APPROVAL — covered;
9. AUTHORIZED Command records policyDecisionId — covered;
10. approvalId optional only for ALLOW — covered;
11. repeated WAIT re-evaluates policy — covered;
12. PolicyDecision is immutable and survives restart — covered;
13. MemoryStore and SQLite share semantics — covered;
14. policy evaluation starts no runtime/effect — covered;
15. Node 22 full CI passes with zero skips — covered.

This evidence satisfies the G4 exit gate.

## Boundary for G5

G4 ends with an authorized durable Command and a durable audit trail explaining
the Policy/Approval reasoning that allowed or rejected it.

G5 may now address a different question:

> how does Project Control talk to a real, replaceable execution runtime without
> letting runtime-specific Session/Workflow/Team state become Project authority?

That remains an architecture gate, not an implementation task yet.
