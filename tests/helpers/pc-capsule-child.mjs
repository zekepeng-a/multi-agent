import fs from "node:fs";
import { SqliteStore } from "../../project-control/sqlite-store.mjs";
import { capsules, seedCapsuleFixture, generate, reserve, dispatch, generateInput, fileWorkspaceObserver } from "./pc-capsule-fixture.mjs";

const [mode, database, artifact, tag] = process.argv.slice(2);
const store = new SqliteStore(database);
const control = capsules(store, { observeWorkspace: fileWorkspaceObserver(artifact) });
try {
  if (mode === "prepare") { seedCapsuleFixture(store, artifact); generate(control); }
  if (mode === "receive") await dispatch(control);
  if (mode === "intent") reserve(control);
  if (mode === "recover") control.recoverInterruptedDispatch("cat", { commandId: "recover:process" });
  if (mode === "read") {
    const before = store.allEvents().length;
    const record = generate(control); // Exact persisted replay, even if no longer usable.
    console.log(JSON.stringify({ record, attempt: store.getAttempt("cat"), events: store.allEvents(), replayAddedEvents: store.allEvents().length - before }));
  }
  if (mode === "try-dispatch") {
    let error = null; try { reserve(control); } catch (e) { error = e.message; }
    console.log(JSON.stringify({ error, calls: control.runtime.started.length }));
  }
  if (mode === "race") {
    // Both writers start only when the parent opens this barrier.
    fs.writeFileSync(`${artifact}.${tag}.ready`, "ready");
    while (!fs.existsSync(`${artifact}.go`)) await new Promise(resolve => setTimeout(resolve, 10));
    let won = false, error = null;
    try {
      const result = await control.dispatch({ capsuleId: generateInput.id, attemptId: "cat", expectedDeliveryVersion: 1 }, { commandId: `race:${tag}` });
      won = result.dispatched;
    } catch (e) { error = e.message; }
    console.log(JSON.stringify({ won, error, calls: control.runtime.started.length }));
  }
} finally { store.close(); }
