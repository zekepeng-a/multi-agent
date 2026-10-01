import fs from "node:fs";
import { SqliteStore } from "../../project-control/sqlite-store.mjs";
import { seedMemoryFixture, boundary, candidate, fact, acceptedFact, inferred, judgement, promote, fileObserver } from "./pc-memory-fixture.mjs";

const [mode, database, artifact, tag] = process.argv.slice(2);
const store = new SqliteStore(database);
const control = boundary(store, { observeReality: fileObserver(artifact) });
try {
  if (mode === "write") {
    seedMemoryFixture(store);
    const original = promote(control, candidate(store), "original");
    const replacement = promote(control, candidate(store, { content: "Scoped new decision rendering" }), "replacement", { supersedesMemoryId: "original", expectedVersion: 1 });
    const verified = promote(control, fact(store), "verified");
    const accepted = promote(control, acceptedFact(store), "accepted");
    promote(control, inferred(store), "inferred");
    promote(control, candidate(store), "withdrawn");
    control.withdraw("withdrawn", 1, "explicit human withdrawal", { commandId: "withdrawn-command" });
    fs.writeFileSync(`${database}.replay.json`, JSON.stringify({ original: original.args, replacement: replacement.args, verified: verified.args, accepted: accepted.args }));
  } else if (mode === "read") {
    const replays = JSON.parse(fs.readFileSync(`${database}.replay.json`, "utf8"));
    const before = store.allEvents().length;
    const replay = Object.fromEntries(Object.entries(replays).map(([name, args]) => [name, control.promote(args, { commandId: `promote:${args.id}` })]));
    const withdrawnReplay = control.withdraw("withdrawn", 1, "explicit human withdrawal", { commandId: "withdrawn-command" });
    for (const id of ["verified", "replacement"]) {
      if (store.getCommand(`reconcile-${id}`)) control.reconcile(id, 1, { commandId: `reconcile-${id}` });
    }
    process.stdout.write(JSON.stringify({ memories: store.allRecords("memory"), events: store.allEvents(),
      current: control.query({ projectId: "p" }), history: control.history({ projectId: "p", statuses: ["ACTIVE", "STALE", "SUPERSEDED"] }),
      replay, withdrawnReplay, replayAddedEvents: store.allEvents().length - before }));
  } else if (mode === "change-control") {
    store.revokeDecision("d", 1, { revokedBy: { type: "HUMAN", actorId: "human" }, reason: "human changed direction" });
    const task = store.getTask("t"); store.updateTask("t", task.version, { title: "version changed" });
  } else if (mode === "reconcile") {
    control.reconcile("verified", 1, { commandId: "reconcile-verified" });
    control.reconcile("replacement", 1, { commandId: "reconcile-replacement" });
  } else if (mode === "race") {
    const input = candidate(store, { content: `Independent replacement ${tag}` });
    const attestation = control.validate(input, { judgement: judgement(input) });
    fs.writeFileSync(`${database}.${tag}.ready`, "ready");
    // The parent releases both writers only after both independently validate.
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(`${database}.release`)) {
      if (Date.now() > deadline) throw new Error("race barrier timeout");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    try {
      const record = control.promote({ id: tag, candidate: input, attestation, supersedesMemoryId: "race-source", expectedVersion: 1 }, { commandId: `race:${tag}` });
      process.stdout.write(JSON.stringify({ won: true, id: record.id }));
    } catch (error) {
      if (error.name !== "ConflictError") throw error;
      process.stdout.write(JSON.stringify({ won: false, error: error.message }));
    }
  } else throw new Error(`unknown mode ${mode}`);
} finally { store.close(); }
