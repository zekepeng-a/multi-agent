# Project Control OS — Persistence Boundary v0.1

**Status:** PROTOTYPE VALIDATED (v0.1 spike — see §18). **Not production ready.**
**Purpose:** define what must be durable, what is authoritative, what is append-oriented, and what may remain externalized before choosing a storage technology.

---

## 1. Decision

The persistence boundary has four categories:
1. Authoritative State — mutable, queryable, versioned current state.
2. Append-Only History — immutable facts, verification records, and receipts.
3. External Artifacts — large payloads referenced by metadata and hashes.
4. Ephemeral Runtime State — process/session details that may disappear without changing accepted project state.

Storage technology remains OPEN for production. The v0.1 prototype validates SQLite through Node's built-in `node:sqlite` module (§18).

## 2. Authoritative State

Durable current state is required for Project, Roadmap, Milestone, Goal, Task, AcceptanceContract, Run, Effect, Decision, and Memory metadata.

Authoritative records MUST have stable identity, current lifecycle state, version, timestamps, related-object references, and enough information to reconstruct current project state without replaying an agent conversation.

## 3. Append-Only History

DomainEvent, Verification, Evidence metadata, Effect receipts, reconciliation records, and material acceptance decisions should be append-oriented.

Historical records must not be silently rewritten to repair the present. If reality changes, create a new fact/event/verification and update the authoritative projection.

## 4. External Artifacts

Large logs, screenshots, browser traces, patches, build outputs, generated files, and reports should remain outside core state.

Core state keeps artifact_ref, sha256, size, media_type, revision, and created_at. A local filesystem/project directory is sufficient for the first prototype; remote object storage is not required.

## 5. Ephemeral Runtime State

Live subprocess handles, open sockets, temporary buffers, streaming tokens, and in-memory locks may remain runtime-owned.

Losing ephemeral runtime state may lose an Attempt, but must not silently destroy or rewrite authoritative Project State.

## 6. Run / Attempt Boundary

A Task may have multiple Runs, and a Run may have multiple Attempts. An Attempt may become LOST without deleting the Run.

This matches Agent Harness, where Task/Goal owns accepted state while Run owns execution evidence, recovery, dependencies, gates, and state synchronization. citeturn0search5turn0search6

## 7. Acceptance Boundary

The durable acceptance chain is:

AcceptanceContract → Evidence → Verification → Acceptance decision → Task/Goal state

An agent's final message is not a persistence primitive.

Agent Harness independently uses candidate-versus-accepted evidence and authoritative Task/Goal completion state. citeturn0search6turn0search7

## 8. Memory Boundary

Memory is durable but is not authoritative project state.

Truth hierarchy:
Current Reality > Verified Evidence > Accepted State > Decision/Constraint > Promoted Memory

Memory entries require source references. Memory may help construct a Context Capsule but cannot directly change Task, Goal, or Project state.

Local-first Agent OS implementations likewise separate project-scoped memory from execution workspaces and avoid treating chat history as the sole durable context. citeturn0search1turn0search4

## 9. Concurrency

Mutable authoritative objects use optimistic concurrency.

A mutation carries target_id, expected_version, command_id, and idempotency_key.

If expected_version does not match current state, the result is CONFLICT. The controller re-reads current state before deciding what happens next.

Aggregate-local ordering is sufficient for the first architecture; a global total event order is not required.

## 10. Idempotency and Effects

Retryable commands require stable command identity. External side effects additionally require an idempotency key.

An external Effect may become UNKNOWN after a timeout or ambiguous failure. UNKNOWN remains durable until reconciliation determines the outcome.

## 11. Recovery Requirements

Persistence must survive at least:
- runtime crash: Attempt becomes LOST/FAILED while Run remains inspectable;
- process restart: authoritative Project/Task/Run state remains available;
- duplicate command: idempotency prevents duplicate logical mutation;
- stale writer: expected-version conflict prevents silent overwrite;
- external timeout: Effect becomes UNKNOWN rather than guessed success/failure;
- missing artifact: dependent Evidence becomes invalid/stale rather than silently accepted.

## 12. What Persistence Must Not Become

The persistence layer must not become an agent runtime, workflow engine, prompt store pretending to be state, default vector database, giant chat transcript, second source of truth for runtime internals, or autonomous authority that bypasses project control.

Persistence stores control facts; it does not perform agent reasoning.

## 13. Minimal First Prototype

Persist only: Project, Goal, Task, Acceptance, Run, Attempt, Evidence, Verification, Command, and DomainEvent, plus artifact references.

Required operations:
- create_project
- create_task
- create_acceptance
- start_run
- start_attempt
- record_evidence
- record_verification
- accept_task
- fail_attempt
- reconcile_run
- get_task_state
- get_run_history

