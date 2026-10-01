import path from "node:path";
import { randomUUID } from "node:crypto";
import { createVerification } from "../../project-control/domain.mjs";
import { capsuleFingerprint } from "../../project-control/capsule-json.mjs";
import { workspaceRevision } from "../../project-control/workspace-manager.mjs";
import { resolveRuntimeResult } from "./g8-durable-local-process-runtime.mjs";

export function durableResultVerifier({ store, root, resultDirectory, reviewRequired = false, facts = [] }) {
  return { verify({ acceptance, evidence, task, run }) {
    let checks = {}, error = null;
    try {
      const attempt = store.getAttempt(evidence.attemptId), criterion = acceptance.criteria[0];
      const capsule = store.getRecord("context_capsule", attempt.capsuleDelivery.capsuleId);
      const receipt = attempt.capsuleDelivery.observations.find(o => o.status === "RECEIVED")?.receipt;
      if (attempt.resultRef !== evidence.contentRef) throw new Error("Evidence/Attempt resultRef mismatch");
      const result = resolveRuntimeResult(resultDirectory, evidence.contentRef, { runtimeRef: attempt.runtimeRef,
        runId: run.id, attemptId: attempt.id, capsuleId: capsule.id, payloadHash: capsule.payloadHash,
        processFingerprint: criterion.processFingerprint, revision: evidence.revision });
      const output = JSON.parse(result.details.stdout.trim());
      checks = {
        exit: result.outcome === "COMPLETED" && result.details.exitCode === 0 && result.details.signal === null && result.details.stderr === "",
        output: output.marker === criterion.expectedMarker && output.ok === true && path.resolve(output.cwd) === path.resolve(root) &&
          capsuleFingerprint(output.hashes) === capsuleFingerprint(criterion.expectedHashes),
        reality: workspaceRevision(root) === criterion.workspaceRevision,
        lineage: run.taskId === task.id && attempt.runId === run.id && evidence.taskId === task.id &&
          evidence.acceptanceId === acceptance.id && evidence.acceptanceVersion === acceptance.version &&
          capsule.attemptId === attempt.id && capsule.runId === run.id && capsule.taskId === task.id &&
          capsule.projectId === task.projectId && attempt.capsuleDelivery.status === "RECEIVED",
        input: receipt?.capsuleId === capsule.id && receipt?.payloadHash === capsule.payloadHash &&
          receipt?.attemptId === attempt.id && capsuleFingerprint(receipt?.runtimeRef) === capsuleFingerprint(attempt.runtimeRef),
      };
    } catch (e) { error = e.message; }
    const valid = error === null && Object.values(checks).length === 5 && Object.values(checks).every(Boolean);
    const verdict = !valid ? "FAIL" : reviewRequired ? "INCONCLUSIVE" : "PASS";
    const reason = valid && reviewRequired ? "requires independent durable-result reproof" : error;
    facts.push({ evidenceId: evidence.id, checks, verdict, reason });
    return createVerification({ id: `durable-verification-${randomUUID()}`, taskId: task.id, acceptanceId: acceptance.id,
      acceptanceVersion: acceptance.version, evidenceIds: [evidence.id], revision: evidence.revision, verdict });
  } };
}
