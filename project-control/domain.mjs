export const ProjectStatus = Object.freeze({
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  COMPLETED: "COMPLETED",
  ARCHIVED: "ARCHIVED",
});

export const MilestoneStatus = Object.freeze({
  DRAFT: "DRAFT",
  READY: "READY",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  BLOCKED: "BLOCKED",
  CANCELLED: "CANCELLED",
});

export const GoalStatus = Object.freeze({
  DRAFT: "DRAFT",
  READY: "READY",
  IN_PROGRESS: "IN_PROGRESS",
  BLOCKED: "BLOCKED",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
});

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

/**
 * Minimal Project record, following canonical architecture §5.1. It is the
 * lifecycle root: the Controller aggregates Milestone state into it, and
 * everything below references a project by id.
 */
export function createProject({
  id,
  name,
  description = "",
  status = ProjectStatus.ACTIVE,
  currentRevision = null,
  metadata = {},
} = {}) {
  if (!id || !name) throw new Error("id and name are required");
  return {
    id,
    version: 1,
    name,
    description,
    status,
    currentRevision,
    metadata,
    createdAt: now(),
    updatedAt: now(),
  };
}

/**
 * A bounded stage inside a Project.
 *
 * Canonical architecture models a Milestone as belonging to a Roadmap. Roadmap
 * has no lifecycle in v0.1, so the Milestone carries an explicit `projectId`
 * parent link (`roadmapId` stays for when Roadmap lands). Parentage is always an
 * explicit field — nothing is ever inferred from names or titles.
 */
export function createMilestone({
  id,
  projectId = "project-1",
  roadmapId = null,
  name,
  description = "",
  status = MilestoneStatus.READY,
  goalIds = [],
  acceptanceId = null,
} = {}) {
  if (!id || !name) throw new Error("id and name are required");
  return {
    id,
    projectId,
    roadmapId,
    version: 1,
    name,
    description,
    status,
    goalIds: [...goalIds],
    acceptanceId,
    createdAt: now(),
    updatedAt: now(),
  };
}

/**
 * A meaningful project outcome. A Goal aggregates Tasks; it is not an
 * implementation step.
 */
export function createGoal({
  id,
  projectId = "project-1",
  milestoneId = null,
  title,
  description = "",
  status = GoalStatus.READY,
  taskIds = [],
  acceptanceId = null,
} = {}) {
  if (!id || !title) throw new Error("id and title are required");
  return {
    id,
    projectId,
    milestoneId,
    version: 1,
    title,
    description,
    status,
    taskIds: [...taskIds],
    acceptanceId,
    createdAt: now(),
    updatedAt: now(),
  };
}

export function createTask({
  id,
  projectId = "project-1",
  goalId = null,
  title,
  acceptanceId,
  acceptanceVersion,
  status = TaskStatus.READY,
} = {}) {
  if (!id || !title || !acceptanceId || !acceptanceVersion) {
    throw new Error("id, title, acceptanceId and acceptanceVersion are required");
  }
  return {
    id,
    projectId,
    // The Goal this task belongs to. It is an EXPLICIT optional parent link:
    // tasks created before goals existed, or deliberately unattached, carry null,
    // and nothing resolves a task to a goal by guessing.
    goalId,
    title,
    acceptanceId,
    // The contract revision this task is pinned to. It is fixed when the task is
    // created and must never follow the acceptance object's current version.
    acceptanceVersion,
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
  if (!id || !taskId || !runId || !attemptId || !acceptanceId || !acceptanceVersion) {
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
  taskId,
  acceptanceId,
  acceptanceVersion,
  evidenceIds,
  verdict,
  revision = null,
} = {}) {
  if (!id || !taskId || !acceptanceId || !evidenceIds?.length || !verdict) {
    throw new Error("verification identity is incomplete");
  }
  return {
    id,
    taskId,
    acceptanceId,
    acceptanceVersion,
    evidenceIds,
    verdict,
    revision,
    createdAt: now(),
  };
}
