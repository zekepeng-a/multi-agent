import { canonicalCapsuleJson, capsuleHash } from "./capsule-json.mjs";

export const CapsuleRole = Object.freeze({ REQUIRED: "REQUIRED", SUPPLEMENTAL: "SUPPLEMENTAL" });
export const CapsuleSourceType = Object.freeze(Object.fromEntries([
  "PROJECT", "MILESTONE", "GOAL", "TASK", "ACCEPTANCE", "DECISION", "MEMORY",
  "EVIDENCE", "VERIFICATION", "WORKSPACE", "REALITY", "POLICY", "POLICY_DECISION", "APPROVAL", "RUNTIME",
].map(type => [type, type])));
export const CapsuleDeliveryStatus = Object.freeze(Object.fromEntries([
  "PREPARED", "DISPATCHING", "RECEIVED", "NOT_RECEIVED", "UNKNOWN",
].map(status => [status, status])));

export function createContextCapsule({ id, payload }) {
  if (!id || payload?.capsuleId !== id) throw new InvariantError("Capsule requires independent matching identity");
  for (const key of ["projectId", "taskId", "runId", "attemptId"]) {
    if (typeof payload.binding?.[key] !== "string" || !payload.binding[key]) throw new InvariantError("Capsule requires full execution binding");
  }
  const payloadJson = canonicalCapsuleJson(payload);
  return { id, ...payload.binding, payloadJson, payloadHash: capsuleHash(payloadJson),
    byteLength: Buffer.byteLength(payloadJson, "utf8"), schemaVersion: payload.schemaVersion,
    assemblerVersion: payload.assemblerVersion, profileVersion: payload.profile.version,
    createdAt: payload.generatedAt };
}

// ADR-0008 vocabulary. These labels confer no Acceptance or permission authority.
export const MemoryType = Object.freeze({ FACT: "FACT", DECISION: "DECISION", CONSTRAINT: "CONSTRAINT", LESSON: "LESSON" });
export const MemoryConfidence = Object.freeze({ VERIFIED: "VERIFIED", ACCEPTED: "ACCEPTED", INFERRED: "INFERRED" });
export const MemoryStatus = Object.freeze({ ACTIVE: "ACTIVE", STALE: "STALE", SUPERSEDED: "SUPERSEDED" });
export const MemorySourceType = Object.freeze({ DECISION: "DECISION", EVIDENCE: "EVIDENCE", VERIFICATION: "VERIFICATION", PROJECT_STATE: "PROJECT_STATE" });
export const MemorySourceValidity = Object.freeze({ CURRENT: "CURRENT", INVALID: "INVALID", UNRESOLVED: "UNRESOLVED" });
export const MemoryStalenessKind = Object.freeze({ SOURCE_INVALIDATION: "SOURCE_INVALIDATION", HUMAN_WITHDRAWAL: "HUMAN_WITHDRAWAL" });

// Called only after the trusted control boundary has proved the candidate.
export function createMemory({ id, candidate, validation, promotedBy, observations, supersedesMemoryId = null }) {
  if (typeof id !== "string" || !id.trim()) throw new InvariantError("Memory requires a new MemoryId");
  if (!candidate?.projectId || !Object.values(MemoryType).includes(candidate.type) || !Object.values(MemoryConfidence).includes(candidate.confidence)) throw new InvariantError("Memory requires valid domain meaning");
  if (promotedBy?.type !== "CONTROL_PLANE" || !promotedBy.actorId || validation?.result !== "VALIDATED") throw new InvariantError("Memory requires Control Plane promotion and validation provenance");
  const timestamp = now();
  return structuredClone({ ...candidate, id, version: 1, status: MemoryStatus.ACTIVE,
    validation, promotedBy, promotionObservations: observations, supersedesMemoryId,
    supersededByMemoryId: null, staleness: null, createdAt: timestamp, updatedAt: timestamp });
}

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

