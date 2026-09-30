import { createHash } from "node:crypto";

// One representation is used for the archive, budget and Adapter input hash.
// No toJSON, getters, sparse arrays, non-finite values or live handles.
export function canonicalCapsuleJson(value) {
  const ancestors = new Set();
  function encode(v) {
    if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
    if (typeof v === "number" && Number.isFinite(v)) return JSON.stringify(v);
    if (typeof v !== "object" || ancestors.has(v)) throw new Error("Capsule requires finite, acyclic JSON");
    if (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) throw new Error("Capsule requires plain JSON");
    if (Object.getOwnPropertySymbols(v).length) throw new Error("Capsule cannot contain symbol keys");
    ancestors.add(v);
    let result;
    if (Array.isArray(v)) {
      if (Object.keys(v).length !== v.length) throw new Error("Capsule cannot contain sparse/decorated arrays");
      result = `[${Array.from({ length: v.length }, (_, i) => encode(data(v, String(i)))).join(",")}]`;
    } else result = `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${encode(data(v, k))}`).join(",")}}`;
    ancestors.delete(v);
    return result;
  }
  function data(v, k) {
    const descriptor = Object.getOwnPropertyDescriptor(v, k);
    if (!descriptor || !("value" in descriptor)) throw new Error("Capsule cannot contain accessors");
    return descriptor.value;
  }
  return encode(value);
}
export const capsuleHash = bytes => createHash("sha256").update(bytes, "utf8").digest("hex");
export const capsuleFingerprint = value => capsuleHash(canonicalCapsuleJson(value));
export const capsuleBytes = value => Buffer.byteLength(canonicalCapsuleJson(value), "utf8");
