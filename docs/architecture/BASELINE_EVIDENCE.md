# Project Control OS — Baseline Evidence

**Baseline phase:** G1 Baseline hardening  
**Evidence commit:** `b8a91e3e038e2a28ffc28d24abf50bcf424e2a9a`  
**CI run:** GitHub Actions run `36675595315`  
**Purpose:** record the reproducible baseline that G2 must inherit.

## 1. CI baseline

The pull-request CI now tests two distinct runtime promises.

### Node 22 — full Project Control baseline

Environment observed in CI:

```text
Node v22.23.3
tests   435
pass    435
fail    0
skipped 0
```

Before the test suite runs, CI explicitly asserts that `project-control/sqlite-store.mjs` can load the built-in `node:sqlite` driver. Therefore the zero-skip result is not allowed to hide an unavailable SQLite backend.

This is the authoritative automated baseline for the current Project Control prototype.

### Node 20 — advertised package floor

Environment observed in CI:

```text
Node v20.20.2
tests   435
pass    295
fail    0
skipped 140
```

The skipped tests are capability-gated SQLite-backed tests because built-in `node:sqlite` is unavailable at this package floor.

Meaning:

- top-level `package.json` may continue to advertise `node >=20` for the legacy/runtime + non-SQLite surface;
- **durable SQLite Project Control is not part of the Node 20 capability promise**;
- full Project Control persistence baseline requires a runtime exposing `node:sqlite`.

## 2. SQLite runtime boundary

`project-control/sqlite-store.mjs` currently declares:

```text
built-in node:sqlite required
Node >=22.5
unflagged on Node 22.13+ / 23.4+ / 24
```

CI intentionally uses the current Node 22 line and verifies availability before tests.

Do not infer from `engines.node >=20` that SqliteStore is available on Node 20.

## 3. Backend parity proof

`tests/unit/project-control-store.contract.test.mjs` registers the same behavioral contract against:

- `MemoryStore`
- `SqliteStore`

On the Node 22 full baseline, no tests are skipped, so both backends participate in the shared contract suite.

This proves parity only for the behavior covered by that suite; it is not a claim that the physical persistence implementations are identical.

## 4. Persistence/restart proof

The integration suite includes real SQLite close/reopen and child-process restart checks for, among other implemented behavior:

- Task + pinned Acceptance revision persistence;
- coexistence of Acceptance revisions;
- Run → Attempt → Evidence → Verification lineage;
- accepted state surviving restart;
- append-oriented event history surviving restart;
- optimistic-concurrency conflicts;
- command-id replay across restart;
- transaction rollback of state/event/idempotency facts;
- Approval durability and stale/capability revalidation.

The current CI result includes these tests in the 435/435 full baseline.

## 5. Governance did not silently change production semantics

Comparison:

```text
base: e7a0a7d07356980d5ba9c49be5ebfa06a1bebad8
head: b8a91e3e038e2a28ffc28d24abf50bcf424e2a9a
```

contains only:

- governance/documentation files; and
- `.github/workflows/ci.yml`.

No `project-control/*.mjs`, legacy runtime production source, or test source changed in the governance/G1 CI-hardening interval.

Therefore the 435/435 Node 22 result re-verifies the same production implementation that existed at `e7a0a7d`, under the new governance head.

## 6. Schema/migration boundary

The current SQLite backend is a prototype persistence boundary, not a production migration framework.

Current behavior:

- schema is created with `CREATE TABLE IF NOT EXISTS`;
- the backend explicitly refuses older Evidence/Verification shapes that predate parent Acceptance and lack `target_id`;
- that refusal happens at database open time;
- v0.1 provides no migration path for that incompatible older shape;
- later additive objects such as the approvals table can be created when absent.

This means:

> current schema compatibility is **fail-loudly for a known incompatible historical shape**, not “all historical databases are automatically migratable”.

Future schema changes must not assume a migration framework already exists.

## 7. Package/repository identity decision for this baseline

No package rename or repository split is performed in G1.

Reason:

- `package.json` truthfully describes the legacy V0.5 package surface;
- the repository now also contains the Project Control prototype;
- renaming/splitting packaging changes product/release scope rather than fixing a semantic bug.

For current development, governance files define repository-level product direction while package identity remains historical/legacy-runtime-oriented.

A future rename, package split, or publication strategy is a separate human/product decision if it materially changes scope. It does not block G2 architecture work.

## 8. G1 exit assessment

G1 exit requirements are satisfied for the current prototype baseline:

- clean automated full baseline exists: **435/435, 0 skipped on Node 22.23.3**;
- package-floor behavior is separately observed on Node 20;
- SQLite availability is asserted rather than silently skipped in the full job;
- MemoryStore/SQLite shared contract is exercised in the full baseline;
- restart/persistence behavior is covered by the integration suite;
- governance-only history did not mutate production source;
- Node/SQLite capability boundary is explicit;
- schema/migration assumptions are explicit;
- package identity is consciously deferred rather than accidentally ignored.

This evidence authorizes a Roadmap transition from G1 to G2. It does **not** authorize implementation of Command before G2's D-class architecture gate is resolved.