/**
 * An Approval that may not authorize anything, with the reason as data.
 *
 * It extends InvariantError because it IS a rule violation — the caller asked
 * for authorization and the control plane refused, fail closed. It carries the
 * machine-readable `approvalReason` so a caller never has to parse a message to
 * learn WHY: an approval that was never decided, one whose target moved, one
 * that was revoked, and one that expired are four different operational facts.
 */
export class ApprovalError extends InvariantError {
  constructor(reason, message) {
    super(message);
    this.name = "ApprovalError";
    this.code = "APPROVAL_NOT_USABLE";
    this.approvalReason = reason;
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
  acceptanceId = null,
  acceptanceVersion = null,
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
    acceptanceId,
    acceptanceVersion,
    createdAt: now(),
    updatedAt: now(),
  };
}

/**
 * A bounded stage inside a Project.
 *
 * Canonical architecture models a Milestone as belonging to a Roadmap. Roadmap
 * has no lifecycle in v0.1, so the Milestone carries an explicit `projectId`
 * parent link. Parentage is always an explicit child-side field — nothing is ever
 * inferred from names or titles.
 *
 * `roadmapId` is a FUTURE field: no lifecycle, no aggregation, not consulted by
 * the Controller.
 *
 * `goalIds` is DERIVED / CACHED / NON-AUTHORITATIVE. The relationship fact is
 * `Goal.milestoneId`; this list is a convenience view that this version does not
 * maintain and must never be used to decide who belongs to the milestone.
 *
 * `acceptanceId` + `acceptanceVersion` are a PINNED contract revision, exactly
 * like a Task's: a milestone that declares an acceptance contract must pin the
 * revision it was accepted against, so it can never drift onto a newer one.
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
  acceptanceVersion = null,
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
    acceptanceVersion,
    createdAt: now(),
    updatedAt: now(),
  };
}

/**
 * A meaningful project outcome. A Goal aggregates Tasks; it is not an
 * implementation step.
 *
 * `taskIds` is DERIVED / CACHED / NON-AUTHORITATIVE. The relationship fact is
 * `Task.goalId`; this list is a convenience view that this version does not
 * maintain and must never be used to decide who belongs to the goal.
 *
 * `acceptanceId` + `acceptanceVersion` are a PINNED contract revision: a goal
 * that declares an acceptance contract must pin the revision it was accepted
 * against, so it can never drift onto a newer one.
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
  acceptanceVersion = null,
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
    acceptanceVersion,
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

/**
 * What an Acceptance Contract (and the Evidence and Verification that serve it)
 * is about. A contract is bound to exactly one target identity, so the same
 * acceptance id can never be read as covering a task AND a goal.
 */
export const AcceptanceTargetType = Object.freeze({
  TASK: "TASK",
  GOAL: "GOAL",
  MILESTONE: "MILESTONE",
  PROJECT: "PROJECT",
});