The prototype must demonstrate:
1. two Runs for one Task;
2. lost Attempt without losing Run;
3. candidate Evidence cannot directly accept a Task;
4. verification can cause acceptance;
5. stale command receives a conflict;
6. duplicate command is idempotent;
7. restart preserves authoritative state;
8. event history remains intact after state changes.

## 14. Technology Selection Criteria

The architecture does not currently choose SQLite, PostgreSQL, event sourcing, or another database for production.

**Prototype decision (v0.1).** SQLite through Node's built-in `node:sqlite` module: synchronous (it matches the store's synchronous contract), transactional, zero dependencies, no native build step, WAL available. It requires Node ≥ 22.5 — `package.json` still declares `engines.node: ">=20"`, which is now inaccurate for the persistent store; changing that is an explicit decision and was deliberately not done as a side effect of this spike. `better-sqlite3` was the alternative and was rejected for the prototype: it keeps `>=20` but adds a native dependency, an install step and an ABI/prebuild burden for the same synchronous API surface.

The eventual store must support transactions, optimistic concurrency, durable identifiers, indexed queries, append-oriented records, idempotency constraints, crash recovery, backup/export, and migrations.

The first prototype should optimize for correctness and inspectability rather than scale.

## 15. External Validation

0xenzyme/agent-harness supports authoritative Task/Goal state, Run-owned evidence/recovery, candidate-versus-accepted evidence, durable gates, and state sync. citeturn0search5turn0search6

earthwalker17/agent-os uses local filesystem + SQLite, project-scoped memory, execution workspaces, durable run artifacts, verification, recovery, and human approval gates. citeturn0search1turn0search2

projectalphatech/agent-os treats verification gates, delegation contracts, and persistent memory as patterns above an existing runtime rather than as a new runtime. citeturn0search0

These are evidence for the boundary, not dependencies.

## 16. Open Questions

P-01 Should authoritative state and append-only history use one physical database or separate stores?
→ *v0.1 prototype: one SQLite database, separate tables.*
P-02 Should DomainEvent drive projections, or should the first prototype use direct transactional state updates plus an event log?
→ *v0.1 prototype: direct transactional state updates plus an append-only event log. Not event sourcing: the tables are authority, the log is history.*
P-03 Which artifacts need content-addressed storage from day one?
P-04 Which Run fields are authoritative versus derived projections?
P-05 How should schema migrations be versioned?
P-06 Which failure/recovery records must survive indefinitely?
P-07 When does a local prototype need a transaction boundary across state + event?

## 17. Status

**PROTOTYPE VALIDATED — not frozen, not production ready.**

The boundary above is now exercised by an executable prototype (§18). The storage technology is still open for production, and nothing here should be read as production readiness.

Next architectural problem after the persistence spike: the first **Goal/Milestone** lifecycle, or human approval as a first-class durable control fact.

---

## 18. Prototype validation — Persistence Spike v0.1

One question: **do the Project Control semantics that were already verified survive a process restart?**

All of the following are covered by `tests/integration/persistence.test.mjs`:

| Decision / property | v0.1 prototype |
|---|---|
| Storage | SQLite, one database file, through the built-in `node:sqlite` module — no dependency, no native build |
| Write model | **Direct transactional state updates + an append-only domain event log.** Not event sourcing |
| Transaction boundary | one transaction per authoritative mutation: the state row, its domain event and its command/idempotency row commit or fail **together** (`BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`) |
| Optimistic concurrency | the record's own `version`, checked by the rules **and** enforced by SQL compare-and-set (`UPDATE … WHERE key = ? AND version = ?`), so two writers cannot silently overwrite each other |
| Command idempotency | durable `commands(command_id, operation, result_id)`: a replayed command returns the recorded result and performs no second mutation — including after a restart |
| Contract revision pinning | `acceptance_revisions` is keyed by `(id, version)`, so both revisions coexist; a Task keeps the revision it was created with; content fingerprints live in a separate table, so contract content edited in place fails closed on read |
| Evidence lineage | Run / Attempt / Evidence / Verification rows keep the identity the rules re-prove on every use, and the lineage is re-provable from durable rows alone |
| Reconciliation history | a blocked Run and its LOST Attempt remain as history after recovery, across restarts |
| Restart proof | a test writes state in **process A**, lets it exit, and reads it back in **process B** — not a second store object inside one process |

Explicitly **not** proven by this spike:

- distributed deployment (one writer per database file is the working assumption)
- high availability, failover, or replication
- multi-host locking — WAL plus `busy_timeout` only orders writers on one host
- production backup, restore, or point-in-time recovery strategy
- a migration system: the schema is `CREATE TABLE IF NOT EXISTS`, so a schema change is currently a manual step
- normalization or query performance — state rows carry a JSON `body` alongside the identity/version/reference columns the control plane queries
- a Project aggregate: v0.1 has no Project entity to persist, only `project_id` references on Task and Run
