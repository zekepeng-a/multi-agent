# Architecture Decision Records

This directory stores durable decisions that resolve a genuine architectural gap or settle a contested boundary in Project Control OS.

## When an ADR is required

Create an ADR when work is classified **D — Architectural Gap**, meaning a required concept lacks a settled authority boundary, state machine, persistence meaning, recovery rule, concurrency rule, or external-effect semantics.

An ADR may also be appropriate for a significant C-class conflict when the resolution changes or clarifies canonical architecture.

Do **not** create ADRs for:

- routine implementation bugs;
- ordinary refactors that do not change semantics;
- test-only changes;
- local naming/style choices;
- ideas that have not been accepted.

## Naming

Use:

```text
ADR-0001-short-kebab-title.md
ADR-0002-next-decision.md
```

Numbers are repository-local and monotonically increasing.

## Status

Each ADR starts with one of:

- `PROPOSED`
- `ACCEPTED`
- `SUPERSEDED`
- `REJECTED`

If superseded, link the replacement ADR. Do not rewrite old accepted decisions to make history look cleaner.

## Required structure

```markdown
# ADR-XXXX — Title

Status: PROPOSED | ACCEPTED | SUPERSEDED | REJECTED
Date: YYYY-MM-DD
Roadmap phase: G?
Related invariants: I-..

## Context

What concrete problem/gap forced this decision?

## Decision

What is being decided, including authority and lifecycle boundaries?

## Alternatives considered

What credible alternatives were examined?

## External evidence

Which real implementations/specs/docs informed the decision, and what limits do they have?

## Consequences

What becomes easier/harder? What tradeoffs or new obligations appear?

## Implementation boundary

What is now B-class implementable, and what remains outside scope?

## Verification / exit criteria

What evidence will show the decision was implemented correctly?
```

## Authority rule

An ADR does not override `PROJECT_BLUEPRINT.md`.

If an ADR would change project identity, five-layer authority, frozen invariants, or human/high-risk authority, the issue is **E — Direction Change** and requires human decision before acceptance.

Accepted ADRs may refine `docs/architecture/PROJECT_CONTROL_OS_ARCHITECTURE.md`; they must not claim implementation until code/tests/Git prove it.