export function createAcceptance({
  id,
  targetType = AcceptanceTargetType.TASK,
  targetId,
  criteria = [],
  version = 1,
} = {}) {
  if (!id || !targetId) throw new Error("id and targetId are required");
  if (!Object.values(AcceptanceTargetType).includes(targetType)) {
    throw new Error(`unknown acceptance target type: ${targetType}`);
  }
  return {
    id,
    targetType,
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

export function createAttempt({
  id,
  runId,
  attemptNumber,
  status = AttemptStatus.CREATED,
  runtimeRef = null,
} = {}) {
  if (!id || !runId || !attemptNumber) throw new Error("id, runId and attemptNumber are required");
  return {
    id,
    runId,
    attemptNumber,
    status,
    // Opaque execution identity owned by the Runtime Adapter. It is persisted
    // for observation/recovery but never becomes RunId/AttemptId authority.
    runtimeRef: runtimeRef ? structuredClone(runtimeRef) : null,
    createdAt: now(),
    startedAt: null,
    endedAt: null,
    resultRef: null,
  };
}

/**
 * Evidence about a target.
 *
 * TASK evidence is a Runtime product: it carries the Run and Attempt that
 * produced it. GOAL / MILESTONE evidence is an AGGREGATE observation made by the
 * Control Plane from the current authoritative child state — it has no Run and no
 * Attempt, and it carries `sourceRefs`, the child snapshot it represents.
 */
export function createEvidence({
  id,
  targetType = AcceptanceTargetType.TASK,
  targetId,
  taskId = null,
  runId = null,
  attemptId = null,
  acceptanceId,
  acceptanceVersion,
  revision = null,
  status = EvidenceStatus.CANDIDATE,
  contentRef = null,
  sourceRefs = [],
  workspaceId = null,
  workspaceRevision = null,
} = {}) {
  const resolvedTargetId = targetId ?? taskId;
  if (!id || !resolvedTargetId || !acceptanceId || !acceptanceVersion) {
    throw new Error("evidence identity is incomplete");
  }
  if (targetType === AcceptanceTargetType.TASK && (!taskId || !runId || !attemptId)) {
    throw new Error("task evidence requires taskId, runId and attemptId");
  }
  if ((workspaceId == null) !== (workspaceRevision == null)) {
    throw new Error("workspace-bound evidence requires workspaceId and workspaceRevision together");
  }
  return {
    id,
    targetType,
    targetId: resolvedTargetId,
    taskId,
    runId,
    attemptId,
    acceptanceId,
    acceptanceVersion,
    revision,
    status,
    contentRef,
    sourceRefs: structuredClone(sourceRefs),
    workspaceId,
    workspaceRevision,
    createdAt: now(),
  };
}

export function createVerification({
  id,
  targetType = AcceptanceTargetType.TASK,
  targetId,
  taskId = null,
  acceptanceId,
  acceptanceVersion,
  evidenceIds,
  verdict,
  revision = null,
} = {}) {
  const resolvedTargetId = targetId ?? taskId;
  if (!id || !resolvedTargetId || !acceptanceId || !evidenceIds?.length || !verdict) {
    throw new Error("verification identity is incomplete");
  }
  if (targetType === AcceptanceTargetType.TASK && !taskId) {
    throw new Error("task verification requires taskId");
  }
  return {
    id,
    targetType,
    targetId: resolvedTargetId,
    taskId,
    acceptanceId,
    acceptanceVersion,
    evidenceIds,
    verdict,
    revision,
    createdAt: now(),
  };
}

// ── Durable Project Decision (G7.2) ─────────────────────────────────────────

export const DecisionAuthorityType = Object.freeze({
  HUMAN: "HUMAN",
  CONTROL_PLANE: "CONTROL_PLANE",
});

export const DecisionStatus = Object.freeze({
  ACTIVE: "ACTIVE",
  SUPERSEDED: "SUPERSEDED",
  REVOKED: "REVOKED",
});

export const DecisionSourceType = Object.freeze({
  HUMAN_INSTRUCTION: "HUMAN_INSTRUCTION",
  PROJECT_STATE: "PROJECT_STATE",
  EVIDENCE: "EVIDENCE",
  VERIFICATION: "VERIFICATION",
  POLICY_DECISION: "POLICY_DECISION",
  DECISION: "DECISION",
  EXTERNAL_REFERENCE: "EXTERNAL_REFERENCE",
});

const CONTROL_PLANE_DECISION_SOURCE_TYPES = Object.freeze([
  DecisionSourceType.PROJECT_STATE,
  DecisionSourceType.EVIDENCE,
  DecisionSourceType.VERIFICATION,
  DecisionSourceType.POLICY_DECISION,
  DecisionSourceType.DECISION,
]);

function validateDecisionActor(actor, label = "decidedBy") {
  if (!actor || !Object.values(DecisionAuthorityType).includes(actor.type)) {
    throw new Error(`${label} must be HUMAN or CONTROL_PLANE`);
  }
  if (typeof actor.actorId !== "string" || actor.actorId.trim() === "") {
    throw new Error(`${label} requires a non-empty actorId`);
  }
}

function validateDecisionSourceRefs(sourceRefs, authorityType) {
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) {
    throw new Error("decision requires non-empty sourceRefs");
  }
  for (const ref of sourceRefs) {
    if (!ref || !Object.values(DecisionSourceType).includes(ref.type)) {
      throw new Error(`decision source has unknown type: ${ref?.type}`);
    }
    if (typeof ref.id !== "string" || ref.id.trim() === "") {
      throw new Error("decision source requires a non-empty id");
    }
    if (ref.revision != null && (typeof ref.revision !== "string" || ref.revision.trim() === "")) {
      throw new Error("decision source revision must be a non-empty string when present");
    }
  }
  if (
    authorityType === DecisionAuthorityType.HUMAN &&
    !sourceRefs.some((ref) => ref.type === DecisionSourceType.HUMAN_INSTRUCTION)
  ) {
    throw new Error("a HUMAN decision must preserve HUMAN_INSTRUCTION provenance");
  }
  if (
    authorityType === DecisionAuthorityType.CONTROL_PLANE &&
    !sourceRefs.some((ref) => CONTROL_PLANE_DECISION_SOURCE_TYPES.includes(ref.type))
  ) {
    throw new Error("a CONTROL_PLANE decision requires authoritative control/evidence provenance");
  }
}

export function createDecision({
  id,
  projectId,
  title,
  rationale,
  alternatives = [],
  decidedBy,
  sourceRefs,
  supersedesDecisionId = null,
  status = DecisionStatus.ACTIVE,
  version = 1,
} = {}) {
  for (const [field, value] of Object.entries({ id, projectId, title, rationale })) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`decision requires a non-empty ${field}`);
    }
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("decision version must be a positive integer");
  }
  if (!Object.values(DecisionStatus).includes(status)) {
    throw new Error(`unknown decision status: ${status}`);
  }
  if (status !== DecisionStatus.ACTIVE) {
    throw new Error("a new decision must start ACTIVE");
  }
  if (!Array.isArray(alternatives)) {
    throw new Error("decision alternatives must be an array");
  }
  for (const alternative of alternatives) {
    if (!alternative || typeof alternative.description !== "string" || alternative.description.trim() === "") {
      throw new Error("decision alternative requires a non-empty description");
    }
    if (
      alternative.rejectedReason != null &&
      (typeof alternative.rejectedReason !== "string" || alternative.rejectedReason.trim() === "")
    ) {
      throw new Error("decision alternative rejectedReason must be a non-empty string when present");
    }
  }
  validateDecisionActor(decidedBy);
  validateDecisionSourceRefs(sourceRefs, decidedBy.type);
  if (
    supersedesDecisionId != null &&
    (typeof supersedesDecisionId !== "string" || supersedesDecisionId.trim() === "")
  ) {
    throw new Error("supersedesDecisionId must be a non-empty string when present");
  }

  return {
    id,
    version,
    projectId,
    title,
    rationale,
    alternatives: structuredClone(alternatives),
    decidedBy: structuredClone(decidedBy),
    status,
    sourceRefs: structuredClone(sourceRefs),
    supersedesDecisionId,
    supersededByDecisionId: null,
    revocation: null,
    createdAt: now(),
    updatedAt: now(),
  };
}

