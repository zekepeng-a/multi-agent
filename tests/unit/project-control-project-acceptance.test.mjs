// G7.1 Project-level Acceptance.
//
// Project completion remains aggregate-only when no contract is pinned. When a
// PROJECT contract is pinned, completed Milestones are only the input to the same
// aggregate Evidence → Verification → Acceptance flow used by Goal/Milestone.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Collection } from "../../project-control/store.mjs";
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
  AcceptanceTargetType,
  MilestoneStatus,
  ProjectStatus,
  VerificationVerdict,
  createAcceptance,
  createMilestone,
  createProject,
  createVerification,
} from "../../project-control/domain.mjs";

const BACKENDS = [
  {
    name: "MemoryStore",
    skip: false,
    make() { return new MemoryStore(); },
  },
  {
    name: "SqliteStore",
    skip: isSqliteAvailable() ? false : `node:sqlite is unavailable: ${SQLITE_REQUIREMENT}`,
    make(t) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-project-accept-"));
      const store = new SqliteStore(path.join(dir, "project-control.db"));
      t.after(() => {
        try { store.close(); } catch {}
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      });
      return store;
    },
  },
];

function controllerFor(store, verdict = VerificationVerdict.PASS) {
  return new Controller({
    store,
    runtime: new FakeRuntime({ mode: "success" }),
    verifier: new FakeVerifier({ verdict }),
  });
}

function seedProjectContract(store, {
  projectStatus = ProjectStatus.ACTIVE,
  acceptanceId = "acceptance-project",
  acceptanceVersion = 1,
} = {}) {
  store.seedAcceptance(createAcceptance({
    id: acceptanceId,
    targetType: AcceptanceTargetType.PROJECT,
    targetId: "project-1",
    version: acceptanceVersion,
    criteria: [{ id: "release", type: "AGGREGATE", required: true }],
  }));
  store.seedProject(createProject({
    id: "project-1",
    name: "Project acceptance",
    status: projectStatus,
    acceptanceId,
    acceptanceVersion,
  }));
  store.seedMilestone(createMilestone({
    id: "ms-1",
    projectId: "project-1",
    name: "Milestone 1",
    status: MilestoneStatus.COMPLETED,
  }));
}

