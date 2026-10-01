import path from "node:path";
import { SqliteStore } from "../../project-control/sqlite-store.mjs";
import { durableLiveSlice, freshResultController } from "./g8-durable-result-fixture.mjs";
const [mode, database, root, resultDirectory] = process.argv.slice(2);
const store = new SqliteStore(database);
try {
  let result, runtime, facts, resultMapSize = null;
  if (mode === "checkpoint") {
    const slice = durableLiveSlice({ store, root, resultDirectory, isolationRoot: path.join(path.dirname(database), "overlays"), reviewRequired: true });
    slice.approve(); slice.authorize(); result = await slice.execute();
    runtime = slice.runtime; facts = slice.verifierFacts; resultMapSize = slice.results.size;
  } else if (mode === "reprove") {
    const fresh = freshResultController({ store, root, resultDirectory });
    runtime = fresh.runtime; facts = fresh.facts;
    const before = store.allEvents().length;
    result = await fresh.controller.reconcileTask("g8-task");
    const after = store.allEvents().length;
    const replay = await fresh.controller.reconcileTask("g8-task");
    if (result.action === "ACCEPT" && (replay.action !== "NOOP" || store.allEvents().length !== after)) throw new Error("terminal replay changed history");
    result = { ...result, replayAction: replay.action, addedEvents: after - before };
  } else throw new Error("unsupported durable-result child mode");
  console.log(JSON.stringify({ result, runtimeMapSize: runtime.executions.size, startCalls: runtime.startCalls,
    resultMapSize, facts, runs: store.allRecords("run"), attempts: store.allRecords("attempt"),
    evidence: store.allRecords("evidence"), verifications: store.allRecords("verification"), events: store.allEvents() }));
} finally { store.close(); }
