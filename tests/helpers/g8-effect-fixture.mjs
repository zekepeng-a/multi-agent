import assert from "node:assert/strict";
import path from "node:path";
import { Controller } from "../../project-control/controller.mjs";
import { StaticPolicyEngine } from "../../project-control/policy-engine.mjs";
import { SqliteStore } from "../../project-control/sqlite-store.mjs";
import { createProject, createMilestone, createGoal, createTask, createAcceptance } from "../../project-control/domain.mjs";
import { LocalFileEffectDriver, ACTION, CAPABILITY } from "./g8-local-file-effect-driver.mjs";

export function seedEffectWorld(store) {
  store.seedProject(createProject({ id: "p2", name: "Real Effect control" }));
  store.seedMilestone(createMilestone({ id: "m2", projectId: "p2", name: "External observation" }));
  store.seedGoal(createGoal({ id: "g2", projectId: "p2", milestoneId: "m2", title: "Observe external marker" }));
  store.seedAcceptance(createAcceptance({ id: "a2", targetId: "t2", criteria: ["Effect is not acceptance"] }));
  store.seedTask(createTask({ id: "t2", projectId: "p2", goalId: "g2", title: "Controlled external marker", acceptanceId: "a2", acceptanceVersion: 1 }));
  return store.createControlCommand({ id: "command-2", targetType: "TASK", targetId: "t2", expectedVersion: 1,
    action: ACTION, capability: CAPABILITY, scope: "test-provider", riskLevel: "HIGH", requestedBy: "human-slice-2",
    parameters: { marker: "bounded-real-effect", version: 1 }, idempotencyKey: "marker:t2:v1" });
}

export function effectController(store, directory, { database, modes, deny = false } = {}) {
  const command = store.getControlCommand("command-2");
  const driver = new LocalFileEffectDriver({ directory, command, modes, verifyDurableDispatch: effect => {
    const reader = database ? new SqliteStore(database) : store;
    try {
      assert.deepEqual(reader.getEffect(effect.id), effect);
      const events = reader.allEvents().filter(event => event.aggregateId === effect.id);
      const requested = events.findIndex(event => event.type === "effect.requested");
      const dispatched = events.findIndex(event => event.type === "effect.dispatched");
      assert.ok(requested >= 0 && dispatched > requested);
      assert.equal(events[requested].payload.status, "REQUESTED");
      assert.equal(events[dispatched].payload.status, "DISPATCHED");
      assert.equal(reader.getControlCommand(effect.commandId).status, "AUTHORIZED");
    } finally { if (reader !== store) reader.close(); }
  } });
  const policyEngine = new StaticPolicyEngine({ version: "slice-2-v1", rules: [{ id: "marker-approval", action: ACTION,
    capability: CAPABILITY, scope: "test-provider", effect: deny ? "DENY" : "REQUIRE_APPROVAL" }] });
  // Runtime/verifier are deliberately unusable: Effect must not execute either.
  const controller = new Controller({ store, runtime: { start() { throw new Error("Effect is not Runtime"); } },
    verifier: { verify() { throw new Error("Effect is not Acceptance Evidence"); } }, effectDriver: driver, policyEngine });
  return { controller, driver, input: { id: "effect-2", commandId: command.id, destination: path.join(path.resolve(directory), "marker.json") } };
}

export function authorizeEffectCommand(store, controller) {
  const waiting = controller.authorizeCommand("command-2", 1);
  assert.equal(waiting.action, "WAIT");
  const pending = store.requestApproval({ id: "approval-2", targetType: "TASK", targetId: "t2", action: ACTION,
    capability: CAPABILITY, scope: "test-provider", riskLevel: "HIGH", requestedBy: "human-slice-2", commandId: "command-2" });
  store.decideApproval(pending.id, pending.version, { decision: "APPROVE", decidedBy: "human-slice-2" });
  const result = controller.authorizeCommand("command-2", 1, { approvalId: pending.id });
  assert.equal(result.action, "AUTHORIZE");
  return result.command;
}
