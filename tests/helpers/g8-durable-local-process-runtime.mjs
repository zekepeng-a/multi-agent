// Slice-only provider-owned completed-result files; not an Artifact domain/store.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { LocalProcessRuntimeAdapter } from "../../project-control/local-process-runtime.mjs";
import { createRuntimeResult } from "../../project-control/runtime-adapter.mjs";
import { canonicalCapsuleJson as canonical, capsuleFingerprint } from "../../project-control/capsule-json.mjs";

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const resultSchema = "g8-local-result-v1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const requireFact = (ok, message) => { if (!ok) throw new Error(message); };

export function encodeResultArtifact(content) {
  const revision = sha256(Buffer.from(canonical(content), "utf8"));
  const bytes = Buffer.from(canonical({ schema: resultSchema, content, revision }), "utf8");
  return { bytes, revision, hash: sha256(bytes) };
}

export function persistResultArtifact(directory, content) {
  requireFact(uuid.test(content.runtimeRef?.externalId), "invalid result identity");
  const target = path.join(path.resolve(directory), `${content.runtimeRef.externalId}.json`);
  const artifact = encodeResultArtifact(content);
  try { fs.writeFileSync(target, artifact.bytes, { flag: "wx" }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    // Exact completed collection replay may read existing bytes; never overwrite.
    requireFact(fs.lstatSync(target).isFile() && fs.readFileSync(target).equals(artifact.bytes), "immutable result identity conflict");
  }
  return { ...artifact, resultRef: `${pathToFileURL(target).href}#sha256=${artifact.hash}` };
}

export function resolveRuntimeResult(directory, resultRef, expected) {
  const root = path.resolve(directory), externalId = expected.runtimeRef?.externalId;
  requireFact(uuid.test(externalId), "invalid expected RuntimeRef identity");
  const target = path.join(root, `${externalId}.json`), uri = new URL(resultRef);
  requireFact(/^#sha256=[0-9a-f]{64}$/.test(uri.hash), "resultRef requires an artifact hash pin");
  requireFact(uri.href === `${pathToFileURL(target).href}${uri.hash}`, "resultRef outside provider root or wrong result identity");
  requireFact(fs.lstatSync(root).isDirectory() && fs.realpathSync(root) === root, "invalid provider root");
  requireFact(fs.lstatSync(target).isFile() && fs.realpathSync(target) === target, "result artifact must be a regular provider file");
  const bytes = fs.readFileSync(target), artifactHash = sha256(bytes);
  requireFact(artifactHash === uri.hash.slice(8), "artifact hash mismatch");
  const artifact = JSON.parse(bytes.toString("utf8"));
  requireFact(canonical(artifact) === bytes.toString("utf8"), "noncanonical result artifact");
  requireFact(canonical(Object.keys(artifact).sort()) === canonical(["content", "revision", "schema"]), "invalid artifact envelope");
  requireFact(artifact.schema === resultSchema, "unsupported result schema");
  const c = artifact.content;
  const keys = ["attemptId", "capsuleId", "completedAt", "error", "exitCode", "outcome", "payloadHash", "processFingerprint", "runId", "runtimeRef", "signal", "stderr", "stdout"];
  requireFact(c && canonical(Object.keys(c).sort()) === canonical(keys), "invalid result content schema");
  requireFact(["COMPLETED", "FAILED", "CANCELLED"].includes(c.outcome) &&
    (c.exitCode === null || Number.isInteger(c.exitCode)) && (c.signal === null || typeof c.signal === "string") &&
    typeof c.stdout === "string" && typeof c.stderr === "string" && (c.error === null || typeof c.error === "string") &&
    typeof c.completedAt === "string" && Number.isFinite(Date.parse(c.completedAt)), "invalid result fields");
  requireFact(capsuleFingerprint(c.runtimeRef) === capsuleFingerprint(expected.runtimeRef), "RuntimeRef mismatch");
  for (const key of ["runId", "attemptId", "capsuleId", "payloadHash", "processFingerprint"]) {
    requireFact(typeof c[key] === "string" && c[key] === expected[key], `result ${key} lineage mismatch`);
  }
  const revision = sha256(Buffer.from(canonical(c), "utf8"));
  requireFact(artifact.revision === revision && revision === expected.revision, "result revision mismatch");
  return { ...createRuntimeResult({ outcome: c.outcome, runtimeRef: c.runtimeRef, resultRef, revision,
    completedAt: c.completedAt, details: { exitCode: c.exitCode, signal: c.signal, stdout: c.stdout, stderr: c.stderr, error: c.error } }),
    artifactHash, artifactContent: c };
}

export class DurableLocalProcessRuntime extends LocalProcessRuntimeAdapter {
  constructor({ resultDirectory, ...options }) { super(options); this.resultDirectory = path.resolve(resultDirectory); }
  async start(input) {
    const started = await super.start(input), execution = this.executions.get(started.runtimeRef.externalId);
    execution.durableBinding = { runId: input.run.id, attemptId: input.attempt.id,
      capsuleId: input.contextCapsule.capsuleId, payloadHash: input.capsuleBinding.payloadHash,
      processFingerprint: capsuleFingerprint(input.launchConfig.process) };
    execution.closed = new Promise(resolve => {
      const cleanupDeadline = setTimeout(() => {
        execution.child.kill("SIGKILL");
        execution.child.stdout?.destroy(); execution.child.stderr?.destroy(); execution.child.unref();
        resolve(false); // Explicit close uncertainty; never claim a result archive.
      }, 7000);
      execution.child.once("close", () => { clearTimeout(cleanupDeadline); resolve(true); });
    });
    // Test-owned Node child only; deadline remains active until close.
    execution.deadline = setTimeout(() => execution.child.kill("SIGKILL"), 5000);
    execution.child.once("close", () => clearTimeout(execution.deadline));
    return started;
  }
  async collectResult(ref) {
    const execution = this.executions.get(ref.externalId);
    if (!execution) throw new Error("no live result collection; use durable resolver for completed history");
    const result = await Promise.race([super.collectResult(ref), execution.closed.then(closed => {
      requireFact(closed, "Runtime child close deadline exceeded");
      return super.collectResult(ref);
    })]);
    requireFact(await execution.closed, "Runtime child close deadline exceeded"); // Drain stdout/stderr before archive.
    const content = { ...execution.durableBinding, runtimeRef: result.runtimeRef, outcome: result.outcome,
      exitCode: execution.exitCode, signal: execution.signal, stdout: execution.stdout, stderr: execution.stderr,
      error: result.details.error, completedAt: result.completedAt };
    const archived = persistResultArtifact(this.resultDirectory, content);
    return createRuntimeResult({ ...result, resultRef: archived.resultRef, revision: archived.revision,
      details: { ...result.details, stdout: execution.stdout, stderr: execution.stderr } });
  }
}