// ── Durable Workspace (G6 Reality/isolation boundary) ───────────────────────

export const WorkspaceKind = Object.freeze({
  SHARED: "SHARED",
  ISOLATED: "ISOLATED",
});

export const WorkspaceAccess = Object.freeze({
  READ_ONLY: "READ_ONLY",
  WRITE: "WRITE",
});

export const WorkspaceStatus = Object.freeze({
  CREATED: "CREATED",
  ACTIVE: "ACTIVE",
  DIRTY: "DIRTY",
  READY_TO_INTEGRATE: "READY_TO_INTEGRATE",
  INTEGRATED: "INTEGRATED",
  CONFLICTED: "CONFLICTED",
  DISCARDED: "DISCARDED",
});

export function createWorkspace({
  id,
  projectId,
  kind,
  access,
  owner = null,
  parentWorkspaceId = null,
  rootRef,
  baseRevision,
  currentRevision,
  writeScopes = [],
  status = WorkspaceStatus.CREATED,
  touchedPaths = {},
  integration = null,
  version = 1,
} = {}) {
  for (const [field, value] of Object.entries({ id, projectId, rootRef, baseRevision, currentRevision })) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`workspace requires a non-empty ${field}`);
    }
  }
  if (!Object.values(WorkspaceKind).includes(kind)) {
    throw new Error(`unknown workspace kind: ${kind}`);
  }
  if (!Object.values(WorkspaceAccess).includes(access)) {
    throw new Error(`unknown workspace access: ${access}`);
  }
  if (!Object.values(WorkspaceStatus).includes(status)) {
    throw new Error(`unknown workspace status: ${status}`);
  }
  if (!Array.isArray(writeScopes) || writeScopes.some((scope) => typeof scope !== "string")) {
    throw new Error("workspace writeScopes must be an array of strings");
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("workspace version must be a positive integer");
  }
  if (kind === WorkspaceKind.ISOLATED && (!parentWorkspaceId || typeof parentWorkspaceId !== "string")) {
    throw new Error("isolated workspace requires parentWorkspaceId");
  }

  return {
    id,
    version,
    projectId,
    kind,
    access,
    owner: owner ? structuredClone(owner) : { runId: null, attemptId: null },
    parentWorkspaceId,
    rootRef,
    baseRevision,
    currentRevision,
    writeScopes: [...writeScopes],
    status,
    touchedPaths: structuredClone(touchedPaths ?? {}),
    integration: integration ? structuredClone(integration) : {
      targetWorkspaceId: null,
      integratedRevision: null,
      conflictPaths: [],
      integratedAt: null,
    },
    createdAt: now(),
    updatedAt: now(),
  };
}

