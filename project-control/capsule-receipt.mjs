import { canonicalCapsuleJson, capsuleHash } from "./capsule-json.mjs";

// Only an Adapter that refuses BEFORE execution may return this explicit fact.
export class CapsuleInputRefusedError extends Error {
  constructor(message) { super(message); this.name = "CapsuleInputRefusedError"; this.code = "CAPSULE_NOT_RECEIVED"; this.noExecution = true; }
}

export function acceptCapsuleInput({ run, attempt, contextCapsule, capsuleBinding }) {
  if (!capsuleBinding) return null; // Existing non-G7.4 paths retain their contract.
  try {
    const json = canonicalCapsuleJson(contextCapsule), binding = contextCapsule?.binding;
    if (!binding || capsuleHash(json) !== capsuleBinding.payloadHash || contextCapsule.capsuleId !== capsuleBinding.capsuleId ||
        run.id !== binding.runId || run.taskId !== binding.taskId || attempt.id !== binding.attemptId || attempt.runId !== run.id ||
        !["projectId", "taskId", "runId", "attemptId"].every(k => binding[k] === capsuleBinding[k])) throw new Error("mismatched Capsule input binding/hash");
    return { payloadJson: json, binding: structuredClone(capsuleBinding) };
  } catch (error) { throw new CapsuleInputRefusedError(error.message); }
}

export function capsuleReceipt(accepted, runtimeRef, receivedAt = new Date().toISOString()) {
  return accepted ? { ...accepted.binding, runtimeRef: structuredClone(runtimeRef), receivedAt } : null;
}
