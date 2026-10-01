import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryStore } from "../../project-control/memory-store.mjs";
import { SqliteStore, isSqliteAvailable } from "../../project-control/sqlite-store.mjs";
import { Controller } from "../../project-control/controller.mjs";
import { FakeRuntime } from "../../project-control/fake-runtime.mjs";
import { FakeVerifier } from "../../project-control/fake-verifier.mjs";
import { Collection } from "../../project-control/store.mjs";
import { InvariantError, createProject, createMilestone, createGoal, createTask, createAcceptance } from "../../project-control/domain.mjs";

const backends = [
  { name: "MemoryStore", make: () => new MemoryStore() },
  { name: "SQLite", skip: !isSqliteAvailable(), make: t => {
    const store = new SqliteStore(":memory:"); t.after(() => store.close()); return store;
  } },
];
function seed(store, { goalStatus = "READY", milestoneStatus = "READY", contract = null } = {}) {
  for (const id of ["A", "B"]) store.seedProject(createProject({ id, name: id,
    ...(contract === "project" && id === "A" ? pin(store, "PROJECT", id) : {}) }));
  store.seedMilestone(createMilestone({ id: "m", projectId: "A", name: "M", status: milestoneStatus,
    ...(contract === "milestone" ? pin(store, "MILESTONE", "m") : {}) }));
  store.seedGoal(createGoal({ id: "gA", projectId: "A", milestoneId: "m", title: "A", status: goalStatus,
    ...(contract === "goal" ? pin(store, "GOAL", "gA") : {}) }));
  store.seedGoal(createGoal({ id: "gB", projectId: "B", title: "B" }));
}
function pin(store, targetType, targetId) {
  const id = `a-${targetId}`;
  store.seedAcceptance(createAcceptance({ id, targetType, targetId, criteria: ["bounded acceptance"] }));
  return { acceptanceId: id, acceptanceVersion: 1 };
}
const task = over => createTask({ id: "t", projectId: "A", goalId: "gA", title: "T", acceptanceId: "a-t", acceptanceVersion: 1, ...over });
const mismatch = error => error instanceof InvariantError && /task .* declares project .* but its goal .* belongs to project/.test(error.message);
function state(store) {
  return { records: ["project", "milestone", "goal", "task", "acceptance", "evidence", "verification"].map(c => store.allRecords(c)), events: store.allEvents() };
}
for (const backend of backends) {
  test(`${backend.name}: Task ownership rejects seeds and re-parenting atomically; same-project and unattached remain legal`, { skip: backend.skip }, t => {
    const store = backend.make(t); seed(store);
    const initial = state(store);
    for (const projectId of ["B", null, undefined]) {
      const invalid = task({ projectId });
      if (projectId === undefined) invalid.projectId = undefined;
      assert.throws(() => store.seedTask(invalid), mismatch);
      assert.deepEqual(state(store), initial);
    }
    store.seedTask(task());
    const before = state(store);
    for (const [id, patch] of [["move", { goalId: "gB" }], ["project", { projectId: "B" }], ["missing", { goalId: "ghost" }]]) {
      assert.throws(() => store.updateTask("t", 1, patch, { commandId: id }), InvariantError);
      assert.deepEqual(state(store), before);
      assert.equal(store.getCommand(id), null);
    }
    store.seedGoal(createGoal({ id: "gA2", projectId: "A", title: "same project" }));
    const moved = store.updateTask("t", 1, { goalId: "gA2" }, { commandId: "legal" });
    assert.equal(moved.version, 2); assert.equal(moved.goalId, "gA2");
    assert.deepEqual(store.updateTask("t", 1, { goalId: "gA2" }, { commandId: "legal" }), moved);
    const beforeGoalMove = state(store);
    assert.throws(() => store.updateGoal("gA2", 1, { projectId: "B" }, { commandId: "parent-move" }), mismatch);
    assert.deepEqual(state(store), beforeGoalMove); assert.equal(store.getCommand("parent-move"), null);
    store.seedTask(task({ id: "free", projectId: "B", goalId: null }));
    assert.equal(store.getTask("free").goalId, null);
  });

  test(`${backend.name}: corruption cannot propagate through live or terminal ancestors`, { skip: backend.skip }, async t => {
    for (const [goalStatus, milestoneStatus] of [["READY", "READY"], ["ACCEPTED", "READY"], ["ACCEPTED", "COMPLETED"]]) {
      const store = backend.make(t); seed(store, { goalStatus, milestoneStatus });
      // Raw backend write represents legacy/manual corruption, not a supported mutation.
      store.putRecord(Collection.TASK, "t", task({ projectId: "B", status: "ACCEPTED" }));
      const before = state(store), runtime = new FakeRuntime();
      const controller = new Controller({ store, runtime, verifier: new FakeVerifier() });
      await assert.rejects(() => controller.reconcileProject("A"), mismatch);
      assert.deepEqual(state(store), before);
      assert.equal(runtime.started.length, 0);
      assert.throws(() => store.getTasksForGoal("gA"), mismatch);
    }
  });

  for (const [collection, id, method, goalStatus, milestoneStatus] of [
    ["goal", "gA", "acceptGoal", "READY", "READY"],
    ["milestone", "m", "completeMilestone", "ACCEPTED", "READY"],
    ["project", "A", "acceptProject", "ACCEPTED", "COMPLETED"],
  ]) test(`${backend.name}: ${collection} contract acceptance rechecks corrupt descendants, including existing PASS`, { skip: backend.skip }, t => {
    const store = backend.make(t); seed(store, { contract: collection, goalStatus, milestoneStatus });
    store.seedTask(task({ status: "ACCEPTED" }));
    const evidence = store.ensureAggregateEvidence(collection, id);
    const target = store.getRecord(collection, id);
    const acceptance = store.getAcceptance(target.acceptanceId, target.acceptanceVersion);
    const verification = new FakeVerifier().verify({ target, acceptance, evidence });
    store.recordVerification(verification);
    // Keep version/status unchanged: snapshot version checks alone cannot detect this.
    store.putRecord(Collection.TASK, "t", { ...store.getTask("t"), projectId: "B" });
    const before = state(store);
    assert.throws(() => store.ensureAggregateEvidence(collection, id), mismatch);
    assert.throws(() => store[method](id, target.version, { verificationId: verification.id, commandId: "bad-accept" }), mismatch);
    assert.deepEqual(state(store), before); assert.equal(store.getCommand("bad-accept"), null);
  });
}

test("SQLite: refused Task mutation leaves no version/event/replay across reopen; corrupt descendants still fail closed", { skip: !isSqliteAvailable() }, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-task-owner-")), file = path.join(dir, "state.db");
  let store = new SqliteStore(file);
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  seed(store); store.seedTask(task());
  const before = state(store);
  assert.throws(() => store.updateTask("t", 1, { goalId: "gB" }, { commandId: "invalid" }), mismatch);
  store.close(); store = new SqliteStore(file);
  assert.deepEqual(state(store), before); assert.equal(store.getCommand("invalid"), null);
  store.putRecord(Collection.TASK, "t", { ...store.getTask("t"), projectId: "B", status: "ACCEPTED" });
  store.close(); store = new SqliteStore(file);
  assert.throws(() => store.getMilestonesForProject("A"), mismatch);
  assert.equal(store.getProject("A").status, "ACTIVE");
});
