// Slice-only decoders; not a universal RuntimeResult schema or resolver.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createVerification } from "../../project-control/domain.mjs";
import { capsuleFingerprint } from "../../project-control/capsule-json.mjs";
import { workspaceRevision } from "../../project-control/workspace-manager.mjs";
const digest = s => createHash("sha256").update(s).digest("hex");
export function observeSemanticFiles(root) {
  const hashes = Object.fromEntries(["PROJECT_BLUEPRINT.md", "package.json"].map(f => [f, digest(fs.readFileSync(path.join(root, f)))]));
  return { marker: "G8_SUBSTITUTION_V1", cwd: root, hashes, workspaceRevision: workspaceRevision(root),
    ok: fs.readFileSync(path.join(root, "PROJECT_BLUEPRINT.md"), "utf8").includes("Project Control OS") && JSON.parse(fs.readFileSync(path.join(root, "package.json"))).type === "module" };
}
export function decodeSemanticResult(result) {
  const d = result.details;
  if (result.runtimeRef.runtimeKind === "local-process") {
    if (d.exitCode !== 0 || d.signal !== null || d.stderr !== "") throw new Error("invalid process outcome");
    return { value: JSON.parse(d.stdout.trim()), revision: digest(d.stdout + "\0" + d.stderr + "\0" + String(d.exitCode)) };
  }
  if (result.runtimeRef.runtimeKind === "dsh-workflow") {
    if (d.stopReason !== "completed" || d.error !== null) throw new Error("invalid workflow outcome");
    return { value: structuredClone(d.value), revision: digest(JSON.stringify(d.value) + "\0" + d.stopReason) };
  }
  throw new Error("unsupported test decoder");
}
export function substitutionVerifier({ store, root, results, facts }) {
  return { verify({ task, acceptance, evidence, run }) {
    let checks = {}, error = null, semantic = null;
    try {
      const result = results.get(evidence.contentRef), attempt = store.getAttempt(evidence.attemptId);
      const capsule = store.getRecord("context_capsule", attempt.capsuleDelivery.capsuleId);
      const receipt = attempt.capsuleDelivery.observations.find(o => o.status === "RECEIVED")?.receipt;
      const decoded = decodeSemanticResult(result), c = acceptance.criteria[0]; semantic = decoded.value;
      checks = {
        outcome: result.outcome === "COMPLETED",
        semantic: semantic.ok === true && semantic.marker === c.expectedMarker && capsuleFingerprint(semantic.hashes) === capsuleFingerprint(c.expectedHashes),
        reality: path.resolve(semantic.cwd) === root && semantic.workspaceRevision === c.workspaceRevision && workspaceRevision(root) === c.workspaceRevision,
        revision: decoded.revision === result.revision && result.revision === evidence.revision && attempt.resultRef === evidence.contentRef,
        lineage: run.taskId === task.id && attempt.runId === run.id && evidence.runId === run.id && evidence.taskId === task.id && task.acceptanceId === acceptance.id && task.acceptanceVersion === acceptance.version && evidence.acceptanceId === acceptance.id && evidence.acceptanceVersion === acceptance.version && capsule.projectId === task.projectId && capsule.taskId === task.id && capsule.runId === run.id && capsule.attemptId === attempt.id && capsuleFingerprint(result.runtimeRef) === capsuleFingerprint(attempt.runtimeRef),
        receipt: attempt.capsuleDelivery.status === "RECEIVED" && receipt?.capsuleId === capsule.id && receipt?.payloadHash === capsule.payloadHash && receipt?.projectId === task.projectId && receipt?.taskId === task.id && receipt?.runId === run.id && receipt?.attemptId === attempt.id && capsuleFingerprint(receipt?.runtimeRef) === capsuleFingerprint(attempt.runtimeRef),
      };
    } catch (e) { error = e.message; }
    const verdict = !error && Object.keys(checks).length === 6 && Object.values(checks).every(Boolean) ? "PASS" : "FAIL";
    facts.push({ checks, error, semantic, verdict });
    return createVerification({ id: `substitution-verification-${randomUUID()}`, taskId: task.id, acceptanceId: acceptance.id, acceptanceVersion: acceptance.version, evidenceIds: [evidence.id], revision: evidence.revision, verdict });
  } };
}
