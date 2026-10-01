// Test-owned, synchronous marker-only provider. Not Workspace or a provider library.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const markerHash = bytes => createHash("sha256").update(bytes).digest("hex");
export const ACTION = "external.marker.write";
export const CAPABILITY = "external.marker.create";

export class LocalFileEffectDriver {
  constructor({ directory, command, effectId = "effect-2", modes = ["success"], verifyDurableDispatch = () => {} }) {
    this.directory = path.resolve(directory);
    this.target = path.join(this.directory, "marker.json");
    this.command = structuredClone(command);
    this.effectId = effectId;
    this.modes = [...modes]; // Fault injection only; reconcile never reads modes/history.
    this.verifyDurableDispatch = verifyDurableDispatch;
    this.dispatchCalls = 0;
    this.writes = 0;
    this.observations = [];
    assert.ok(fs.lstatSync(this.directory).isDirectory());
  }

  expectedMarker() {
    const payload = JSON.stringify(this.command.parameters);
    return Buffer.from(JSON.stringify({ effectId: this.effectId, commandId: this.command.id,
      idempotencyKey: this.command.idempotencyKey, action: ACTION, capability: CAPABILITY,
      payload: this.command.parameters, payloadHash: markerHash(Buffer.from(payload)) }), "utf8");
  }

  matchesBinding(effect) {
    return effect.id === this.effectId && effect.commandId === this.command.id &&
      effect.action === ACTION && effect.capability === CAPABILITY &&
      this.command.action === ACTION && this.command.capability === CAPABILITY &&
      effect.idempotencyKey === this.command.idempotencyKey && effect.destination === this.target;
  }

  async dispatch(effect) {
    assert.equal(effect.status, "DISPATCHED");
    assert.ok(this.matchesBinding(effect), "provider input must match stored authorized intent");
    this.verifyDurableDispatch(effect); // Independent reader checks committed state before mutation.
    this.dispatchCalls++;
    const mode = this.modes.length > 1 ? this.modes.shift() : this.modes[0];
    if (mode === "before-write") throw new Error("lost response before synchronous marker creation");
    // This provider has exactly one possible external mutation. No queues,
    // delayed writes, rename/temp files, or other actors in its isolated path.
    fs.writeFileSync(this.target, this.expectedMarker(), { flag: "wx" });
    this.writes++;
    assert.deepEqual(fs.readFileSync(this.target), this.expectedMarker());
    if (mode === "after-write") throw new Error("lost response after marker is externally readable");
    return this.reconcile(effect);
  }

  async reconcile(effect) {
    let observation;
    try {
      const entries = fs.readdirSync(this.directory).sort();
      const directoryRef = pathToFileURL(this.directory).href;
      if (!this.matchesBinding(effect)) {
        observation = { outcome: "UNKNOWN", observationRef: `${directoryRef}#binding-mismatch` };
      } else if (entries.length === 0) {
        // Positive non-occurrence only under this narrow synchronous,
        // isolated, marker-only provider contract; not arbitrary file absence.
        observation = { outcome: "CONFIRMED_NO_EFFECT", observationRef: `${directoryRef}#empty-marker-only-provider` };
      } else if (entries.length !== 1 || entries[0] !== "marker.json" || !fs.lstatSync(this.target).isFile()) {
        observation = { outcome: "UNKNOWN", observationRef: `${directoryRef}#unexpected-provider-shape` };
      } else {
        const bytes = fs.readFileSync(this.target), hash = markerHash(bytes);
        const observationRef = `${pathToFileURL(this.target).href}#sha256=${hash}`;
        observation = bytes.equals(this.expectedMarker())
          ? { outcome: "CONFIRMED_SUCCEEDED", observationRef,
              receipt: { provider: "test-local-marker", receiptId: `sha256:${hash}`, resultRef: observationRef } }
          : { outcome: "UNKNOWN", observationRef };
      }
    } catch {
      observation = { outcome: "UNKNOWN", observationRef: `${pathToFileURL(this.directory).href}#unreadable` };
    }
    this.observations.push(structuredClone(observation)); // Audit only, never outcome input.
    return observation;
  }
}