for (const backend of BACKENDS) {
  const label = (name) => `${backend.name}: ${name}`;

  test(label("Project pin must target this PROJECT and include both id/version"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    store.seedAcceptance(createAcceptance({
      id: "acceptance-wrong",
      targetType: AcceptanceTargetType.PROJECT,
      targetId: "project-other",
      criteria: [],
    }));

    assert.throws(
      () => store.seedProject(createProject({
        id: "project-1",
        name: "wrong target",
        acceptanceId: "acceptance-wrong",
        acceptanceVersion: 1,
      })),
      /which targets PROJECT project-other/,
    );

    assert.throws(
      () => store.seedProject(createProject({
        id: "project-no-version",
        name: "half pin",
        acceptanceId: "acceptance-wrong",
      })),
      /without pinning a revision/,
    );
    assert.throws(
      () => store.seedProject(createProject({
        id: "project-no-id",
        name: "half pin",
        acceptanceVersion: 1,
      })),
      /without naming a contract/,
    );
  });

  test(label("contract-free Project still completes by Milestone aggregation"), { skip: backend.skip }, async (t) => {
    const store = backend.make(t);
    store.seedProject(createProject({ id: "project-1", name: "aggregate only" }));
    store.seedMilestone(createMilestone({
      id: "ms-1",
      projectId: "project-1",
      name: "M1",
      status: MilestoneStatus.COMPLETED,
    }));

    const result = await controllerFor(store).reconcileProject("project-1");

    assert.equal(result.action, "SYNC");
    assert.equal(result.project.status, ProjectStatus.COMPLETED);
    assert.equal(store.getEvents().filter((e) => e.type === "project.completed").length, 1);
  });

  test(label("contract-bound Project creates/reuses one aggregate Evidence snapshot"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seedProjectContract(store);

    const first = store.ensureAggregateEvidence(Collection.PROJECT, "project-1");
    const events = store.getEvents().filter((e) => e.type === "evidence.recorded").length;
    const second = store.ensureAggregateEvidence(Collection.PROJECT, "project-1");

    assert.equal(first.id, second.id);
    assert.equal(first.targetType, AcceptanceTargetType.PROJECT);
    assert.equal(first.targetId, "project-1");
    assert.equal(first.taskId, null);
    assert.equal(first.runId, null);
    assert.equal(first.attemptId, null);
    assert.equal(first.sourceRefs.length, 1);
    assert.equal(first.sourceRefs[0].id, "ms-1");
    assert.equal(first.sourceRefs[0].status, MilestoneStatus.COMPLETED);
    assert.equal(store.getEvents().filter((e) => e.type === "evidence.recorded").length, events);
  });

  test(label("changed Milestone snapshot supersedes old Project Evidence"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seedProjectContract(store);

    const oldEvidence = store.ensureAggregateEvidence(Collection.PROJECT, "project-1");
    store.updateMilestone("ms-1", 1, { description: "new observed version" });
    const newEvidence = store.ensureAggregateEvidence(Collection.PROJECT, "project-1");

    assert.notEqual(newEvidence.id, oldEvidence.id);
    assert.equal(store.getEvidence(oldEvidence.id).status, "SUPERSEDED");
    assert.equal(newEvidence.sourceRefs[0].version, 2);
  });

  test(label("stale Project Evidence cannot complete current Project"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seedProjectContract(store);

    const evidence = store.ensureAggregateEvidence(Collection.PROJECT, "project-1");
    const verification = store.recordVerification(createVerification({
      id: "verification-project-old",
      targetType: AcceptanceTargetType.PROJECT,
      targetId: "project-1",
      acceptanceId: "acceptance-project",
      acceptanceVersion: 1,
      evidenceIds: [evidence.id],
      verdict: VerificationVerdict.PASS,
      revision: evidence.revision,
    }));

    store.updateMilestone("ms-1", 1, { description: "new revision" });

    assert.throws(
      () => store.acceptProject("project-1", 1, { verificationId: verification.id }),
      /no longer describes the current state/,
    );
    assert.equal(store.getProject("project-1").status, ProjectStatus.ACTIVE);
    assert.equal(store.getAcceptance("acceptance-project", 1).status, "PENDING");
  });

  test(label("PASS Verification atomically completes Project and contract"), { skip: backend.skip }, async (t) => {
    const store = backend.make(t);
    seedProjectContract(store);

    const result = await controllerFor(store).reconcileProject("project-1");

    assert.equal(result.action, "ACCEPT");
    assert.equal(result.reason, "project-completed");
    assert.equal(result.project.status, ProjectStatus.COMPLETED);
    assert.equal(store.getProject("project-1").version, 2);
    assert.equal(store.getAcceptance("acceptance-project", 1).status, "PASSED");
    assert.equal(result.evidence.targetType, AcceptanceTargetType.PROJECT);
    assert.equal(result.verification.verdict, VerificationVerdict.PASS);
    assert.equal(store.getEvents().filter((e) => e.type === "project.completed").length, 1);
  });

  test(label("FAIL Verification cannot be bypassed by completed Milestones"), { skip: backend.skip }, async (t) => {
    const store = backend.make(t);
    seedProjectContract(store);

    const result = await controllerFor(store, VerificationVerdict.FAIL).reconcileProject("project-1");

    assert.equal(result.action, "WAIT");
    assert.equal(result.reason, "project-acceptance-not-passed");
    assert.equal(store.getProject("project-1").status, ProjectStatus.ACTIVE);
    assert.equal(store.getAcceptance("acceptance-project", 1).status, "PENDING");
  });

  test(label("PAUSED/ARCHIVED/COMPLETED Project cannot re-enter acceptance"), { skip: backend.skip }, async (t) => {
    for (const status of [ProjectStatus.PAUSED, ProjectStatus.ARCHIVED, ProjectStatus.COMPLETED]) {
      const store = backend.make(t);
      const suffix = status.toLowerCase();
      store.seedAcceptance(createAcceptance({
        id: `acceptance-${suffix}`,
        targetType: AcceptanceTargetType.PROJECT,
        targetId: `project-${suffix}`,
        criteria: [],
      }));
      store.seedProject(createProject({
        id: `project-${suffix}`,
        name: status,
        status,
        acceptanceId: `acceptance-${suffix}`,
        acceptanceVersion: 1,
      }));

      const result = await controllerFor(store).reconcileProject(`project-${suffix}`);
      assert.equal(result.action, "NOOP");
      assert.equal(result.reason, `project-${suffix}`);
      assert.equal(store.getAcceptance(`acceptance-${suffix}`, 1).status, "PENDING");
    }
  });
}

test("SQLite restart preserves Project contract pin and accepted state", {
  skip: isSqliteAvailable() ? false : `node:sqlite is unavailable: ${SQLITE_REQUIREMENT}`,
}, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-project-accept-restart-"));
  const file = path.join(dir, "project-control.db");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

  let store = new SqliteStore(file);
  seedProjectContract(store);
  const accepted = await controllerFor(store).reconcileProject("project-1");
  assert.equal(accepted.action, "ACCEPT");
  store.close();

  store = new SqliteStore(file);
  const project = store.getProject("project-1");
  assert.equal(project.status, ProjectStatus.COMPLETED);
  assert.equal(project.acceptanceId, "acceptance-project");
  assert.equal(project.acceptanceVersion, 1);
  assert.equal(store.getAcceptance("acceptance-project", 1).status, "PASSED");
  assert.equal(store.getEvents().filter((e) => e.type === "project.completed").length, 1);
  store.close();
});