// ── Durable Effect (G3 external uncertainty boundary) ───────────────────────
//
// Effect is what may have happened in the external world. It is deliberately
// separate from Command intent, Evidence, Verification and Acceptance.

export const EffectStatus = Object.freeze({
  REQUESTED: "REQUESTED",
  DISPATCHED: "DISPATCHED",
  SUCCEEDED: "SUCCEEDED",
  FAILED_NO_EFFECT: "FAILED_NO_EFFECT",
  UNKNOWN: "UNKNOWN",
});

export const EffectReconciliationStatus = Object.freeze({
  NOT_REQUIRED: "NOT_REQUIRED",
  REQUIRED: "REQUIRED",
  IN_PROGRESS: "IN_PROGRESS",
  RESOLVED: "RESOLVED",
});

export const EffectObservation = Object.freeze({
  CONFIRMED_SUCCEEDED: "CONFIRMED_SUCCEEDED",
  CONFIRMED_NO_EFFECT: "CONFIRMED_NO_EFFECT",
  UNKNOWN: "UNKNOWN",
});

export function createEffect({
  id,
  projectId = null,
  commandId,
  action,
  capability,
  destination,
  idempotencyKey,
  status = EffectStatus.REQUESTED,
  version = 1,
  dispatchCount = 0,
  externalReceipt = null,
  reconciliation = null,
} = {}) {
  const required = { id, commandId, action, capability, destination, idempotencyKey };
  for (const [field, value] of Object.entries(required)) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`effect requires a non-empty ${field}`);
    }
  }
  if (!Object.values(EffectStatus).includes(status)) {
    throw new Error(`unknown effect status: ${status}`);
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("effect version must be a positive integer");
  }
  if (!Number.isInteger(dispatchCount) || dispatchCount < 0) {
    throw new Error("effect dispatchCount must be a non-negative integer");
  }

  return {
    id,
    version,
    projectId,
    commandId,
    action,
    capability,
    destination,
    idempotencyKey,
    status,
    dispatchCount,
    externalReceipt: externalReceipt ? structuredClone(externalReceipt) : {
      provider: null,
      receiptId: null,
      resultRef: null,
    },
    reconciliation: reconciliation ? structuredClone(reconciliation) : {
      status: EffectReconciliationStatus.NOT_REQUIRED,
      lastObservation: null,
      observationRef: null,
      reconciledAt: null,
    },
    createdAt: now(),
    updatedAt: now(),
  };
}

