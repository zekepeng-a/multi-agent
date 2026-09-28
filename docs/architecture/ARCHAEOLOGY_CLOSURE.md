# Project Control OS — Architecture Archaeology Closure

## Status

**CLOSED**

The architecture archaeology phase is complete as of 2026-09-28.

## What was investigated

The research phase traced real implementations and explicit protocols across:

- DSH Workflow / Agent Team
- Agent Harness
- Agent Execution Harness
- Earthwalker Agent OS
- Kubernetes controller-runtime
- AgentLedger
- Temporal
- Archify
- AgentProvenance
- Hyperkernel
- Kando
- Stratum
- Maka
- Cloudflare Agents
- x-harness

The research focused on boundaries rather than project-name similarity.

## Final targeted questions

### 1. Acceptance Gate Semantics

Acceptance is contract-bound and evidence-bound.

A verification result is not sufficient by itself. Acceptance must identify the subject, contract revision, evidence scope, verification, freshness/validity, and acceptance decision.

**New invariant: I-27**

### 2. Revision / Version Lineage

Evidence that can influence acceptance must be attributable to a concrete contract/source/artifact revision and execution lineage.

Revision counters solve concurrency/version safety; hashes/content identities solve artifact/source identity. They are complementary.

**New invariant: I-28**

### 3. Human Approval Boundary

Authorization to execute an action is distinct from acceptance of its result.

Human approval is a durable, scoped control decision. It does not manufacture missing evidence and must not directly bypass the Project Control authority model.

**New invariants: I-29, I-30, I-31**

## Final architecture conclusion

No new top-level architectural layer was required by the final archaeology pass.

The current model remains:

1. **PROJECT CONTROL**
2. **CONTROL & RECOVERY**
3. **EXECUTION**
4. **REALITY**
5. **EVIDENCE & HISTORY**

The research also established two boundaries that should remain frozen:

- **Semantic authority is independent of physical persistence.**
- **Controller authority is independent of orchestration style.**

Therefore the architecture does not yet prescribe SQLite, PostgreSQL, event sourcing, a specific queue, DSH Workflow, DSH Team, Temporal, or another execution runtime.

## Frozen research artifacts

- `docs/architecture/PROJECT_CONTROL_OS_ARCHITECTURE.md`
- `docs/architecture/PERSISTENCE_BOUNDARY.md`
- `docs/architecture/SOURCE_TRACEABILITY.md`
- `docs/architecture/FINAL_ARCHAEOLOGY.md`

The first three define or support architecture; the source traceability file remains research evidence, not architecture authority. The final archaeology file records the closing synthesis and the three final boundary questions.

## What happens next

The project now leaves **research/archaeology mode** and enters **architecture convergence / implementation planning**.

Future GitHub research should be targeted at concrete implementation questions only. A new broad archaeology pass should happen only if implementation exposes a genuinely unresolved:

- authority boundary;
- invariant;
- failure mode;
- recovery model; or
- materially different persistence requirement.

Until then, the archaeology phase is closed.
