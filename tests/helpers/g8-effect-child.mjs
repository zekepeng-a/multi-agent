// Effect-only restart, no Runtime, Task execution, or child barrier.
import { SqliteStore } from "../../project-control/sqlite-store.mjs";
import { seedEffectWorld, effectController, authorizeEffectCommand } from "./g8-effect-fixture.mjs";
const [mode, database, directory] = process.argv.slice(2);
const store = new SqliteStore(database);
try {
  if (mode === "lose-response") seedEffectWorld(store);
  const { controller, driver, input } = effectController(store, directory, { database, modes: ["after-write"] });
  let result;
  if (mode === "lose-response") {
    authorizeEffectCommand(store, controller);
    result = await controller.dispatchEffect(input, { mutationId: "slice2:dispatch" });
  } else if (mode === "reconcile") {
    const before = store.getEffect(input.id);
    result = await controller.reconcileEffect(before.id, before.version, { mutationId: "slice2:reconcile" });
  } else throw new Error("unsupported Effect child operation");
  console.log(JSON.stringify({ result, dispatchCalls: driver.dispatchCalls, writes: driver.writes,
    observations: driver.observations, events: store.allEvents() }));
} finally { store.close(); }