// ── Durable Command (G2 authorization boundary) ─────────────────────────────
//
// A Command is a durable control-plane intent. G2 deliberately implements only
// creation + authorization/rejection. Dispatch/execution/effect outcomes remain
// reserved for G3 and MUST NOT be written by current code.

export const CommandStatus = Object.freeze({
  CREATED: "CREATED",
  AUTHORIZED: "AUTHORIZED",
  REJECTED: "REJECTED",
  // Canonical future states. G2 store rules refuse transitions into them.
  DISPATCHED: "DISPATCHED",
  EXECUTING: "EXECUTING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  UNKNOWN: "UNKNOWN",
});

export const CommandTargetType = Object.freeze({
  PROJECT: "PROJECT",
  MILESTONE: "MILESTONE",
  GOAL: "GOAL",
  TASK: "TASK",
});

const REQUIRED_COMMAND_FIELDS = Object.freeze([
  "id",
  "targetId",
  "action",
  "capability",
  "scope",
  "requestedBy",
  "idempotencyKey",
]);

/**
 * Creates one immutable requested action. The caller must supply the target
 * version already observed by the Control Plane; ProjectControlStore#createControlCommand
 * is the normal entry point and reads that version from authoritative state.
 */
export function createCommand({
  id,
  projectId = null,
  targetType,
  targetId,
  targetVersion,
  action,
  capability,
  scope,
  riskLevel = "MODERATE",
  requestedBy,
  expectedVersion = null,
  parameters = {},
  idempotencyKey,
  status = CommandStatus.CREATED,
  version = 1,
  authorization = null,
} = {}) {
  const identity = { id, targetId, action, capability, scope, requestedBy, idempotencyKey };
  for (const field of REQUIRED_COMMAND_FIELDS) {
    if (typeof identity[field] !== "string" || identity[field].trim() === "") {
      throw new Error(`command requires a non-empty ${field}`);
    }
  }
  if (!Object.values(CommandTargetType).includes(targetType)) {
    throw new Error(`unknown command target type: ${targetType}`);
  }
  if (!Number.isInteger(targetVersion) || targetVersion < 1) {
    throw new Error("command must pin the authoritative target version");
  }
  if (expectedVersion != null && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) {
    throw new Error("command expectedVersion must be a positive integer when present");
  }
  if (!Object.values(CommandStatus).includes(status)) {
    throw new Error(`unknown command status: ${status}`);
  }
  if (!Object.values(RiskLevel).includes(riskLevel)) {
    throw new Error(`unknown risk level: ${riskLevel}`);
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("command version must be a positive integer");
  }

  return {
    id,
    version,
    projectId,
    targetType,
    targetId,
    targetVersion,
    action,
    capability,
    scope,
    riskLevel,
    requestedBy,
    expectedVersion,
    parameters: structuredClone(parameters ?? {}),
    idempotencyKey,
    status,
    authorization: authorization ? structuredClone(authorization) : {
      policyDecisionId: null,
      approvalId: null,
      authorizedAt: null,
      rejectedAt: null,
      reason: null,
      approvalReason: null,
    },
    createdAt: now(),
    updatedAt: now(),
  };
}

// ── Policy decision (G4 authorization composition) ───────────────────────────

export const PolicyEffect = Object.freeze({
  ALLOW: "ALLOW",
  DENY: "DENY",
  REQUIRE_APPROVAL: "REQUIRE_APPROVAL",
});

