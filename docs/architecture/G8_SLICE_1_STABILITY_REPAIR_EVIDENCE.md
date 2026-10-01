# G8 Slice 1 stability repair evidence

**Status:** A-class implementation/proof repair submitted for independent review.
This document does not declare A1/A2 CLOSED, change Slice 1's reviewed
`PASS WITH OPEN A` status, or authorize Slice 2 or G8 completion.
**Date:** 2026-10-01.
**Branch:** `project-control/controller-v0.1`.
**Repair baseline:** `c5f65369141a5150d240bc8cb3bab5cfbd667706`.
**Code/test HEAD:** `9b2b586416652c58036e2c78b101dbd5394e7a27`.

## Original findings and minimal repairs

### A1: SQLite initialization lock policy applied too late

`SqliteStore` previously ran `journal_mode = WAL` before configuring
`busy_timeout`. An independently held lock could therefore fail initialization
in the approximately 20 ms window despite a configured 5000 ms timeout.

The constructor now normalizes the timeout before opening the database and sets
`busy_timeout` immediately after opening, before WAL, foreign keys, schema guard
and schema creation. The accepted value is an integer or decimal integer string
in SQLite's signed 32-bit nonnegative range; arbitrary PRAGMA text, fractional,
nonfinite and out-of-range inputs are rejected before opening. The default
remains 5000 ms. Foreign keys, schema checks and schema creation are unchanged.
No retry loop, swallowed BUSY, transaction ownership change or concurrent-open
guarantee is added. Schema and IO failures remain failures.

### A2: Competition fixture had an unbounded child barrier and incomplete cleanup

The old parent polled ready files while child completion promises could reject
unobserved. A sibling could wait forever for `.go`, which had no child deadline;
cleanup killed processes without awaiting their close.

The three competitions now share a small test-only helper. Both independent
writers are spawned before readiness polling. Completion promises resolve to
observed state; startup errors/early exits, readiness and the overall deadline
are checked together. `.go` is written only when both writers are ready and
neither has exited. Each child has its own barrier deadline. Every exit path
kills unfinished children and awaits their close with a separate bounded cleanup
deadline. Errors retain original stderr, exit information and writer outcomes;
cleanup failure remains an explicit failure. This is fixture management, not a
new runtime/process supervision subsystem.

## Concrete proof

| Proof | Code/test |
|---|---|
| Real lock released within configured wait permits initialization | `tests/integration/sqlite-initialization.test.mjs`: parent SQLite connection holds `BEGIN EXCLUSIVE`; a distinct Node process opens the same file; lock released 300 ms after child readiness, timeout 2000 ms. WAL verified afterwards. |
| Over-timeout lock produces bounded explicit failure | Same test: timeout 300 ms, lock held through constructor failure, SQLite base BUSY code 5 and locked/busy message, measured duration bounded below and above; unlocked reopen succeeds. |
| Default wait and safe inputs; original schema/IO failure behavior | Same suite: default survives the old immediate-failure window; invalid values cannot create a DB; valid numeric strings/zero work; incompatible schema and directory path fail. |
| Child has its own deadline without parent `.go` | `tests/integration/capsule-competition-stability.test.mjs`: all three modes exit with barrier timeout, never create `.go`. |
| Early initializer failure aborts and cleans sibling | Same suite: writer A opens a directory, preserves original stderr/exit 1, does not wait the 8-second overall deadline; both children closed and PID probes report ESRCH. |
| Overall deadline cleanup | Same suite: 1 ms parent deadline, both unfinished initializers killed/awaited, no `.go`, both PID probes report ESRCH. |
| Reservation competition retains semantics | `tests/integration/context-capsule-restart.test.mjs`: two distinct process IDs, one reservation winner, one external call, one reservation event and final RECEIVED. |
| Immutable put/insert competitions retain semantics | Same suite: separate writers released through a shared barrier; only one wins, loser explicitly conflicts, winner payload/hash remains stored and differs from loser. |

On Windows Node 22.23.3, three repeated contention/cleanup runs all passed
12/12. Release-within-timeout constructors took 530/537/534 ms; held-lock
failures took 811/806/809 ms with `ERR_SQLITE_ERROR`, errcode 5. These measure
whole constructor time, not an exact per-statement or whole-open timeout claim.
They prove waiting beyond the old immediate window and bounded explicit failure.

Ten additional runs of the three independent SQLite competitions all passed
3/3: 30 real two-process competitions, 60 competing writer processes, no
reservation duplication, overwrite, unopened-barrier hang or live child after
the tested cleanup paths. Internal writers remain concurrent; no test runner
serialization is used as the competition proof.

## Regression and CI

- Affected suite: initialization, cleanup, Capsule restart/competition,
  persistence, Slice 1 dogfood, Capsule unit and Store contract: **177/177**,
  zero failures/skips.
- Full Node 22.23.3 unit/integration regression: **720 passed**, zero failures,
  zero skips, default runner concurrency.
- Full Node 20.20.2 compatibility: **438 passed**, zero failures,
  **282 expected SQLite-capability skips**; includes the twelve new
  SQLite-only stability tests.
- Slice 1's bounded trusted composition still passes. Its original Evidence
  and failed-review history are preserved; this repair does not claim broader
  production authorization, sandboxing or full G8 proof.
- Code/test HEAD remote CI: [run 36847926938](https://github.com/zekepeng-a/multi-agent/actions/runs/36847926938),
  **success**. Node 22 job 110322435316: SQLite capability check succeeded,
  **720 passed / 0 failed / 0 skipped**. Node 20 job 110322435604:
  **438 passed / 0 failed / 282 expected SQLite capability skips**.
  This is the observed code/test commit run. The subsequent Evidence-only
  commit's CI is separately reported after it completes; it is not assumed
  successful from this earlier run.

## Scope and review gate

No ADR, Blueprint, ROADMAP, canonical architecture, G7/G8 status, Effect,
Runtime or Capsule dispatch/replay/reservation semantics changed. No lease,
distributed lock, new authority or SQLite persistence architecture is added.
No new C/D/E problem was found during this repair. Independent review must
decide whether these two A findings are closed; Slice 2 remains unauthorized.


## Independent review closure — recorded 2026-10-01

**Current reviewed disposition: CLOSED.** A1 CLOSED; A2 CLOSED; independent stability review passed. Real contention proof and bounded fail-fast child/parent cleanup accepted; reservation and immutable writer race semantics preserved. Finite repeated runs do not imply an absolute race-free guarantee. No new C/D/E.

Human authorized this governance review-record convergence at baseline `7dad1894f802bdd6076a9320731c918a7a765e0a`. Original submission status, historical wording, test counts and failure/repair evidence above are retained. This section supplies current disposition. G8 is FINAL CONVERGENCE REVIEW READY, not COMPLETE; final exit review and separate governance completion remain necessary.
