export const TaskStatus = Object.freeze({
  DRAFT: "DRAFT",
  READY: "READY",
  IN_PROGRESS: "IN_PROGRESS",
  BLOCKED: "BLOCKED",
  NEEDS_REVIEW: "NEEDS_REVIEW",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
});

export const RunStatus = Object.freeze({
  CREATED: "CREATED",
  READY: "READY",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  BLOCKED: "BLOCKED",
  CANCELLED: "CANCELLED",
});

export const AttemptStatus = Object.freeze({
  CREATED: "CREATED",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  INTERRUPTED: "INTERRUPTED",
  LOST: "LOST",
  CANCELLED: "CANCELLED",
});

export const EvidenceStatus = Object.freeze({
  CANDIDATE: "CANDIDATE",
  VERIFIED: "VERIFIED",
  ACCEPTED: "ACCEPTED",
  STALE: "STALE",
  SUPERSEDED: "SUPERSEDED",
});

export const VerificationVerdict = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  INCONCLUSIVE: "INCONCLUSIVE",
});

/**
 * Reconciliation outcome for a Run blocked by a LOST Attempt.
 *
 * This is an **observation** vocabulary, not an execution one:
 * - only a `confirmed_*` outcome may legitimize a later state transition
 * - `confirmed_no_effect` means external work provably did not happen, so
 *   recovery may re-execute on a new Run
 * - `confirmed_completed` means external work already happened, so its result
 *   becomes Evidence and must never be re-executed
 * - `unknown` means the Controller must keep waiting; it must never repeat
 *   external work on a guess
 */
export const ReconcileOutcome = Object.freeze({
  CONFIRMED_NO_EFFECT: "confirmed_no_effect",
  CONFIRMED_COMPLETED: "confirmed_completed",
  UNKNOWN: "unknown",
});

export class ConflictError extends Error {
  constructor(message = "optimistic concurrency conflict") {
    super(message);
    this.name = "ConflictError";
    this.code = "CONFLICT";
  }
}

export class InvariantError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvariantError";
    this.code = "INVARIANT_VIOLATION";
  }
}

export function now() {
  return new Date().toISOString();
}

export function createTask({ id, projectId = "project-1", title, acceptanceId, status = TaskStatus.READY } = {}) {
  if (!id || !title || !acceptanceId) throw new Error("id, title and acceptanceId are required");
  return {
    id,
    projectId,
    title,
    acceptanceId,
    status,
    version: 1,
    currentRunId: null,
    latestEvidenceId: null,
    createdAt: now(),
    updatedAt: now(),
  };
}

export function createAcceptance({ id, targetId, criteria = [], version = 1 } = {}) {
  if (!id || !targetId) throw new Error("id and targetId are required");
  return {
    id,
    targetId,
    version,
    criteria,
    status: "PENDING",
    createdAt: now(),
    updatedAt: now(),
  };
}

export function createRun({ id, taskId, status = RunStatus.CREATED } = {}) {
  if (!id || !taskId) throw new Error("id and taskId are required");
  return {
    id,
    taskId,
    status,
    version: 1,
    attemptIds: [],
    currentAttemptId: null,
    createdAt: now(),
    updatedAt: now(),
  };
}

export function createAttempt({ id, runId, attemptNumber, status = AttemptStatus.CREATED } = {}) {
  if (!id || !runId || !attemptNumber) throw new Error("id, runId and attemptNumber are required");
  return {
    id,
    runId,
    attemptNumber,
    status,
    createdAt: now(),
    startedAt: null,
    endedAt: null,
    resultRef: null,
  };
}

export function createEvidence({
  id,
  taskId,
  runId,
  attemptId,
  acceptanceId,
  acceptanceVersion,
  revision = null,
  status = EvidenceStatus.CANDIDATE,
  contentRef = null,
} = {}) {
  if (!id || !taskId || !runId || !attemptId || !acceptanceId) {
    throw new Error("evidence identity is incomplete");
  }
  return {
    id,
    taskId,
    runId,
    attemptId,
    acceptanceId,
    acceptanceVersion,
    revision,
    status,
    contentRef,
    createdAt: now(),
  };
}

export function createVerification({
  id,
  acceptanceId,
  acceptanceVersion,
  evidenceIds,
  verdict,
  revision = null,
} = {}) {
  if (!id || !acceptanceId || !evidenceIds?.length || !verdict) {
    throw new Error("verification identity is incomplete");
  }
  return {
    id,
    acceptanceId,
    acceptanceVersion,
    evidenceIds,
    verdict,
    revision,
    createdAt: now(),
  };
}