/**
 * Immutable audit fact describing one policy evaluation of one concrete Command.
 */
export function createPolicyDecision({
  id,
  commandId,
  commandVersion,
  targetVersion,
  effect,
  policyVersion,
  subjectId,
  context = {},
  reasons = [],
  matchedRuleIds = [],
} = {}) {
  for (const [field, value] of Object.entries({ id, commandId, policyVersion, subjectId })) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`policy decision requires a non-empty ${field}`);
    }
  }
  if (!Number.isInteger(commandVersion) || commandVersion < 1) {
    throw new Error("policy decision requires a positive commandVersion");
  }
  if (!Number.isInteger(targetVersion) || targetVersion < 1) {
    throw new Error("policy decision requires a positive targetVersion");
  }
  if (!Object.values(PolicyEffect).includes(effect)) {
    throw new Error(`unknown policy effect: ${effect}`);
  }
  return {
    id,
    commandId,
    commandVersion,
    targetVersion,
    effect,
    policyVersion,
    subjectId,
    context: structuredClone(context ?? {}),
    reasons: [...reasons],
    matchedRuleIds: [...matchedRuleIds],
    createdAt: now(),
  };
}

// ── Durable Human Approval ───────────────────────────────────────────────────
//
// An Approval is a PERMISSION fact: a named subject decided, within a stated
// scope, that one specific action on one specific target may proceed. It is
// deliberately not any of the neighbouring facts:
//
//   Evidence    — what happened
//   Verification— a judgement about evidence
//   Acceptance  — whether work is correct/complete (a CORRECTNESS fact)
//   Policy      — a rule deciding whether approval is required at all
//   Command     — a requested action, and its result
//
// The two that are easiest to confuse are the load-bearing pair: Approval is a
// PERMISSION fact and Acceptance is a CORRECTNESS fact. Neither implies the
// other, and neither implies that anything ran.

export const ApprovalStatus = Object.freeze({
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
  REVOKED: "REVOKED",
});

/** The verbs a human decision can use. The lifecycle status is not duplicated here. */
export const ApprovalDecision = Object.freeze({
  APPROVE: "APPROVE",
  REJECT: "REJECT",
});

/**
 * What an Approval can be about.
 *
 * This is NOT `AcceptanceTargetType` plus a member: acceptance contracts are
 * about the correctness of project-control aggregates, while an approval
 * authorizes an ACTION, which may be a COMMAND — something that has no
 * correctness of its own and no concurrency version. The two vocabularies stay
 * separate on purpose, so "GOAL" in one can never be read as "GOAL" in the other.
 */
export const ApprovalTargetType = Object.freeze({
  PROJECT: "PROJECT",
  MILESTONE: "MILESTONE",
  GOAL: "GOAL",
  TASK: "TASK",
  COMMAND: "COMMAND",
});

/**
 * v0.1 risk vocabulary. A Policy Engine would compute this; until then it is
 * recorded on the request and validated against this set, so an approval cannot
 * silently carry a risk level nobody understands.
 */
export const RiskLevel = Object.freeze({
  LOW: "LOW",
  MODERATE: "MODERATE",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
});

/** Why an Approval could not authorize. Never a message string to be parsed. */
export const ApprovalFailureReason = Object.freeze({
  MISSING: "MISSING",
  PENDING: "PENDING",
  REJECTED: "REJECTED",
  REVOKED: "REVOKED",
  EXPIRED: "EXPIRED",
  // The status is not one this version can reason about (durable state written by
  // something other than these rules). Unknown is not "probably fine".
  UNKNOWN: "UNKNOWN",
  UNATTRIBUTED: "UNATTRIBUTED",
  TARGET_MISSING: "TARGET_MISSING",
  TARGET_TYPE_MISMATCH: "TARGET_TYPE_MISMATCH",
  TARGET_ID_MISMATCH: "TARGET_ID_MISMATCH",
  STALE: "STALE",
  ACTION_MISMATCH: "ACTION_MISMATCH",
  // The capability a caller presents IS part of the authorized action, so a
  // different capability is a different authorization — not a variation of one.
  CAPABILITY_MISMATCH: "CAPABILITY_MISMATCH",
  SCOPE_MISMATCH: "SCOPE_MISMATCH",
  COMMAND_MISMATCH: "COMMAND_MISMATCH",
});

