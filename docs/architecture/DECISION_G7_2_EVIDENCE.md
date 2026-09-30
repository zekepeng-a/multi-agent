# G7.2 Project Decision — Implementation Evidence

**Roadmap phase:** G7.2  
**Architecture decision:** `ADR-0007-decision-authority-lifecycle.md`  
**Verified head:** `ca665f1fe2ff162efb9d6eaba398c204459bd8e9`  
**CI run:** GitHub Actions `36688876037`

## Implemented boundary

Decision is now a durable Project Control fact with:

- independent DecisionId and optimistic version;
- HUMAN / CONTROL_PLANE authority only;
- mandatory source provenance;
- immutable decision meaning;
- ACTIVE → SUPERSEDED / REVOKED lifecycle;
- explicit supersession lineage;
- attributable revocation;
- MemoryStore + SQLite persistence;
- mutation replay/idempotency and domain events;
- active-decision queries by Project.

A model/runtime/worker has no Decision authority type.

## Authority semantics

Human direction cannot be silently overturned by the Control Plane:

- HUMAN Decision → supersede/revoke requires HUMAN;
- CONTROL_PLANE Decision → HUMAN may supersede/revoke;
- CONTROL_PLANE may replace its own derived Decision only with authoritative
  control/evidence provenance.

CONTROL_PLANE provenance accepts Project State, Evidence, Verification,
PolicyDecision or another Decision. External/model recommendation alone is not
sufficient.

## Immutable meaning and history

Decision title/rationale/alternatives/decider/source provenance are not updated
through a generic mutation API.

A changed choice creates a new DecisionId.

Supersession atomically records:

```text
old.status = SUPERSEDED
old.supersededByDecisionId = new.id
new.status = ACTIVE
new.supersedesDecisionId = old.id
```

The historical Decision remains readable with its original rationale.

Revocation records authority, timestamp and reason, and is terminal.

## Persistence / restart

SQLite persists Decision identity/version/project/status plus the full body.

Restart proof shows:

- old Decision remains SUPERSEDED;
- replacement remains ACTIVE;
- both sides of supersession lineage survive;
- provenance survives;
- active Project query returns only the current Decision.

## CI verification

```text
Node 22.23.3
tests   533
pass    533
fail    0
skipped 0
```

Package-floor job:

```text
Node 20.20.2
tests   533
pass    356
fail    0
skipped 177
```

## Exit-criteria assessment

ADR-0007 exit criteria are satisfied:

1. runtime/model authority cannot create Decision — covered.
2. provenance required — covered.
3. CONTROL_PLANE cannot supersede/revoke HUMAN Decision — covered.
4. HUMAN may supersede HUMAN/CONTROL_PLANE — covered.
5. CONTROL_PLANE may replace derived control Decision with authoritative provenance — covered.
6. supersession creates new id and preserves old meaning — covered.
7. old↔new lineage is written atomically — covered by shared transaction path.
8. revocation attributable/reasoned/terminal — covered.
9. no generic Decision meaning-update API — covered.
10. stale lifecycle mutation is rejected — covered.
11. replay identity does not duplicate lifecycle events — covered.
12. active query excludes terminal Decisions — covered.
13. both persistence backends use shared semantics — covered.
14. restart preserves lineage/status/provenance — covered.
15. full Node 22 CI is green with zero skips — 533/533.

## Boundary after G7.2

The next candidate is Project-control Memory.

Decision may become a source for Memory, but Memory must remain lower in the
truth hierarchy and cannot silently reinterpret/supersede Decision or Current
Reality.
