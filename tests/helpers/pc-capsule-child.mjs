import fs from "node:fs";
import { SqliteStore } from "../../project-control/sqlite-store.mjs";
import { createContextCapsule } from "../../project-control/domain.mjs";
import { CapsuleInputRefusedError } from "../../project-control/capsule-receipt.mjs";
import { capsules, seedCapsuleFixture, generate, reserve, dispatch, generateInput, fileWorkspaceObserver } from "./pc-capsule-fixture.mjs";

const [mode, database, artifact, tag, barrierTimeout = "10000"] = process.argv.slice(2);
async function awaitBarrier() {
  const timeoutMs = Number(barrierTimeout);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("invalid Capsule writer barrier timeout");
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(`${artifact}.go`)) {
    if (Date.now() >= deadline) throw new Error(`writer ${tag} Capsule barrier deadline exceeded`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
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
    console.log(JSON.stringify({ record, attempt: store.getAttempt("cat"), run: store.getRun("cr"), events: store.allEvents(),
      observationReplay: store.getCommand("dispatch-1:observation"), replayAddedEvents: store.allEvents().length - before }));
  }
  if (["refuse-crash", "refuse-commit"].includes(mode)) {
    store.updateAttempt("cat", { status: "RUNNING" });
    control.runtime.start = async () => {
      fs.appendFileSync(`${artifact}.refusal-calls`, "call\n");
      throw new CapsuleInputRefusedError("trusted Adapter refused input before execution");
    };
    if (mode === "refuse-crash") {
      const updateRun = store.updateRun.bind(store);
      store.updateRun = (...args) => {
        if (args[2]?.status === "FAILED") {
          // Interrupt at the old defect window: delivery/event have been written,
          // Run termination has not. The new implementation has not committed.
          if (store.getAttempt("cat").capsuleDelivery.status !== "NOT_RECEIVED") throw new Error("missing refusal write");
          fs.writeFileSync(`${artifact}.refusal-window`, "interrupted before Run termination");
          process.exit(77); // Deliberately bypass close/finally, like process death.
        }
        return updateRun(...args);
      };
    }
    await dispatch(control);
    process.exit(78); // Committed, but caller did not receive a return/ack.
  }
  if (["snapshot-put", "snapshot-insert"].includes(mode)) {
    const archived = control.history("capsule-1");
    const record = createContextCapsule({ id: "writer-capsule", payload: { ...archived.payload, capsuleId: "writer-capsule", assemblerVersion: tag } });
    fs.writeFileSync(`${artifact}.${tag}.ready`, "ready");
    await awaitBarrier();
    let won = false, error = null;
    try {
      if (mode === "snapshot-put") { store.putRecord("context_capsule", record.id, record); won = true; }
      else { won = store.insertRecord("context_capsule", record.id, record); if (!won) error = "CapsuleId conflict"; }
    } catch (e) { error = e.message; }
    console.log(JSON.stringify({ won, error, tag, payloadHash: record.payloadHash }));
  }
  if (mode === "try-dispatch") {
    let error = null; try { reserve(control); } catch (e) { error = e.message; }
    console.log(JSON.stringify({ error, calls: control.runtime.started.length }));
  }
  if (mode === "replay-dispatch") {
    const result = await dispatch(control);
    console.log(JSON.stringify({ replay: result.replay, calls: control.runtime.started.length }));
  }
  if (mode === "race") {
    // Both writers start only when the parent opens this barrier.
    fs.writeFileSync(`${artifact}.${tag}.ready`, "ready");
    await awaitBarrier();
    let won = false, error = null;
    try {
      const result = await control.dispatch({ capsuleId: generateInput.id, attemptId: "cat", expectedDeliveryVersion: 1 }, { commandId: `race:${tag}` });
      won = result.dispatched;
    } catch (e) { error = e.message; }
    console.log(JSON.stringify({ won, error, calls: control.runtime.started.length }));
  }
} finally { store.close(); }