/**
 * Refusal for a declared-but-unsupported target type.
 *
 * `ApprovalTargetType.COMMAND` stays in the vocabulary, but G2 deliberately
 * does not enable it. Durable Command identity now exists; whether approval
 * should target the Command or the underlying Project/Task action belongs to
 * later Policy/Approval composition. Until that decision is made, every door
 * fails closed with one shared message.
 */
export const COMMAND_APPROVAL_UNAVAILABLE =
  "COMMAND-target approvals are reserved but unsupported until Policy/Approval composition is defined";

const REQUIRED_APPROVAL_FIELDS = Object.freeze(["targetId", "action", "capability", "scope", "requestedBy"]);

/**
 * Creates a PENDING Approval request.
 *
 * `targetVersion` is the version of the target state this approval is requested
 * against, and `action` + `capability` + `scope` + `targetId` are what it will
 * authorize — together they are the answer to "which concrete action was
 * approved?". A bare "the project is approved" is not representable here: there
 * is no shape of an Approval that does not name a target, a version, an action,
 * the capability it exercises, and a scope.
 *
 * `ApprovalTargetType.COMMAND` is RESERVED BUT UNSUPPORTED in G2. Command now
 * has durable identity, but approval-target semantics are intentionally deferred
 * to Policy/Approval composition; constructing one therefore still fails closed.
 */
export function createApproval({
  id,
  targetType,
  targetId,
  targetVersion = null,
  action,
  capability,
  scope,
  riskLevel = RiskLevel.MODERATE,
  requestedBy,
  expiresAt = null,
  commandId = null,
  version = 1,
} = {}) {
  if (!id) throw new Error("id is required");
  if (!Object.values(ApprovalTargetType).includes(targetType)) {
    throw new Error(`unknown approval target type: ${targetType}`);
  }
  if (targetType === ApprovalTargetType.COMMAND) {
    throw new InvariantError(COMMAND_APPROVAL_UNAVAILABLE);
  }
  const identity = { targetId, action, capability, scope, requestedBy };
  for (const field of REQUIRED_APPROVAL_FIELDS) {
    if (typeof identity[field] !== "string" || identity[field].trim() === "") {
      throw new Error(`approval request requires a non-empty ${field}`);
    }
  }
  if (!Object.values(RiskLevel).includes(riskLevel)) {
    throw new Error(`unknown risk level: ${riskLevel}`);
  }
  if (expiresAt != null && Number.isNaN(Date.parse(expiresAt))) {
    throw new Error(`expiresAt is not a timestamp: ${expiresAt}`);
  }
  if (typeof targetVersion !== "number" || !Number.isInteger(targetVersion) || targetVersion < 1) {
    throw new Error("an approval of a lifecycle aggregate must pin the target version it was requested against");
  }

  return {
    id,
    version,
    request: {
      targetType,
      targetId,
      targetVersion,
      action,
      capability,
      scope,
      riskLevel,
    },
    requestedBy,
    // The decision block holds the decision that stands. `decidedBy`/`decidedAt`
    // are what make an approval ATTRIBUTABLE, and they survive a revocation: the
    // decision is not erased, it is superseded.
    decision: {
      status: ApprovalStatus.PENDING,
      decidedBy: null,
      decidedAt: null,
      reason: null,
    },
    // Only ever set by a revocation, and never cleared: "who withdrew this, when
    // and why" is part of the fact, not an update to it.
    revocation: null,
    commandId,
    expiresAt,
    createdAt: now(),
    updatedAt: now(),
  };
}
