// Durable Human Approval v0.1.
//
// An Approval is a PERMISSION fact, written and read as a first-class Control
// Fact: a named subject decided, within a stated scope, that ONE specific action
// on ONE specific target version may proceed. The whole file exists to keep that
// fact separate from its neighbours, because collapsing any of these pairs is
// what makes approval systems dangerous:
//
//   Approval ≠ Acceptance   permission vs correctness
//   Approval ≠ Policy       "may this proceed?" vs "is approval required at all?"
//   Approval ≠ Command      a gate a command passes vs a command that ran
//   Approval ≠ its target   it authorizes one version, not an object forever
//
// Every case runs against BOTH backends, because the rules live in the shared
// store semantics — the backends only store.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { Collection, effectiveApprovalStatus } from "../../project-control/store.mjs";
import { MemoryStore } from "../../project-control/memory-store.mjs";
import {
  SqliteStore,
  isSqliteAvailable,
  SQLITE_REQUIREMENT,
} from "../../project-control/sqlite-store.mjs";
import { Controller } from "../../project-control/controller.mjs";
import { FakeRuntime } from "../../project-control/fake-runtime.mjs";
import { FakeVerifier } from "../../project-control/fake-verifier.mjs";
import {
  ApprovalDecision,
  ApprovalError,
  ApprovalFailureReason,
  ApprovalStatus,
  ApprovalTargetType,
  COMMAND_APPROVAL_UNAVAILABLE,
  ConflictError,
  GoalStatus,
  InvariantError,
  MilestoneStatus,
  ProjectStatus,
  RiskLevel,
  TaskStatus,
  VerificationVerdict,
  createAcceptance,
  createApproval,
  createGoal,
  createMilestone,
  createProject,
  createTask,
} from "../../project-control/domain.mjs";

const BACKENDS = [
  {
    name: "MemoryStore",
    skip: false,
    make() {
      return new MemoryStore();
    },
  },
  {
    name: "SqliteStore",
    skip: isSqliteAvailable() ? false : `node:sqlite is unavailable: ${SQLITE_REQUIREMENT}`,
    make(t) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-approval-"));
      const store = new SqliteStore(path.join(dir, "project-control.db"));
      t.after(() => {
        try {
          store.close();
        } catch {
          // already closed
        }
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      });
      return store;
    },
  },
];

// ── shared fixtures (backend-agnostic) ───────────────────────────────────────

/** Project → Milestone → Goal → Task, so every aggregate target type is real. */
function seedWorld(store) {
  store.seedProject(createProject({ id: "project-1", name: "Approval world" }));
  store.seedAcceptance(createAcceptance({
    id: "acceptance-1",
    targetId: "task-1",
    criteria: [{ id: "build", type: "BUILD", required: true }],
  }));
  store.seedMilestone(createMilestone({ id: "ms-1", projectId: "project-1", name: "M1" }));
  store.seedGoal(createGoal({
    id: "goal-1",
    projectId: "project-1",
    milestoneId: "ms-1",
    title: "G1",
    status: GoalStatus.IN_PROGRESS,
  }));
  store.seedTask(createTask({
    id: "task-1",
    goalId: "goal-1",
    title: "T1",
    acceptanceId: "acceptance-1",
    acceptanceVersion: 1,
  }));
}

/** The deploy request used throughout: one action, one target, one scope. */
function deployRequest(over = {}) {
  return {
    id: "approval-1",
    targetType: ApprovalTargetType.TASK,
    targetId: "task-1",
    action: "deploy",
    capability: "deploy.production",
    scope: "production",
    riskLevel: RiskLevel.HIGH,
    requestedBy: "requester-1",
    ...over,
  };
}

/** What command C1 wants to do: exactly the approved action, on v1. */
function deployIntent(over = {}) {
  return {
    approvalId: "approval-1",
    targetType: ApprovalTargetType.TASK,
    targetId: "task-1",
    targetVersion: 1,
    action: "deploy",
    capability: "deploy.production",
    scope: "production",
    ...over,
  };
}

function approvedDeploy(store, { commandId = "cmd-decide-1", decidedBy = "alice", over = {} } = {}) {
  store.requestApproval(deployRequest(over), { commandId: "cmd-request-1" });
  return store.decideApproval(
    "approval-1",
    1,
    { decision: ApprovalDecision.APPROVE, decidedBy, reason: "rollout window agreed" },
    { commandId },
  );
}

function assertRefused(fn, reason, messagePattern = null) {
  assert.throws(fn, (error) => {
    assert.ok(
      error instanceof ApprovalError,
      `expected an ApprovalError, got ${error?.name}: ${error?.message}`,
    );
    assert.equal(error.approvalReason, reason);
    assert.equal(error.code, "APPROVAL_NOT_USABLE");
    assert.ok(error instanceof InvariantError, "an unusable approval is still a rule violation");
    if (messagePattern) assert.match(error.message, messagePattern);
    return true;
  });
}

function eventTypes(store) {
  return store.getEvents().map((event) => event.type);
}

function countEvents(store, type) {
  return eventTypes(store).filter((each) => each === type).length;
}

function makeController(store, { verdict = VerificationVerdict.PASS } = {}) {
  let n = 0;
  const runtime = new FakeRuntime({ mode: "success" });
  const verifier = new FakeVerifier({ verdict });
  const controller = new Controller({
    store,
    runtime,
    verifier,
    idFactory: (prefix) => `${prefix}-${++n}`,
  });
  return { controller, runtime, verifier };
}

const withoutTimestamps = ({ createdAt, updatedAt, ...rest }) => rest;

for (const backend of BACKENDS) {
  const { name, skip } = backend;
  const label = (title) => `${name}: ${title}`;

  // ── A–E: the lifecycle, and it is durable ──────────────────────────────────

  test(label("A a request is PENDING and pins the state it was actually made against"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);

    const approval = store.requestApproval(deployRequest(), { commandId: "cmd-request-1" });

    assert.equal(approval.version, 1);
    assert.equal(approval.decision.status, ApprovalStatus.PENDING);
    assert.equal(approval.decision.decidedBy, null);
    assert.equal(approval.decision.decidedAt, null);
    assert.equal(approval.revocation, null);
    assert.equal(approval.requestedBy, "requester-1");
    // the version is read from the target, not accepted from the caller
    assert.equal(approval.request.targetVersion, 1);
    assert.deepEqual(approval.request, {
      targetType: ApprovalTargetType.TASK,
      targetId: "task-1",
      targetVersion: 1,
      action: "deploy",
      capability: "deploy.production",
      scope: "production",
      riskLevel: RiskLevel.HIGH,
    });

    const event = store.getEvents().at(-1);
    assert.equal(event.type, "approval.requested");
    assert.equal(event.aggregateType, "approval");
    assert.equal(event.aggregateId, "approval-1");
    assert.equal(event.aggregateVersion, 1);
    assert.equal(event.payload.action, "deploy");
    assert.equal(event.payload.scope, "production");
    assert.equal(event.payload.requestedBy, "requester-1");

    // a caller may not claim a version the target is not at
    assert.throws(
      () => store.requestApproval(deployRequest({ id: "approval-x", targetVersion: 7 })),
      /is v1, not v7/,
    );
    // and an approval about nothing is not a fact
    assert.throws(
      () => store.requestApproval(deployRequest({ id: "approval-y", targetId: "task-does-not-exist" })),
      /approval target not found: TASK task-does-not-exist/,
    );
    assert.equal(store.getRecord(Collection.APPROVAL, "approval-y"), null);
    assert.equal(countEvents(store, "approval.requested"), 1, "a refused request writes nothing");
  });

  test(label("B PENDING → APPROVED is attributable and recorded once"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    const approved = approvedDeploy(store);

    assert.equal(approved.decision.status, ApprovalStatus.APPROVED);
    assert.equal(approved.decision.decidedBy, "alice");
    assert.match(approved.decision.decidedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(approved.decision.reason, "rollout window agreed");
    assert.equal(approved.version, 2);

    const event = store.getEvents().at(-1);
    assert.equal(event.type, "approval.approved");
    assert.equal(event.aggregateType, "approval");
    assert.equal(event.aggregateId, "approval-1");
    assert.equal(event.aggregateVersion, 2);
    assert.equal(event.payload.decidedBy, "alice");
    assert.equal(event.commandId, "cmd-decide-1");
    assert.deepEqual(store.getCommand("cmd-decide-1"), { operation: "decideApproval", resultId: "approval-1" });

    // and it authorizes the action it names, on the version it names
    assert.equal(store.assertApprovalUsable(deployIntent()).id, "approval-1");
  });

  test(label("C PENDING → REJECTED ends the request without a permission"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    store.requestApproval(deployRequest(), { commandId: "cmd-request-1" });

    const rejected = store.decideApproval("approval-1", 1, {
      decision: ApprovalDecision.REJECT,
      decidedBy: "bob",
      reason: "no rollout window",
    }, { commandId: "cmd-decide-1" });

    assert.equal(rejected.decision.status, ApprovalStatus.REJECTED);
    assert.equal(rejected.decision.decidedBy, "bob");
    assert.equal(eventTypes(store).at(-1), "approval.rejected");
    assertRefused(() => store.assertApprovalUsable(deployIntent()), ApprovalFailureReason.REJECTED, /is REJECTED/);
  });

  test(label("D PENDING → EXPIRED is an observation about the clock, not a decision"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    const expiresAt = new Date(Date.now() - 60_000).toISOString();
    store.requestApproval(deployRequest({ expiresAt }), { commandId: "cmd-request-1" });

    // the request is stored as PENDING, but it is already unusable
    assert.equal(store.getApproval("approval-1").decision.status, ApprovalStatus.PENDING);
    assert.equal(effectiveApprovalStatus(store.getApproval("approval-1")), ApprovalStatus.EXPIRED);
    assertRefused(() => store.assertApprovalUsable(deployIntent()), ApprovalFailureReason.EXPIRED);
    // …and it cannot be approved either: the deadline closed it
    assert.throws(
      () => store.decideApproval("approval-1", 1, { decision: ApprovalDecision.APPROVE, decidedBy: "alice" }),
      /is EXPIRED \(deadline .*\) and may not become APPROVED/,
    );

    // recording the expiry is an explicit act with its own event
    const expired = store.expireApproval("approval-1", 1, { commandId: "cmd-expire-1" });
    assert.equal(expired.decision.status, ApprovalStatus.EXPIRED);
    assert.equal(expired.version, 2);
    const event = store.getEvents().at(-1);
    assert.equal(event.type, "approval.expired");
    assert.equal(event.aggregateVersion, 2);
    assert.equal(event.payload.from, ApprovalStatus.PENDING);
    assert.equal(event.payload.expiresAt, expiresAt);

    // an approval with no deadline can never expire…
    store.requestApproval(deployRequest({ id: "approval-2" }));
    assert.throws(() => store.expireApproval("approval-2", 1), /has no deadline/);
    // …and a deadline that has not passed cannot be recorded as expired
    store.requestApproval(deployRequest({
      id: "approval-3",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }));
    assert.throws(() => store.expireApproval("approval-3", 1), /has not passed its deadline/);
  });

  test(label("E APPROVED → REVOKED withdraws the grant and keeps the decision"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    approvedDeploy(store);

    assert.throws(
      () => store.revokeApproval("approval-1", 2, { revokedBy: "carol" }),
      /cannot be REVOKED without a reason/,
    );
    assert.throws(
      () => store.revokeApproval("approval-1", 2, { reason: "incident" }),
      /cannot be REVOKED without a revoking subject/,
    );

    const revoked = store.revokeApproval("approval-1", 2, {
      revokedBy: "carol",
      reason: "incident-4711",
    }, { commandId: "cmd-revoke-1" });

    assert.equal(revoked.decision.status, ApprovalStatus.REVOKED);
    assert.equal(revoked.version, 3);
    // the decision it superseded is preserved, not erased
    assert.equal(revoked.decision.decidedBy, "alice");
    assert.equal(revoked.decision.decidedAt, store.getApproval("approval-1").decision.decidedAt);
    assert.equal(revoked.revocation.revokedBy, "carol");
    assert.equal(revoked.revocation.reason, "incident-4711");
    assert.match(revoked.revocation.revokedAt, /^\d{4}-\d{2}-\d{2}T/);

    const event = store.getEvents().at(-1);
    assert.equal(event.type, "approval.revoked");
    assert.equal(event.payload.revokedBy, "carol");
    assert.equal(event.payload.reason, "incident-4711");
    assertRefused(() => store.assertApprovalUsable(deployIntent()), ApprovalFailureReason.REVOKED, /is REVOKED/);
  });

  // ── F–I: the forbidden transitions ─────────────────────────────────────────

  test(label("F REJECTED → APPROVED is refused"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    store.requestApproval(deployRequest());
    store.decideApproval("approval-1", 1, { decision: ApprovalDecision.REJECT, decidedBy: "bob" });

    assert.throws(
      () => store.decideApproval("approval-1", 2, { decision: ApprovalDecision.APPROVE, decidedBy: "alice" }),
      /is REJECTED and may not become APPROVED/,
    );
    assert.equal(store.getApproval("approval-1").decision.status, ApprovalStatus.REJECTED);
    assert.equal(store.getApproval("approval-1").version, 2, "a refused transition writes nothing");
    assert.equal(countEvents(store, "approval.approved"), 0);
  });

  test(label("G EXPIRED → APPROVED is refused"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    store.requestApproval(deployRequest({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    store.expireApproval("approval-1", 1);

    assert.throws(
      () => store.decideApproval("approval-1", 2, { decision: ApprovalDecision.APPROVE, decidedBy: "alice" }),
      /is EXPIRED and may not become APPROVED/,
    );
    assert.throws(
      () => store.revokeApproval("approval-1", 2, { revokedBy: "carol", reason: "late" }),
      /is EXPIRED and may not become REVOKED/,
    );
    assert.equal(countEvents(store, "approval.approved"), 0);
  });

  test(label("H REVOKED → APPROVED is refused"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    approvedDeploy(store);
    store.revokeApproval("approval-1", 2, { revokedBy: "carol", reason: "incident" });

    assert.throws(
      () => store.decideApproval("approval-1", 3, { decision: ApprovalDecision.APPROVE, decidedBy: "alice" }),
      /is REVOKED and may not become APPROVED/,
    );
    // re-applying is a NEW request, never a resurrection of the old one
    const second = store.requestApproval(deployRequest({ id: "approval-2" }));
    assert.equal(second.decision.status, ApprovalStatus.PENDING);
    assert.equal(store.getApproval("approval-1").decision.status, ApprovalStatus.REVOKED);
    assert.equal(countEvents(store, "approval.approved"), 1);
  });

  test(label("I APPROVED → APPROVED is refused, with no second decision event"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    approvedDeploy(store);

    assert.throws(
      () => store.decideApproval("approval-1", 2, { decision: ApprovalDecision.APPROVE, decidedBy: "dave" }, {
        commandId: "cmd-decide-2",
      }),
      /is already APPROVED/,
    );
    assert.equal(store.getApproval("approval-1").version, 2);
    assert.equal(countEvents(store, "approval.approved"), 1, "one permission, one claim");
    assert.equal(store.getApproval("approval-1").decision.decidedBy, "alice");
  });

  // ── J–N: what the approval is bound to ─────────────────────────────────────

  test(label("J a granted approval does not extend to a newer target version"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    approvedDeploy(store);
    assert.equal(store.assertApprovalUsable(deployIntent()).id, "approval-1");

    store.updateTask("task-1", 1, { status: TaskStatus.IN_PROGRESS }, { commandId: "cmd-task" });
    assert.equal(store.getTask("task-1").version, 2);

    assertRefused(() => store.assertApprovalUsable(deployIntent()), ApprovalFailureReason.STALE, /is now v2/);
    // the permission is untouched — it simply no longer describes reality
    assert.equal(store.getApproval("approval-1").decision.status, ApprovalStatus.APPROVED);
    assert.equal(store.getApproval("approval-1").version, 2);
    // a command that wants v2 needs its own approval
    const forV2 = store.requestApproval(deployRequest({ id: "approval-2" }));
    assert.equal(forV2.request.targetVersion, 2);
    store.decideApproval("approval-2", 1, { decision: ApprovalDecision.APPROVE, decidedBy: "alice" });
    assert.equal(store.assertApprovalUsable(deployIntent({ approvalId: "approval-2", targetVersion: 2 })).id, "approval-2");
    assertRefused(
      () => store.assertApprovalUsable(deployIntent({ approvalId: "approval-2" })),
      ApprovalFailureReason.STALE,
      /not v1/,
    );
  });

  test(label("K an approval for one action does not authorize another"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    approvedDeploy(store);
    assertRefused(
      () => store.assertApprovalUsable(deployIntent({ action: "delete" })),
      ApprovalFailureReason.ACTION_MISMATCH,
      /authorizes action "deploy", not "delete"/,
    );
  });

  test(label("L scope is part of the fact, and is compared exactly"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    approvedDeploy(store);
    assertRefused(
      () => store.assertApprovalUsable(deployIntent({ scope: "staging" })),
      ApprovalFailureReason.SCOPE_MISMATCH,
      /authorizes scope "production", not "staging"/,
    );
    // no wildcards, no prefixes: "production-*" is not "production"
    assertRefused(
      () => store.assertApprovalUsable(deployIntent({ scope: "production-eu" })),
      ApprovalFailureReason.SCOPE_MISMATCH,
    );
  });

  test(label("M a TASK approval cannot be read as a GOAL approval"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    approvedDeploy(store);
    assertRefused(
      () => store.assertApprovalUsable(deployIntent({ targetType: ApprovalTargetType.GOAL, targetId: "goal-1" })),
      ApprovalFailureReason.TARGET_TYPE_MISMATCH,
      /authorizes TASK task-1, not GOAL goal-1/,
    );
  });

  test(label("N an approval for task-1 does not authorize task-2"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    store.seedTask(createTask({
      id: "task-2",
      goalId: "goal-1",
      title: "T2",
      acceptanceId: "acceptance-1",
      acceptanceVersion: 1,
    }));
    approvedDeploy(store);
    assertRefused(
      () => store.assertApprovalUsable(deployIntent({ targetId: "task-2" })),
      ApprovalFailureReason.TARGET_ID_MISMATCH,
      /authorizes TASK task-1, not task-2/,
    );
  });

  // ── capability: part of the authorized action ──────────────────────────────

  test(label("C1 the capability that was approved is the capability that authorizes"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    approvedDeploy(store);

    // A: the approved capability authorizes
    assert.equal(store.assertApprovalUsable(deployIntent()).request.capability, "deploy.production");

    // B: a different capability does NOT, even with the same action and scope
    assertRefused(
      () => store.assertApprovalUsable(deployIntent({ capability: "delete.production" })),
      ApprovalFailureReason.CAPABILITY_MISMATCH,
      /authorizes capability "deploy.production", not "delete.production"/,
    );

    // C: same capability, different action → the action rule refuses it
    assertRefused(
      () => store.assertApprovalUsable(deployIntent({ action: "delete" })),
      ApprovalFailureReason.ACTION_MISMATCH,
    );

    // D: same action, different capability → the capability rule refuses it
    assertRefused(
      () => store.assertApprovalUsable(deployIntent({ action: "deploy", capability: "deploy.staging" })),
      ApprovalFailureReason.CAPABILITY_MISMATCH,
    );

    // E: different scope is still the scope rule
    assertRefused(
      () => store.assertApprovalUsable(deployIntent({ scope: "staging" })),
      ApprovalFailureReason.SCOPE_MISMATCH,
    );

    // F: repeating the exact same authorization is stable, and writes nothing
    const eventsBefore = store.getEvents().length;
    for (let round = 0; round < 3; round += 1) {
      assert.equal(store.assertApprovalUsable(deployIntent()).id, "approval-1");
    }
    assert.equal(store.getEvents().length, eventsBefore, "consumption is a read");

    // …and an unnamed capability is not a wildcard
    assert.throws(
      () => store.assertApprovalUsable(deployIntent({ capability: undefined })),
      (error) => error instanceof InvariantError && /must present the capability it exercises/.test(error.message),
    );
    assert.throws(
      () => store.assertApprovalUsable(deployIntent({ capability: "   " })),
      /must present the capability it exercises/,
    );
  });

  test(label("C2 capability is bound like every other part of the request"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    store.requestApproval(deployRequest());

    // G: an update may not re-point the permission at another capability
    assert.throws(
      () => store.updateApproval("approval-1", 1, { capability: "another-capability" }),
      /binds capability: it defines what was approved and cannot be changed/,
    );
    assert.equal(store.getApproval("approval-1").version, 1, "a refused update writes nothing");
    assert.equal(store.getApproval("approval-1").request.capability, "deploy.production");
    assert.equal(countEvents(store, "approval.updated"), 0);

    // the request still decides it, and only at creation
    assert.throws(
      () => store.requestApproval(deployRequest({ id: "approval-nocap", capability: "" })),
      /requires a non-empty capability/,
    );
    assert.equal(store.getRecord(Collection.APPROVAL, "approval-nocap"), null);
  });

  // ── O: attribution ─────────────────────────────────────────────────────────

  test(label("O no approver, no approval"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);

    // 1. it cannot be seeded
    assert.throws(
      () => store.seedApproval({
        ...createApproval({ ...deployRequest(), targetVersion: 1 }),
        decision: { status: ApprovalStatus.APPROVED, decidedBy: null, decidedAt: null, reason: null },
      }),
      /is APPROVED without an attributable decision/,
    );
    assert.equal(store.getRecord(Collection.APPROVAL, "approval-1"), null);

    // 2. it cannot be decided without a subject
    store.requestApproval(deployRequest());
    assert.throws(
      () => store.decideApproval("approval-1", 1, { decision: ApprovalDecision.APPROVE, decidedBy: "" }),
      /cannot be APPROVED without a deciding subject/,
    );
    assert.throws(
      () => store.decideApproval("approval-1", 1, { decision: ApprovalDecision.REJECT, decidedBy: null }),
      /cannot be REJECTED without a deciding subject/,
    );
    assert.equal(store.getApproval("approval-1").version, 1);

    // 3. and durable state written outside the rules is not trusted either
    const corrupted = store.getApproval("approval-1");
    store.putRecord(Collection.APPROVAL, "approval-1", {
      ...corrupted,
      decision: { status: ApprovalStatus.APPROVED, decidedBy: null, decidedAt: null, reason: null },
    });
    assertRefused(
      () => store.assertApprovalUsable(deployIntent()),
      ApprovalFailureReason.UNATTRIBUTED,
      /without an attributable decision/,
    );

    // 4. a status this version cannot reason about is not "probably fine"
    store.putRecord(Collection.APPROVAL, "approval-1", {
      ...corrupted,
      decision: { status: "PROBABLY_FINE", decidedBy: "alice", decidedAt: "2026-01-01T00:00:00.000Z", reason: null },
    });
    assertRefused(
      () => store.assertApprovalUsable(deployIntent()),
      ApprovalFailureReason.UNKNOWN,
      /is PROBABLY_FINE and authorizes nothing/,
    );
    store.putRecord(Collection.APPROVAL, "approval-1", { ...corrupted, decision: null });
    assertRefused(() => store.assertApprovalUsable(deployIntent()), ApprovalFailureReason.UNKNOWN, /\(no status\)/);
  });

  // ── P/Q: what an approval is NOT ───────────────────────────────────────────

  test(label("P an approved approval is a permission fact; reading it runs nothing"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    approvedDeploy(store);
    const eventsBefore = store.getEvents().length;

    const usable = store.assertApprovalUsable(deployIntent());

    assert.equal(usable.decision.status, ApprovalStatus.APPROVED);
    assert.equal(store.getRunsForTask("task-1").length, 0);
    assert.equal(store.getTask("task-1").status, TaskStatus.READY);
    assert.equal(store.getTask("task-1").version, 1);
    assert.equal(store.getEvents().length, eventsBefore, "permission checks are reads, not execution");
    assert.equal(countEvents(store, "run.created"), 0);
    assert.equal(countEvents(store, "task.accepted"), 0);
  });

  test(label("Q approval and acceptance never imply each other"), { skip }, async (t) => {
    const store = backend.make(t);
    seedWorld(store);
    approvedDeploy(store);
    const { controller } = makeController(store);

    // an APPROVED approval accepts nothing
    assert.equal(store.assertApprovalUsable(deployIntent()).id, "approval-1");
    assert.equal(store.getTask("task-1").status, TaskStatus.READY);
    assert.equal(store.getGoal("goal-1").status, GoalStatus.IN_PROGRESS);
    assert.equal(store.getMilestone("ms-1").status, MilestoneStatus.READY);
    assert.equal(countEvents(store, "task.accepted"), 0);

    // acceptance needs no approval, and creates none
    assert.equal((await controller.reconcileTask("task-1")).action, "ACCEPT");
    assert.equal(store.getTask("task-1").status, TaskStatus.ACCEPTED);
    assert.equal(store.allRecords(Collection.APPROVAL).length, 1, "acceptance created no approval");
    assert.equal(countEvents(store, "approval.requested"), 1);

    // moving the target makes the old permission stale
    assertRefused(() => store.assertApprovalUsable(deployIntent()), ApprovalFailureReason.STALE);
  });

  // ── R/S: idempotency and the bound command ─────────────────────────────────

  test(label("R the same command replays; a new command cannot re-decide"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    store.requestApproval(deployRequest(), { commandId: "cmd-request-1" });

    const first = store.decideApproval("approval-1", 1, { decision: ApprovalDecision.APPROVE, decidedBy: "alice" }, {
      commandId: "cmd-decide-1",
    });
    const replayed = store.decideApproval("approval-1", 1, { decision: ApprovalDecision.APPROVE, decidedBy: "alice" }, {
      commandId: "cmd-decide-1",
    });

    assert.equal(replayed.version, 2);
    assert.deepEqual(replayed, first);
    assert.equal(countEvents(store, "approval.approved"), 1, "a replay is not a second decision");
    assert.equal(store.getApproval("approval-1").version, 2);
    assert.equal(countEvents(store, "approval.requested"), 1, "the request replays too");

    const requestedAgain = store.requestApproval(deployRequest(), { commandId: "cmd-request-1" });
    assert.equal(requestedAgain.id, "approval-1", "the replayed request resolves to the same approval");
    assert.equal(countEvents(store, "approval.requested"), 1);
  });

  test(label("S an approval bound to one command cannot be consumed by another"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    approvedDeploy(store, { over: { commandId: "cmd-1" } });

    assert.equal(store.assertApprovalUsable(deployIntent({ commandId: "cmd-1" })).id, "approval-1");
    assertRefused(
      () => store.assertApprovalUsable(deployIntent({ commandId: "cmd-2" })),
      ApprovalFailureReason.COMMAND_MISMATCH,
      /is bound to command cmd-1, not cmd-2/,
    );
    // a bound approval may not be used anonymously either
    assertRefused(
      () => store.assertApprovalUsable(deployIntent()),
      ApprovalFailureReason.COMMAND_MISMATCH,
      /not \(none\)/,
    );
    // the idempotency key of the CALL and the command the permission is ABOUT
    // are different things, and both survive
    assert.equal(store.getApproval("approval-1").commandId, "cmd-1");
    assert.deepEqual(store.getCommand("cmd-decide-1"), { operation: "decideApproval", resultId: "approval-1" });
  });

  // ── T: concurrency ─────────────────────────────────────────────────────────

  test(label("T two approvers on one version produce one decision"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    store.requestApproval(deployRequest());

    store.decideApproval("approval-1", 1, { decision: ApprovalDecision.APPROVE, decidedBy: "alice" }, {
      commandId: "cmd-alice",
    });
    assert.throws(
      () => store.decideApproval("approval-1", 1, { decision: ApprovalDecision.REJECT, decidedBy: "bob" }, {
        commandId: "cmd-bob",
      }),
      (error) => error instanceof ConflictError && error.code === "CONFLICT",
    );

    assert.equal(store.getApproval("approval-1").decision.decidedBy, "alice");
    assert.equal(store.getApproval("approval-1").version, 2);
    assert.equal(countEvents(store, "approval.approved"), 1);
    assert.equal(countEvents(store, "approval.rejected"), 0, "the loser wrote nothing");
    assert.equal(store.getCommand("cmd-bob"), null, "and left no idempotency row behind");
  });

  // ── U/V: unusable approvals cannot authorize ───────────────────────────────

  test(label("U an approval that has expired is unusable, and says so"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    approvedDeploy(store, { over: { expiresAt: new Date(Date.now() + 60_000).toISOString() } });

    assert.equal(store.assertApprovalUsable(deployIntent()).id, "approval-1");

    // the clock moves — no scheduler anywhere — and the SAME record stops
    // authorizing, before anything has recorded the expiry
    const later = new Date(Date.now() + 120_000);
    assertRefused(
      () => store.assertApprovalUsable({ ...deployIntent(), at: later }),
      ApprovalFailureReason.EXPIRED,
      /EXPIRED at/,
    );
    assert.equal(store.getApproval("approval-1").decision.status, ApprovalStatus.APPROVED);
    assert.equal(countEvents(store, "approval.expired"), 0, "a read is not a state change");

    const expired = store.expireApproval("approval-1", 2, { at: later, commandId: "cmd-expire" });
    assert.equal(expired.decision.status, ApprovalStatus.EXPIRED);
    assert.equal(expired.decision.decidedBy, "alice");
    const event = store.getEvents().at(-1);
    assert.equal(event.type, "approval.expired");
    assert.equal(event.payload.from, ApprovalStatus.APPROVED);
    assertRefused(() => store.assertApprovalUsable(deployIntent()), ApprovalFailureReason.EXPIRED);
  });

  test(label("V a revoked approval cannot authorize"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    approvedDeploy(store);

    assert.equal(store.assertApprovalUsable(deployIntent()).id, "approval-1");
    store.revokeApproval("approval-1", 2, { revokedBy: "carol", reason: "incident-4711" });

    assertRefused(
      () => store.assertApprovalUsable(deployIntent()),
      ApprovalFailureReason.REVOKED,
      /REVOKED/,
    );
    assert.equal(store.getApproval("approval-1").revocation.reason, "incident-4711");
  });

  // ── the remaining surface: targets, updates, COMMAND binding ───────────────

  test(label("W every aggregate target type is read at its own current version"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    const targets = [
      { targetType: ApprovalTargetType.PROJECT, targetId: "project-1" },
      { targetType: ApprovalTargetType.MILESTONE, targetId: "ms-1" },
      { targetType: ApprovalTargetType.GOAL, targetId: "goal-1" },
      { targetType: ApprovalTargetType.TASK, targetId: "task-1" },
    ];

    targets.forEach(({ targetType, targetId }, index) => {
      const id = `approval-${index + 1}`;
      store.requestApproval(deployRequest({ id, targetType, targetId }));
      store.decideApproval(id, 1, { decision: ApprovalDecision.APPROVE, decidedBy: "alice" });
      assert.equal(
        store.assertApprovalUsable({ ...deployIntent(), approvalId: id, targetType, targetId }).id,
        id,
        `${targetType} approval is usable`,
      );
      // and moving that target's own state makes it stale
      if (targetType === ApprovalTargetType.GOAL) {
        store.updateGoal("goal-1", 1, { status: GoalStatus.BLOCKED }, { commandId: "cmd-goal" });
        assertRefused(
          () => store.assertApprovalUsable({ ...deployIntent(), approvalId: id, targetType, targetId }),
          ApprovalFailureReason.STALE,
        );
      }
    });
    assert.equal(store.getProject("project-1").status, ProjectStatus.ACTIVE);
  });

  test(label("X COMMAND is a reserved target type that v0.1 cannot honour"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);

    // 1. it cannot be REQUESTED: there is no durable Command object to authorize
    assert.throws(
      () => store.requestApproval({
        id: "approval-cmd",
        targetType: ApprovalTargetType.COMMAND,
        targetId: "deploy-cmd-1",
        commandId: "deploy-cmd-1",
        action: "deploy",
        capability: "deploy.production",
        scope: "production",
        riskLevel: RiskLevel.HIGH,
        requestedBy: "requester-1",
      }),
      (error) => error instanceof InvariantError && error.message === COMMAND_APPROVAL_UNAVAILABLE,
    );
    assert.equal(store.getRecord(Collection.APPROVAL, "approval-cmd"), null, "nothing was created");
    assert.equal(countEvents(store, "approval.requested"), 0);

    // 2. it cannot be SEEDED either — not even as a decided historical grant
    assert.throws(
      () => store.seedApproval({
        ...createApproval({ ...deployRequest(), targetVersion: 1 }),
        id: "approval-cmd",
        request: {
          targetType: ApprovalTargetType.COMMAND,
          targetId: "deploy-cmd-1",
          targetVersion: null,
          action: "deploy",
          capability: "deploy.production",
          scope: "production",
          riskLevel: RiskLevel.HIGH,
        },
        commandId: "deploy-cmd-1",
      }),
      (error) => error instanceof InvariantError && error.message === COMMAND_APPROVAL_UNAVAILABLE,
    );

    // 3. durable state written by an older writer (which DID allow it) cannot be
    //    consumed: the boundary is enforced at use, not only at creation
    const now = new Date().toISOString();
    store.putRecord(Collection.APPROVAL, "approval-legacy", {
      id: "approval-legacy",
      version: 1,
      request: {
        targetType: ApprovalTargetType.COMMAND,
        targetId: "deploy-cmd-1",
        targetVersion: null,
        action: "deploy",
        capability: "deploy.production",
        scope: "production",
        riskLevel: RiskLevel.HIGH,
      },
      requestedBy: "requester-1",
      decision: { status: ApprovalStatus.APPROVED, decidedBy: "alice", decidedAt: now, reason: null },
      revocation: null,
      commandId: "deploy-cmd-1",
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });
    assert.equal(store.getApproval("approval-legacy").decision.status, ApprovalStatus.APPROVED);
    assert.throws(
      () => store.assertApprovalUsable({
        approvalId: "approval-legacy",
        targetType: ApprovalTargetType.COMMAND,
        targetId: "deploy-cmd-1",
        action: "deploy",
        capability: "deploy.production",
        scope: "production",
        commandId: "deploy-cmd-1",
      }),
      (error) => error instanceof InvariantError && error.message === COMMAND_APPROVAL_UNAVAILABLE,
    );
    // …and a caller that pretends the COMMAND approval is about a Task is refused
    // by the ordinary target-type rule
    assertRefused(
      () => store.assertApprovalUsable(deployIntent({ approvalId: "approval-legacy" })),
      ApprovalFailureReason.TARGET_TYPE_MISMATCH,
    );
  });

  test(label("Y a request is not edited: only its deadline may move, and only while open"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    store.requestApproval(deployRequest());

    const later = new Date(Date.now() + 3_600_000).toISOString();
    const extended = store.updateApproval("approval-1", 1, { expiresAt: later }, { commandId: "cmd-update" });
    assert.equal(extended.expiresAt, later);
    assert.equal(extended.version, 2);
    assert.equal(eventTypes(store).at(-1), "approval.updated");

    // what was approved is bound for the life of the approval
    assert.throws(
      () => store.updateApproval("approval-1", 2, { request: { scope: "production" } }),
      /cannot be updated in request/,
    );
    assert.throws(
      () => store.updateApproval("approval-1", 2, { scope: "everything" }),
      /binds scope/,
    );
    assert.throws(
      () => store.updateApproval("approval-1", 2, { decision: { status: "APPROVED" } }),
      /cannot be updated in decision/,
    );
    assert.equal(store.getApproval("approval-1").version, 2);

    // a decided request is frozen; it is revoked or replaced, never edited
    store.decideApproval("approval-1", 2, { decision: ApprovalDecision.APPROVE, decidedBy: "alice" });
    assert.throws(
      () => store.updateApproval("approval-1", 3, { expiresAt: later }),
      /is APPROVED: a decided request is not edited/,
    );
  });

  test(label("Z the store never needs a background job to know an approval is dead"), { skip }, (t) => {
    const store = backend.make(t);
    seedWorld(store);
    const expiresAt = new Date(Date.now() + 1000).toISOString();
    store.requestApproval(deployRequest({ expiresAt }));
    store.decideApproval("approval-1", 1, { decision: ApprovalDecision.APPROVE, decidedBy: "alice" });

    const before = store.getApproval("approval-1");
    assert.equal(effectiveApprovalStatus(before, new Date()), ApprovalStatus.APPROVED);
    assert.equal(effectiveApprovalStatus(before, new Date(Date.now() + 60_000)), ApprovalStatus.EXPIRED);
    // reading did not mutate the record, and no timer exists in this codebase
    assert.equal(store.getApproval("approval-1").decision.status, ApprovalStatus.APPROVED);
    assert.equal(store.getApproval("approval-1").version, before.version);
    assert.equal(countEvents(store, "approval.expired"), 0);
  });
}

// Durable Command authorization has moved to project-control-command/controller tests.

/** Timestamps are the only thing two independent runs may differ in. */
function withoutClock(approval) {
  return {
    ...withoutTimestamps(approval),
    decision: { ...approval.decision, decidedAt: approval.decision.decidedAt ? "CLOCK" : null },
    revocation: approval.revocation ? { ...approval.revocation, revokedAt: "CLOCK" } : null,
  };
}

function eventsWithoutClock(store) {
  return store.getEvents().map(({ occurredAt, ...rest }) => ({
    ...rest,
    payload: Object.fromEntries(
      Object.entries(rest.payload).map(([key, value]) => [
        key,
        key === "decidedAt" || key === "revokedAt" ? "CLOCK" : value,
      ]),
    ),
  }));
}

test("both backends keep identical approval state for the same flow", { skip: BACKENDS[1].skip }, (t) => {
  const memory = new MemoryStore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-approval-parity-"));
  const sqlite = new SqliteStore(path.join(dir, "project-control.db"));
  t.after(() => {
    try {
      sqlite.close();
    } catch {
      // already closed
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const run = (store) => {
    seedWorld(store);
    store.requestApproval(deployRequest({ commandId: "C1" }), { commandId: "cmd-request" });
    store.decideApproval("approval-1", 1, { decision: ApprovalDecision.APPROVE, decidedBy: "alice" }, {
      commandId: "cmd-decide",
    });
    store.requestApproval(deployRequest({ id: "approval-2", expiresAt: "2020-01-01T00:00:00.000Z" }));
    store.expireApproval("approval-2", 1, { commandId: "cmd-expire" });
    store.requestApproval(deployRequest({ id: "approval-3" }));
    store.decideApproval("approval-3", 1, { decision: ApprovalDecision.REJECT, decidedBy: "bob", reason: "no" });
    store.requestApproval(deployRequest({ id: "approval-4" }));
    store.decideApproval("approval-4", 1, { decision: ApprovalDecision.APPROVE, decidedBy: "alice" });
    store.revokeApproval("approval-4", 2, { revokedBy: "carol", reason: "incident" });
    return {
      approvals: store.allRecords(Collection.APPROVAL)
        .map(withoutClock)
        .sort((left, right) => left.id.localeCompare(right.id)),
      authorizedNow: store.getApprovalsInStatus(ApprovalStatus.APPROVED).map((each) => each.id),
      aboutTask: store.getApprovalsForTarget(ApprovalTargetType.TASK, "task-1").map((each) => each.id),
      events: eventsWithoutClock(store),
    };
  };

  const fromMemory = run(memory);
  const fromSqlite = run(sqlite);

  assert.deepEqual(fromSqlite, fromMemory);
  assert.deepEqual(fromMemory.authorizedNow, ["approval-1"], "only the live grant is APPROVED");
  assert.deepEqual(fromMemory.aboutTask, ["approval-1", "approval-2", "approval-3", "approval-4"]);
});

test("an approval is read as a record, so a rewritten status is the status", { skip: BACKENDS[1].skip }, (t) => {
  // The rules read the RECORD, and the projected columns are derived from it, so
  // the two can never disagree about what an approval currently is.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-approval-columns-"));
  const store = new SqliteStore(path.join(dir, "project-control.db"));
  t.after(() => {
    try {
      store.close();
    } catch {
      // already closed
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  seedWorld(store);
  store.requestApproval(deployRequest());
  assert.deepEqual(store.getApprovalsInStatus(ApprovalStatus.APPROVED), []);
  store.putRecord(Collection.APPROVAL, "approval-1", {
    ...store.getApproval("approval-1"),
    version: 2,
    decision: {
      status: ApprovalStatus.APPROVED,
      decidedBy: "alice",
      decidedAt: new Date().toISOString(),
      reason: null,
    },
  });
  // the shared lookup reflects the record it just read
  assert.deepEqual(store.getApprovalsInStatus(ApprovalStatus.APPROVED).map((each) => each.id), ["approval-1"]);
  assert.equal(store.assertApprovalUsable(deployIntent()).decision.decidedBy, "alice");
  // and the projected column was written from that same record
  const raw = createRequire(import.meta.url)("node:sqlite");
  const db = new raw.DatabaseSync(path.join(dir, "project-control.db"));
  const row = db.prepare("SELECT status, target_id, target_version FROM approvals WHERE id = ?").get("approval-1");
  db.close();
  assert.deepEqual({ ...row }, { status: ApprovalStatus.APPROVED, target_id: "task-1", target_version: 1 });
});
