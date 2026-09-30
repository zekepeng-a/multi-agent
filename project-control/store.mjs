// Project Control OS — store contract + shared control semantics.
//
// Exactly one implementation owns the control rules (validation, lineage proof,
// contract revision pinning, command idempotency, event emission). Backends
// provide storage primitives only. That is what keeps MemoryStore and SqliteStore
// from drifting apart, and it keeps SQL out of both the Controller and the rules.
//
// A backend must implement the primitives in the "Backend primitives" block
// below; everything after it is shared behaviour.

import { createHash } from "node:crypto";
import {
  AcceptanceTargetType,
  ApprovalDecision,
  ApprovalError,
  ApprovalFailureReason,
  ApprovalStatus,
  ApprovalTargetType,
  COMMAND_APPROVAL_UNAVAILABLE,
  CommandStatus,
  CommandTargetType,
  EvidenceStatus,
  ConflictError,
  InvariantError,
  ProjectStatus,
  MilestoneStatus,
  GoalStatus,
  TaskStatus,
  RunStatus,
  AttemptStatus,
  createApproval,
  createCommand,
  createEvidence,
  now,
} from "./domain.mjs";

/** Logical collections a backend persists. */
export const Collection = Object.freeze({
  PROJECT: "project",
  MILESTONE: "milestone",
  GOAL: "goal",
  TASK: "task",
  ACCEPTANCE: "acceptance",
  RUN: "run",
  ATTEMPT: "attempt",
  EVIDENCE: "evidence",
  VERIFICATION: "verification",
  APPROVAL: "approval",
  COMMAND: "control_command",
});

// A lifecycle transition that is a domain decision in its own right is recorded
// under its own event name; every other mutation of the same aggregate is a plain
// update. The mapping lives here with the rules, so the Controller never has to
// name events.
const LIFECYCLE_EVENT_TYPES = Object.freeze({
  [Collection.GOAL]: Object.freeze({ [GoalStatus.ACCEPTED]: "goal.accepted" }),
  [Collection.MILESTONE]: Object.freeze({ [MilestoneStatus.COMPLETED]: "milestone.completed" }),
  [Collection.PROJECT]: Object.freeze({ [ProjectStatus.COMPLETED]: "project.completed" }),
});

// ── Parent acceptance vocabulary ─────────────────────────────────────────────
// A parent aggregate (Goal, Milestone) may declare its own Acceptance Contract.
// Its evidence is an AGGREGATE observation of the authoritative child state, not
// a Runtime product, so the collections below map onto acceptance target types,
// child "finished" statuses and the status the parent reaches on success.

const ACCEPTANCE_TARGET_TYPE_BY_COLLECTION = Object.freeze({
  [Collection.GOAL]: AcceptanceTargetType.GOAL,
  [Collection.MILESTONE]: AcceptanceTargetType.MILESTONE,
});

const COLLECTION_BY_ACCEPTANCE_TARGET_TYPE = Object.freeze({
  [AcceptanceTargetType.GOAL]: Collection.GOAL,
  [AcceptanceTargetType.MILESTONE]: Collection.MILESTONE,
});

const ACCEPTED_CHILD_STATUS = Object.freeze({
  [Collection.GOAL]: TaskStatus.ACCEPTED,
  [Collection.MILESTONE]: GoalStatus.ACCEPTED,
});

const ACCEPTED_TARGET_STATUS = Object.freeze({
  [Collection.GOAL]: GoalStatus.ACCEPTED,
  [Collection.MILESTONE]: MilestoneStatus.COMPLETED,
});

/** Parent acceptance may only be taken while the parent's outcome is open. */
const ACCEPTABLE_SOURCE_AGGREGATE_STATES = Object.freeze({
  [Collection.GOAL]: Object.freeze([GoalStatus.READY, GoalStatus.IN_PROGRESS]),
  [Collection.MILESTONE]: Object.freeze([MilestoneStatus.READY, MilestoneStatus.IN_PROGRESS]),
});

const CHILD_REF_TYPE = Object.freeze({
  [Collection.GOAL]: "TASK_ACCEPTANCE",
  [Collection.MILESTONE]: "GOAL_ACCEPTANCE",
});

// ── Durable Human Approval vocabulary ────────────────────────────────────────
//
// An Approval is a permission fact with a lifecycle of its own. The table below
// is the WHOLE lifecycle: every transition that is not listed is refused, so a
// re-decision (APPROVED → APPROVED), a resurrection (REJECTED → APPROVED) and a
// post-revocation approval all fail closed without an explicit branch each.
//
// `from` is the EFFECTIVE status, not merely the stored one: a PENDING approval
// whose deadline has passed is EXPIRED for every purpose, including whether it
// may still be decided.
const APPROVAL_TRANSITIONS = Object.freeze({
  [ApprovalStatus.APPROVED]: Object.freeze({
    from: Object.freeze([ApprovalStatus.PENDING]),
    event: "approval.approved",
  }),
  [ApprovalStatus.REJECTED]: Object.freeze({
    from: Object.freeze([ApprovalStatus.PENDING]),
    event: "approval.rejected",
  }),
  // Expiry is the only transition that can be reached from an ALREADY GRANTED
  // approval: the grant did not become wrong, it stopped being valid.
  [ApprovalStatus.EXPIRED]: Object.freeze({
    from: Object.freeze([ApprovalStatus.PENDING, ApprovalStatus.APPROVED]),
    event: "approval.expired",
  }),
  // Revocation is a human act about a grant, so it requires a grant to revoke.
  [ApprovalStatus.REVOKED]: Object.freeze({
    from: Object.freeze([ApprovalStatus.APPROVED]),
    event: "approval.revoked",
  }),
});

/** Approval target types that name a real aggregate with a concurrency version. */
const APPROVAL_TARGET_COLLECTION = Object.freeze({
  [ApprovalTargetType.PROJECT]: Collection.PROJECT,
  [ApprovalTargetType.MILESTONE]: Collection.MILESTONE,
  [ApprovalTargetType.GOAL]: Collection.GOAL,
  [ApprovalTargetType.TASK]: Collection.TASK,
});

const COMMAND_TARGET_COLLECTION = Object.freeze({
  [CommandTargetType.PROJECT]: Collection.PROJECT,
  [CommandTargetType.MILESTONE]: Collection.MILESTONE,
  [CommandTargetType.GOAL]: Collection.GOAL,
  [CommandTargetType.TASK]: Collection.TASK,
});

const G2_COMMAND_WRITABLE_STATUSES = Object.freeze([
  CommandStatus.CREATED,
  CommandStatus.AUTHORIZED,
  CommandStatus.REJECTED,
]);

/**
 * What an approval request BINDS, and therefore what a later update may never
 * touch. Everything here answers "which concrete action was approved?" — editing
 * any of it would silently re-point an existing permission at different work.
 */
const APPROVAL_BOUND_FIELDS = Object.freeze([
  "targetType",
  "targetId",
  "targetVersion",
  "action",
  "capability",
  "scope",
  "riskLevel",
  "requestedBy",
  "commandId",
]);

/** The only field an update may move: the request's own deadline. */
const APPROVAL_UPDATABLE_FIELDS = Object.freeze(["expiresAt"]);

const APPROVAL_LIFECYCLE_FIELDS = Object.freeze(["id", "version", "decision", "revocation", "createdAt"]);

/**
 * The status an Approval has RIGHT NOW.
 *
 * Expiry is not a background job in v0.1 (there is no scheduler, and a control
 * plane that needs a timer to know whether a permission is valid is fragile).
 * It is evaluated on every read: a PENDING or APPROVED approval whose `expiresAt`
 * has passed is EXPIRED from that instant, whether or not anyone has recorded it
 * yet. Recording it is a separate, explicit act (`expireApproval`) that leaves a
 * durable `approval.expired` event behind.
 */
export function effectiveApprovalStatus(approval, at = new Date()) {
  const stored = approval?.decision?.status ?? null;
  if (stored === ApprovalStatus.REVOKED || stored === ApprovalStatus.EXPIRED) return stored;
  if (approval?.expiresAt && at.getTime() > Date.parse(approval.expiresAt)) {
    return ApprovalStatus.EXPIRED;
  }
  return stored;
}

/**
 * Deterministic JSON: object keys are sorted, so two structurally equal snapshots
 * always serialize to the same bytes regardless of insertion order.
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function snapshotRevision(snapshot) {
  return `sha256:${createHash("sha256").update(canonicalJson(snapshot)).digest("hex")}`;
}

/**
 * The authoritative parent links for each child collection.
 *
 * A relationship is a fact recorded on the CHILD, exactly like `Run.taskId` and
 * `Evidence.taskId`. The aggregate-side lists (`Goal.taskIds`,
 * `Milestone.goalIds`) are derived/cached membership views and are never used to
 * decide who belongs to whom. `Milestone.roadmapId` is a future field: Roadmap has
 * no lifecycle in v0.1, so it takes no part in any aggregation.
 *
 * A Goal carries TWO parent links, because canonical architecture allows both
 * `Project → Goal` and `Project → Milestone → Goal`. The second one is the
 * declared project of the goal itself; it is not derived from the milestone.
 */
const PARENT_LINKS = Object.freeze({
  [Collection.TASK]: [{ field: "goalId", collection: Collection.GOAL }],
  [Collection.GOAL]: [
    { field: "milestoneId", collection: Collection.MILESTONE },
    { field: "projectId", collection: Collection.PROJECT },
  ],
  [Collection.MILESTONE]: [{ field: "projectId", collection: Collection.PROJECT }],
});

/**
 * The only Task states from which a NEW acceptance may be performed.
 *
 * Acceptance is a forward, contract-bound decision, and it may only be taken
 * while the task's outcome is still open:
 *
 * - `READY`         planned and pinned to a contract revision, not yet claimed
 * - `IN_PROGRESS`   execution is underway, or a blocked Run is being reconciled
 * - `NEEDS_REVIEW`  evidence exists but the outcome has not been settled
 *
 * Refused, and why: `DRAFT` (never planned or committed), `BLOCKED` (a blocking
 * or reconciliation condition is still open), `ACCEPTED` (terminal), `REJECTED`
 * (already judged unacceptable, and v0.1 has no re-open path), `CANCELLED`
 * (abandoned by an authority).
 *
 * A whitelist is used deliberately. A terminal-state blacklist would have to
 * enumerate every unacceptable state and would silently permit any state added
 * later; here an unlisted state is refused by default.
 */
export const ACCEPTABLE_SOURCE_TASK_STATES = Object.freeze([
  TaskStatus.READY,
  TaskStatus.IN_PROGRESS,
  TaskStatus.NEEDS_REVIEW,
]);

// A contract revision's identity is (id, version). These four fields are the
// contract itself, and changing any of them requires a NEW version — that is
// what makes a revision immutable. The fingerprint is stored beside the record
// and re-checked on every resolution, so a hand-edited or confused revision
// fails closed instead of being trusted. `status` is deliberately excluded: an
// acceptance decision (PENDING → PASSED) is not a contract revision change.
export function acceptanceKey(id, version) {
  return `${id}@${version}`;
}

export function acceptanceContractFingerprint(acceptance) {
  return canonicalJson({
    id: acceptance.id,
    targetType: acceptance.targetType,
    targetId: acceptance.targetId,
    version: acceptance.version,
    criteria: acceptance.criteria,
  });
}

export class ProjectControlStore {
  // ── Backend primitives ────────────────────────────────────────────────────
  // Backend-facing, not part of the Controller contract. Implementations:
  // MemoryStore (in-process) and SqliteStore (durable).

  /** @returns {object|null} a copy of the stored record */
  getRecord(collection, key) {
    throw new Error(`getRecord is not implemented (${collection} ${key})`);
  }

  /** Unconditional upsert. */
  putRecord(collection, key, record) {
    throw new Error(`putRecord is not implemented (${collection} ${key})`);
  }

  /** @returns {boolean} false when the key already exists */
  insertRecord(collection, key, record) {
    throw new Error(`insertRecord is not implemented (${collection} ${key})`);
  }

  /**
   * Compare-and-set on the record's own concurrency `version`.
   * @param {number|undefined} expectedVersion undefined = unconditional update
   * @returns {boolean} false when no record matched the expected version
   */
  updateRecord(collection, key, record, expectedVersion) {
    throw new Error(`updateRecord is not implemented (${collection} ${key})`);
  }

  /** @returns {object[]} every record in the collection */
  allRecords(collection) {
    throw new Error(`allRecords is not implemented (${collection})`);
  }

  /** @returns {object[]} records whose `field` equals `value` */
  recordsMatching(collection, field, value) {
    throw new Error(`recordsMatching is not implemented (${collection} ${field})`);
  }

  /** @returns {{operation: string, resultId: string}|null} */
  getCommand(commandId) {
    throw new Error(`getCommand is not implemented (${commandId})`);
  }

  putCommand(commandId, entry) {
    throw new Error(`putCommand is not implemented (${commandId})`);
  }

  /** @returns {string|null} the recorded contract-content fingerprint */
  getContractFingerprint(key) {
    throw new Error(`getContractFingerprint is not implemented (${key})`);
  }

  putContractFingerprint(key, fingerprint) {
    throw new Error(`putContractFingerprint is not implemented (${key})`);
  }

  /**
   * Appends a domain event.
   *
   * `aggregateType` is derived from the event type, which is
   * `<aggregate>.<action>` throughout this model. `aggregateVersion` is the
   * aggregate's concurrency version where one exists (project, task, run) and
   * null where it does not (attempt, evidence, verification, and the acceptance
   * revision — whose `version` is contract identity, not a mutation counter, and
   * therefore stays in the payload).
   *
   * @returns {object} the stored event, with its assigned id
   */
  appendEvent(event) {
    throw new Error(`appendEvent is not implemented (${event.type})`);
  }

  /** @returns {object[]} events in append order */
  allEvents() {
    throw new Error("allEvents is not implemented");
  }

  /**
   * Runs `fn` atomically: everything it writes commits together or not at all.
   * Nested calls join the outer transaction. Synchronous by design — the whole
   * store API is synchronous, matching the in-process reference implementation.
   */
  runInTransaction(fn) {
    throw new Error("runInTransaction is not implemented");
  }

  /** Releases backend resources. Safe to call more than once. */
  close() {}

  // ── Shared control semantics ──────────────────────────────────────────────

  seedProject(project) {
    this.runInTransaction(() => {
      if (!this.insertRecord(Collection.PROJECT, project.id, structuredClone(project))) {
        throw new Error(`project already exists: ${project.id}`);
      }
      this.#event("project.created", project.id, { name: project.name }, { aggregateVersion: project.version });
    });
  }

  getProject(id) {
    return structuredClone(this.#required(Collection.PROJECT, id, "project"));
  }

  updateProject(id, expectedVersion, patch, { commandId = null } = {}) {
    return this.#mutateVersioned(
      Collection.PROJECT,
      id,
      expectedVersion,
      patch,
      "project.updated",
      "updateProject",
      commandId,
    );
  }

  seedMilestone(milestone) {
    this.runInTransaction(() => {
      this.#assertRelationship(Collection.MILESTONE, milestone);
      this.#assertAcceptanceContract(Collection.MILESTONE, milestone);
      if (!this.insertRecord(Collection.MILESTONE, milestone.id, structuredClone(milestone))) {
        throw new Error(`milestone already exists: ${milestone.id}`);
      }
      this.#event("milestone.created", milestone.id, { projectId: milestone.projectId }, {
        aggregateVersion: milestone.version,
      });
    });
  }

  getMilestone(id) {
    return structuredClone(this.#required(Collection.MILESTONE, id, "milestone"));
  }

  updateMilestone(id, expectedVersion, patch, { commandId = null } = {}) {
    return this.#mutateVersioned(
      Collection.MILESTONE,
      id,
      expectedVersion,
      patch,
      "milestone.updated",
      "updateMilestone",
      commandId,
    );
  }

  /**
   * Milestones of a project.
   *
   * RELATIONSHIP AUTHORITY: membership is the child's explicit `projectId`.
   * `Milestone.roadmapId` is a future field (Roadmap has no lifecycle in v0.1)
   * and takes no part in this query or in any aggregation.
   */
  getMilestonesForProject(projectId) {
    return this.recordsMatching(Collection.MILESTONE, "projectId", projectId);
  }

  seedGoal(goal) {
    this.runInTransaction(() => {
      this.#assertRelationship(Collection.GOAL, goal);
      this.#assertAcceptanceContract(Collection.GOAL, goal);
      if (!this.insertRecord(Collection.GOAL, goal.id, structuredClone(goal))) {
        throw new Error(`goal already exists: ${goal.id}`);
      }
      this.#event("goal.created", goal.id, { projectId: goal.projectId }, {
        aggregateVersion: goal.version,
      });
    });
  }

  getGoal(id) {
    return structuredClone(this.#required(Collection.GOAL, id, "goal"));
  }

  updateGoal(id, expectedVersion, patch, { commandId = null } = {}) {
    return this.#mutateVersioned(
      Collection.GOAL,
      id,
      expectedVersion,
      patch,
      "goal.updated",
      "updateGoal",
      commandId,
    );
  }

  /**
   * Goals of a milestone.
   *
   * RELATIONSHIP AUTHORITY: membership is the child's explicit `milestoneId`.
   * `Milestone.goalIds` is DERIVED / CACHED / NON-AUTHORITATIVE — it is never
   * consulted to decide membership, and this round does not maintain it.
   */
  getGoalsForMilestone(milestoneId) {
    return this.recordsMatching(Collection.GOAL, "milestoneId", milestoneId);
  }

  /** Goals of a project, read from the child's explicit `projectId` link. */
  getGoalsForProject(projectId) {
    return this.recordsMatching(Collection.GOAL, "projectId", projectId);
  }

  /**
   * Tasks of a goal.
   *
   * RELATIONSHIP AUTHORITY: membership is the child's explicit `goalId`.
   * `Goal.taskIds` is DERIVED / CACHED / NON-AUTHORITATIVE — an empty or stale
   * `taskIds` never hides a task that points at this goal.
   */
  getTasksForGoal(goalId) {
    return this.recordsMatching(Collection.TASK, "goalId", goalId);
  }

  seedTask(task) {
    this.runInTransaction(() => {
      this.#assertRelationship(Collection.TASK, task);
      if (!this.insertRecord(Collection.TASK, task.id, structuredClone(task))) {
        throw new Error(`task already exists: ${task.id}`);
      }
      this.#event("task.created", task.id, { version: task.version }, { aggregateVersion: task.version });
    });
  }

  seedAcceptance(acceptance) {
    this.runInTransaction(() => {
      const key = acceptanceKey(acceptance.id, acceptance.version);
      if (!this.insertRecord(Collection.ACCEPTANCE, key, structuredClone(acceptance))) {
        throw new Error(`acceptance already exists: ${acceptance.id} v${acceptance.version}`);
      }
      this.putContractFingerprint(key, acceptanceContractFingerprint(acceptance));
      this.#event("acceptance.created", acceptance.id, { version: acceptance.version });
    });
  }

  /**
   * Creates the next revision of a contract. Contract content only ever changes
   * here, which is what ties "content changed" to "identity changed". The new
   * revision starts PENDING, and tasks that were pinned to an earlier revision
   * keep pointing at it.
   */
  reviseAcceptance(id, { criteria, targetId } = {}, { commandId = null } = {}) {
    return this.runInTransaction(() => {
      const replay = this.#replayCommand(commandId, "reviseAcceptance");
      if (replay) return structuredClone(this.#required(Collection.ACCEPTANCE, replay, "acceptance"));

      const current = this.#acceptanceHead(id);
      const next = {
        ...current,
        targetId: targetId ?? current.targetId,
        criteria: structuredClone(criteria ?? current.criteria),
        version: current.version + 1,
        status: "PENDING",
        createdAt: now(),
        updatedAt: now(),
      };
      const key = acceptanceKey(next.id, next.version);
      if (!this.insertRecord(Collection.ACCEPTANCE, key, next)) {
        throw new ConflictError(`acceptance revision already exists: ${key}`);
      }
      this.putContractFingerprint(key, acceptanceContractFingerprint(next));
      this.#event("acceptance.revised", id, { version: next.version, from: current.version }, { commandId });
      this.#rememberCommand(commandId, "reviseAcceptance", key);
      return structuredClone(next);
    });
  }

  getTask(id) {
    return structuredClone(this.#required(Collection.TASK, id, "task"));
  }

  /** Resolves one concrete contract revision; there is no "current version" lookup. */
  getAcceptance(id, version) {
    return structuredClone(this.#acceptanceRevision(id, version));
  }

  getRun(id) {
    return structuredClone(this.#required(Collection.RUN, id, "run"));
  }

  getRunsForTask(taskId) {
    return this.recordsMatching(Collection.RUN, "taskId", taskId);
  }

  getAttempt(id) {
    return structuredClone(this.#required(Collection.ATTEMPT, id, "attempt"));
  }

  getEvidence(id) {
    return structuredClone(this.#required(Collection.EVIDENCE, id, "evidence"));
  }

  getVerification(id) {
    return structuredClone(this.#required(Collection.VERIFICATION, id, "verification"));
  }

  getEvents() {
    return structuredClone(this.allEvents());
  }

  updateTask(id, expectedVersion, patch, { commandId = null } = {}) {
    return this.#mutateVersioned(
      Collection.TASK,
      id,
      expectedVersion,
      patch,
      "task.updated",
      "updateTask",
      commandId,
    );
  }

  createRun(run, { commandId = null } = {}) {
    return this.runInTransaction(() => {
      const replay = this.#replayCommand(commandId, "createRun");
      if (replay) return this.getRun(replay);
      if (!this.insertRecord(Collection.RUN, run.id, structuredClone(run))) {
        throw new Error(`run already exists: ${run.id}`);
      }
      this.#event("run.created", run.id, { taskId: run.taskId }, { commandId, aggregateVersion: run.version });
      this.#rememberCommand(commandId, "createRun", run.id);
      return structuredClone(run);
    });
  }

  updateRun(id, expectedVersion, patch, { commandId = null } = {}) {
    return this.#mutateVersioned(
      Collection.RUN,
      id,
      expectedVersion,
      patch,
      "run.updated",
      "updateRun",
      commandId,
    );
  }

  createAttempt(attempt, { commandId = null } = {}) {
    return this.runInTransaction(() => {
      const replay = this.#replayCommand(commandId, "createAttempt");
      if (replay) return this.getAttempt(replay);
      if (!this.insertRecord(Collection.ATTEMPT, attempt.id, structuredClone(attempt))) {
        throw new Error(`attempt already exists: ${attempt.id}`);
      }
      this.#event("attempt.created", attempt.id, { runId: attempt.runId }, { commandId });
      this.#rememberCommand(commandId, "createAttempt", attempt.id);
      return structuredClone(attempt);
    });
  }

  // An Attempt has no concurrency version of its own, so this is an
  // unconditional upsert — the same semantics as the in-process reference.
  updateAttempt(id, patch, { commandId = null } = {}) {
    return this.runInTransaction(() => {
      const replay = this.#replayCommand(commandId, "updateAttempt");
      if (replay) return this.getAttempt(replay);
      const current = this.#required(Collection.ATTEMPT, id, "attempt");
      const next = { ...current, ...structuredClone(patch) };
      if (next.status === AttemptStatus.RUNNING && !next.startedAt) next.startedAt = now();
      if ([AttemptStatus.COMPLETED, AttemptStatus.FAILED, AttemptStatus.LOST, AttemptStatus.CANCELLED].includes(next.status)) {
        next.endedAt ??= now();
      }
      this.putRecord(Collection.ATTEMPT, id, next);
      this.#event("attempt.updated", id, { status: next.status }, { commandId });
      this.#rememberCommand(commandId, "updateAttempt", id);
      return structuredClone(next);
    });
  }

  recordEvidence(evidence, { commandId = null } = {}) {
    return this.runInTransaction(() => {
      const replay = this.#replayCommand(commandId, "recordEvidence");
      if (replay) return this.getEvidence(replay);
      if (!this.insertRecord(Collection.EVIDENCE, evidence.id, structuredClone(evidence))) {
        throw new Error(`evidence already exists: ${evidence.id}`);
      }
      this.#event("evidence.recorded", evidence.id, {
        taskId: evidence.taskId,
        acceptanceId: evidence.acceptanceId,
        acceptanceVersion: evidence.acceptanceVersion,
        revision: evidence.revision,
      }, { commandId });
      this.#rememberCommand(commandId, "recordEvidence", evidence.id);
      return structuredClone(evidence);
    });
  }

  recordVerification(verification, { commandId = null } = {}) {
    return this.runInTransaction(() => {
      const replay = this.#replayCommand(commandId, "recordVerification");
      if (replay) return this.getVerification(replay);
      if (this.getRecord(Collection.VERIFICATION, verification.id)) {
        throw new Error(`verification already exists: ${verification.id}`);
      }
      // A verification names the contract revision it targets, and that revision
      // must actually exist — never the acceptance object's current version.
      if (!this.getRecord(Collection.ACCEPTANCE, acceptanceKey(verification.acceptanceId, verification.acceptanceVersion))) {
        throw new InvariantError("verification targets a different acceptance contract version");
      }
      // Resolved through the revision guard, so a tampered contract fails closed.
      this.#acceptanceRevision(verification.acceptanceId, verification.acceptanceVersion);
      for (const evidenceId of verification.evidenceIds) {
        const evidence = this.#required(Collection.EVIDENCE, evidenceId, "evidence");
        if (
          evidence.acceptanceId !== verification.acceptanceId ||
          evidence.acceptanceVersion !== verification.acceptanceVersion
        ) {
          throw new InvariantError("verification evidence does not match acceptance contract");
        }
      }
      // Matching an acceptance contract is not enough: the verification must also
      // be provable back to the target it declares — through the Run/Attempt
      // lineage for a Task, through the live child snapshot for an aggregate.
      const targetType = verification.targetType ?? AcceptanceTargetType.TASK;
      if (targetType === AcceptanceTargetType.TASK) {
        if (!verification.taskId) {
          throw new InvariantError("verification must declare the task it belongs to");
        }
        this.#proveVerification({
          task: this.#required(Collection.TASK, verification.taskId, "task"),
          verification,
        });
      } else {
        const collection = COLLECTION_BY_ACCEPTANCE_TARGET_TYPE[targetType];
        if (!collection) {
          // PROJECT acceptance is a declared target type with no v0.1 lifecycle.
          throw new InvariantError(`verification target type ${targetType} has no acceptance flow in v0.1`);
        }
        this.#proveAggregateVerification({
          collection,
          target: this.#required(collection, verification.targetId, "aggregate"),
          verification,
        });
      }
      this.insertRecord(Collection.VERIFICATION, verification.id, structuredClone(verification));
      this.#event("verification.recorded", verification.id, {
        acceptanceId: verification.acceptanceId,
        verdict: verification.verdict,
      }, { commandId });
      this.#rememberCommand(commandId, "recordVerification", verification.id);
      return structuredClone(verification);
    });
  }

  acceptTask(taskId, expectedVersion, { verificationId, commandId = null } = {}) {
    return this.runInTransaction(() => {
      const replay = this.#replayCommand(commandId, "acceptTask");
      if (replay) return this.getTask(replay);
      const task = this.#required(Collection.TASK, taskId, "task");
      if (task.version !== expectedVersion) {
        throw new ConflictError(`task ${taskId} expected v${expectedVersion}, current v${task.version}`);
      }
      // Acceptance may only be taken from a state in which the task's outcome is
      // still open. This is a WHITELIST, not a terminal-state blacklist: BLOCKED
      // and DRAFT are not terminal but still may not be accepted, and any state
      // added later is refused until it is explicitly listed here — the rule
      // fails closed. It is deliberately an error, not a NOOP: refusing a command
      // that reached the Store belongs here, while "do not dispatch one" belongs
      // to the Controller. A replay of the ORIGINAL commandId already returned
      // above, so idempotency is intact.
      if (!ACCEPTABLE_SOURCE_TASK_STATES.includes(task.status)) {
        throw new InvariantError(
          task.status === TaskStatus.ACCEPTED
            ? `task ${taskId} is already ${TaskStatus.ACCEPTED}: acceptance is terminal`
            : `task ${taskId} is ${task.status} and may not enter ${TaskStatus.ACCEPTED}: ` +
              `acceptance requires one of ${ACCEPTABLE_SOURCE_TASK_STATES.join(", ")}`,
        );
      }
      const verification = this.#required(Collection.VERIFICATION, verificationId, "verification");
      // Resolved from the revision the TASK pinned — never from the contract's
      // current version, so an existing task cannot drift onto a newer revision.
      const acceptance = this.#acceptanceRevision(task.acceptanceId, task.acceptanceVersion);
      if (
        verification.acceptanceId !== acceptance.id ||
        verification.acceptanceVersion !== acceptance.version ||
        verification.verdict !== "PASS"
      ) {
        throw new InvariantError("task cannot be accepted by this verification");
      }
      // Acceptance never trusts a verdict: the whole Verification → Evidence → Task
      // identity chain is re-proven here, against the task actually being accepted
      // and against evidence state as it is *now* — a verification recorded earlier
      // may point at evidence that has since gone STALE or SUPERSEDED.
      this.#proveVerification({ task, verification });
      const next = {
        ...task,
        status: TaskStatus.ACCEPTED,
        version: task.version + 1,
        updatedAt: now(),
      };
      if (!this.updateRecord(Collection.TASK, taskId, next, expectedVersion)) {
        throw new ConflictError(`task ${taskId} expected v${expectedVersion}, but it changed in another writer`);
      }
      // The revision record keeps its contract version; only the decision moves.
      this.putRecord(
        Collection.ACCEPTANCE,
        acceptanceKey(acceptance.id, acceptance.version),
        { ...acceptance, status: "PASSED", updatedAt: now() },
      );
      this.#event("task.accepted", taskId, { verificationId, version: next.version }, { commandId, aggregateVersion: next.version });
      this.#rememberCommand(commandId, "acceptTask", taskId);
      return structuredClone(next);
    });
  }

  /**
   * Records the Control Plane's own observation of an aggregate's children as
   * Aggregate Evidence, and returns the Evidence that describes the aggregate
   * state as it is *now*.
   *
   * A parent's evidence cannot be a Runtime product — nothing "runs" for a Goal —
   * so it is derived here from the authoritative child records. The Evidence
   * identity is a function of the observed state (`sha256` of the child
   * snapshot), which gives the operation its two defining properties:
   *
   * - the SAME observation is REUSED — one observation, one Evidence record, no
   *   duplicate `evidence.recorded` on a repeated reconcile;
   * - a CHANGED observation produces a NEW record, and the record it replaces is
   *   marked SUPERSEDED, never deleted. Historical evidence stays readable, so a
   *   Verification built on it can be seen to be stale rather than silently
   *   disappearing.
   *
   * Everything the children must satisfy is checked here from the live records:
   * the target must pin a contract revision that really targets it, and every
   * child must have reached its finished state. An incomplete aggregate fails
   * closed; it is never observed as "finished enough".
   *
   * Command ids: a `commandId` makes ONE command replayable, exactly as
   * everywhere else — but be precise about what that means here. Its replay
   * returns the evidence that command recorded, so a command id reused across
   * observations pins the aggregate to its first observation and a later child
   * change could never be observed. Callers that want "the observation of the
   * current state" pass no command id and rely on the evidence identity.
   */
  ensureAggregateEvidence(collection, targetId, { commandId = null } = {}) {
    return this.runInTransaction(() => {
      const replay = this.#replayCommand(commandId, "ensureAggregateEvidence");
      if (replay) return this.getEvidence(replay);

      const targetType = ACCEPTANCE_TARGET_TYPE_BY_COLLECTION[collection];
      if (!targetType) {
        throw new InvariantError(`aggregate evidence is not defined for ${collection}`);
      }
      const target = this.#required(collection, targetId, "aggregate");
      if (target.acceptanceId == null || target.acceptanceVersion == null) {
        throw new InvariantError(
          `${collection} ${target.id} has no pinned acceptance contract revision to observe against`,
        );
      }
      const acceptance = this.#acceptanceRevision(target.acceptanceId, target.acceptanceVersion);
      if (acceptance.targetType !== targetType || acceptance.targetId !== target.id) {
        throw new InvariantError(
          `acceptance contract ${acceptance.id} v${acceptance.version} does not target ${targetType} ${target.id}`,
        );
      }

      const snapshot = this.#childSnapshot(collection, target);
      const revision = snapshotRevision(snapshot);
      // Deterministic identity: same observed state → same Evidence id.
      const evidenceId = `evidence-aggregate-${target.id}-${revision.slice("sha256:".length, "sha256:".length + 16)}`;
      const existing = this.getRecord(Collection.EVIDENCE, evidenceId);
      if (existing) {
        this.#rememberCommand(commandId, "ensureAggregateEvidence", evidenceId);
        return structuredClone(existing);
      }

      for (const stale of this.recordsMatching(Collection.EVIDENCE, "targetId", target.id)) {
        if (
          stale.targetType !== targetType ||
          stale.status === EvidenceStatus.SUPERSEDED ||
          stale.id === evidenceId
        ) {
          continue;
        }
        this.putRecord(Collection.EVIDENCE, stale.id, { ...stale, status: EvidenceStatus.SUPERSEDED });
        this.#event(
          "evidence.superseded",
          stale.id,
          { targetType, targetId: target.id, revision: stale.revision, supersededBy: evidenceId },
          { commandId },
        );
      }

      const evidence = createEvidence({
        id: evidenceId,
        targetType,
        targetId: target.id,
        acceptanceId: acceptance.id,
        acceptanceVersion: acceptance.version,
        revision,
        sourceRefs: snapshot.children,
      });
      this.insertRecord(Collection.EVIDENCE, evidence.id, structuredClone(evidence));
      this.#event(
        "evidence.recorded",
        evidence.id,
        {
          targetType,
          targetId: target.id,
          acceptanceId: acceptance.id,
          acceptanceVersion: acceptance.version,
          revision,
        },
        { commandId },
      );
      this.#rememberCommand(commandId, "ensureAggregateEvidence", evidence.id);
      return structuredClone(evidence);
    });
  }

  /**
   * Accepts a Goal against its pinned contract revision and a PASS Verification
   * of the Aggregate Evidence that describes it.
   *
   * This is the Goal-level counterpart of `acceptTask`, and it is deliberately
   * the SAME shape: state whitelist, explicit contract revision, re-proved
   * Verification, compare-and-set write, contract decision and event in one
   * transaction. Aggregating "all tasks are ACCEPTED" into an ACCEPTED Goal
   * remains the contract-free path in the Controller; it never comes through
   * here, so a Goal with a contract can only be accepted by proving one.
   */
  acceptGoal(goalId, expectedVersion, { verificationId, commandId = null } = {}) {
    return this.#acceptAggregate(Collection.GOAL, goalId, expectedVersion, "acceptGoal", {
      verificationId,
      commandId,
    });
  }

  /** Milestone counterpart of `acceptGoal`: the decision is `COMPLETED`. */
  completeMilestone(milestoneId, expectedVersion, { verificationId, commandId = null } = {}) {
    return this.#acceptAggregate(Collection.MILESTONE, milestoneId, expectedVersion, "completeMilestone", {
      verificationId,
      commandId,
    });
  }

  /** Verifications already recorded about one target; used to reuse a verdict. */
  getVerificationsForTarget(targetId) {
    return this.recordsMatching(Collection.VERIFICATION, "targetId", targetId);
  }

  // ── Durable Human Approval ────────────────────────────────────────────────
  //
  // An Approval is written and read as a durable CONTROL FACT, never as a flag
  // on something else. The rules live here:
  //
  //   • the request binds target + version + action + scope, so "approved" always
  //     answers "approved WHICH action, on WHICH state?";
  //   • a decision is attributable: no approver, no APPROVED;
  //   • the lifecycle is the transition table above — no re-decision, no
  //     resurrection, no approval after revocation;
  //   • expiry is evaluated on read, never by a background job;
  //   • consumption is a READ-ONLY proof (`assertApprovalUsable`) that re-checks
  //     the target's CURRENT version, so a permission cannot be carried forward
  //     onto state nobody approved.
  //
  // What this deliberately is not: a Policy Engine (nothing decides here that an
  // approval is REQUIRED), an Effect ledger (consumption is not recorded — v0.1
  // has no effect tracking), and never an execution path. An approved approval
  // authorizes a command to pass a gate; it runs nothing.

  /**
   * Inserts an already-formed Approval — the same escape hatch `seedTask` and
   * `seedAcceptance` provide, used to start from a decided state (a historical
   * approval, or a fixture).
   *
   * A seed is not a bypass: the record must be internally coherent, and the
   * events it emits mirror the record exactly (`approval.requested`, then the
   * decision events its status implies). History and state are written together
   * here too, so a seeded APPROVED approval cannot exist without an
   * `approval.approved` event explaining it.
   */
  // ── Durable Command (G2) ───────────────────────────────────────────────────
  //
  // This domain is deliberately separate from the backend replay registry
  // exposed by getCommand()/putCommand(). Those rows deduplicate store
  // mutations; these records are authoritative requested actions.

  createControlCommand(request, { mutationId = null } = {}) {
    return this.runInTransaction(() => {
      const replay = this.#replayCommand(mutationId, "createControlCommand");
      if (replay) return this.getControlCommand(replay);

      const collection = COMMAND_TARGET_COLLECTION[request.targetType];
      if (!collection) {
        throw new InvariantError(`unknown command target type: ${request.targetType}`);
      }
      const target = this.getRecord(collection, request.targetId);
      if (!target) {
        throw new InvariantError(`command target not found: ${request.targetType} ${request.targetId}`);
      }

      const declaredTargetVersion = request.targetVersion ?? null;
      if (declaredTargetVersion != null && declaredTargetVersion !== target.version) {
        throw new InvariantError(
          `command target ${request.targetId} is v${target.version}, not v${declaredTargetVersion}`,
        );
      }
      if (request.expectedVersion != null && request.expectedVersion !== target.version) {
        throw new ConflictError(
          `command ${request.id} expected target v${request.expectedVersion}, current v${target.version}`,
        );
      }

      const projectId = request.projectId ?? (
        request.targetType === CommandTargetType.PROJECT ? target.id : target.projectId ?? null
      );
      const command = createCommand({
        ...request,
        projectId,
        targetVersion: target.version,
        status: CommandStatus.CREATED,
        version: 1,
        authorization: null,
      });
      this.#assertCommandCoherent(command);

      if (!this.insertRecord(Collection.COMMAND, command.id, structuredClone(command))) {
        throw new Error(`command already exists: ${command.id}`);
      }
      this.#event("command.created", command.id, this.#commandIntentPayload(command), {
        commandId: mutationId,
        aggregateVersion: command.version,
      });
      this.#rememberCommand(mutationId, "createControlCommand", command.id);
      return structuredClone(command);
    });
  }

  getControlCommand(id) {
    return structuredClone(this.#required(Collection.COMMAND, id, "command"));
  }

  getControlCommandsForTarget(targetType, targetId) {
    return structuredClone(this.allRecords(Collection.COMMAND).filter(
      (command) => command.targetType === targetType && command.targetId === targetId,
    ));
  }

  authorizeControlCommand(
    commandId,
    expectedCommandVersion,
    { approvalId = null } = {},
    { mutationId = null } = {},
  ) {
    return this.runInTransaction(() => {
      const replay = this.#replayCommand(mutationId, "authorizeControlCommand");
      if (replay) {
        const command = this.getControlCommand(replay);
        return {
          action: command.status === CommandStatus.AUTHORIZED ? "AUTHORIZE" : "REJECT",
          reason: command.authorization?.reason ?? "command-replayed",
          command,
        };
      }

      const current = this.#required(Collection.COMMAND, commandId, "command");
      this.#assertCommandCoherent(current);
      if (current.version !== expectedCommandVersion) {
        throw new ConflictError(
          `command ${commandId} expected v${expectedCommandVersion}, current v${current.version}`,
        );
      }
      if (current.status !== CommandStatus.CREATED) {
        throw new InvariantError(
          `command ${commandId} is already ${current.status}; authorization is a one-way transition`,
        );
      }

      const targetCollection = COMMAND_TARGET_COLLECTION[current.targetType];
      const target = targetCollection ? this.getRecord(targetCollection, current.targetId) : null;
      if (!target) return this.#rejectControlCommand(current, "target-missing", null, mutationId);
      if (target.version !== current.targetVersion) {
        return this.#rejectControlCommand(current, "target-stale", null, mutationId);
      }
      if (current.expectedVersion != null && target.version !== current.expectedVersion) {
        return this.#rejectControlCommand(current, "expected-version-conflict", null, mutationId);
      }

      if (!approvalId) {
        return { action: "WAIT", reason: "approval-required", command: structuredClone(current) };
      }

      let approval;
      try {
        approval = this.assertApprovalUsable({
          approvalId,
          targetType: current.targetType,
          targetId: current.targetId,
          targetVersion: current.targetVersion,
          action: current.action,
          capability: current.capability,
          scope: current.scope,
          commandId: current.id,
        });
      } catch (error) {
        if (!(error instanceof ApprovalError)) throw error;
        const reason = `approval-${String(error.approvalReason).toLowerCase().replaceAll("_", "-")}`;
        if (
          error.approvalReason === ApprovalFailureReason.MISSING ||
          error.approvalReason === ApprovalFailureReason.PENDING
        ) {
          return {
            action: "WAIT",
            reason,
            approvalReason: error.approvalReason,
            command: structuredClone(current),
          };
        }
        return this.#rejectControlCommand(current, reason, error.approvalReason, mutationId, approvalId);
      }

      const next = {
        ...current,
        version: current.version + 1,
        status: CommandStatus.AUTHORIZED,
        authorization: {
          approvalId: approval.id,
          authorizedAt: now(),
          rejectedAt: null,
          reason: "command-authorized",
          approvalReason: null,
        },
        updatedAt: now(),
      };
      this.#assertCommandCoherent(next);
      if (!this.updateRecord(Collection.COMMAND, current.id, next, current.version)) {
        throw new ConflictError(
          `command ${current.id} expected v${current.version}, but it changed in another writer`,
        );
      }
      this.#event("command.authorized", current.id, {
        approvalId: approval.id,
        targetType: current.targetType,
        targetId: current.targetId,
        targetVersion: current.targetVersion,
      }, { commandId: mutationId, aggregateVersion: next.version });
      this.#rememberCommand(mutationId, "authorizeControlCommand", current.id);
      return {
        action: "AUTHORIZE",
        reason: "command-authorized",
        command: structuredClone(next),
        approval: structuredClone(approval),
      };
    });
  }

  seedApproval(approval) {
    return this.runInTransaction(() => {
      const record = structuredClone(approval);
      this.#assertApprovalCoherent(record);
      if (!this.insertRecord(Collection.APPROVAL, record.id, record)) {
        throw new Error(`approval already exists: ${record.id}`);
      }
      this.#event("approval.requested", record.id, this.#approvalRequestPayload(record), {
        aggregateVersion: record.version,
      });
      const stored = record.decision.status;
      // REVOKED implies a grant happened first: a revoked approval without an
      // `approval.approved` event would be a fact with no history.
      if (stored === ApprovalStatus.REVOKED) {
        this.#event("approval.approved", record.id, this.#approvalDecisionPayload(record), {
          aggregateVersion: record.version,
        });
      }
      if (stored !== ApprovalStatus.PENDING) {
        this.#event(APPROVAL_TRANSITIONS[stored].event, record.id, {
          ...this.#approvalDecisionPayload(record),
          ...(record.revocation ?? {}),
        }, { aggregateVersion: record.version });
      }
      return structuredClone(record);
    });
  }

  getApproval(id) {
    return structuredClone(this.#required(Collection.APPROVAL, id, "approval"));
  }

  /**
   * Every approval about one target.
   *
   * Lookups by target/status are resolved HERE, from the authoritative records,
   * rather than through a backend filter: an approval's target and status live
   * inside the request/decision blocks, and a filter vocabulary that only one
   * backend could honour would make the same call mean two different things.
   */
  getApprovalsForTarget(targetType, targetId) {
    return structuredClone(this.allRecords(Collection.APPROVAL).filter(
      (approval) => approval.request?.targetType === targetType && approval.request?.targetId === targetId,
    ));
  }

  /**
   * Every approval whose EFFECTIVE status is `status` right now — so a query for
   * APPROVED can never return a permission whose deadline has already passed.
   */
  getApprovalsInStatus(status, at = new Date()) {
    return structuredClone(this.allRecords(Collection.APPROVAL).filter(
      (approval) => effectiveApprovalStatus(approval, at) === status,
    ));
  }

  /**
   * Creates a PENDING request and pins the target state it is about.
   *
   * The version is READ FROM THE TARGET, never taken from the caller: an
   * approval that merely claims to be about v3 while the target is already at v4
   * would be a permission for a state that does not exist.
   *
   * A COMMAND target remains refused in G2 even though durable Command identity
   * now exists. Whether permission targets the Command or the underlying
   * Project/Task action is deliberately deferred to Policy/Approval composition.
   */
  requestApproval(request, { commandId = null } = {}) {
    return this.runInTransaction(() => {
      const replay = this.#replayCommand(commandId, "requestApproval");
      if (replay) return this.getApproval(replay);

      if (request.targetType === ApprovalTargetType.COMMAND) {
        throw new InvariantError(COMMAND_APPROVAL_UNAVAILABLE);
      }

      const targetVersion = this.#approvalTargetVersion(request.targetType, request.targetId);
      const declared = request.targetVersion ?? null;
      if (targetVersion != null && declared != null && declared !== targetVersion) {
        throw new InvariantError(
          `approval target ${request.targetId} is v${targetVersion}, not v${declared}: ` +
            "a request pins the state it was actually made against",
        );
      }
      const approval = createApproval({ ...request, targetVersion });
      this.#assertApprovalCoherent(approval);
      if (!this.insertRecord(Collection.APPROVAL, approval.id, structuredClone(approval))) {
        throw new Error(`approval already exists: ${approval.id}`);
      }
      this.#event("approval.requested", approval.id, this.#approvalRequestPayload(approval), {
        commandId,
        aggregateVersion: approval.version,
      });
      this.#rememberCommand(commandId, "requestApproval", approval.id);
      return structuredClone(approval);
    });
  }

  /**
   * Applies a human decision: APPROVE or REJECT.
   *
   * A decision must name who made it — an unattributed APPROVED is exactly the
   * fact this round exists to prevent — and it may only be taken while the
   * request is still open. Re-deciding is refused rather than treated as a no-op,
   * because "approve it again" and "it is already approved" are different
   * statements, and a second `approval.approved` event would be a second claim
   * about the same permission.
   */
  decideApproval(approvalId, expectedVersion, { decision, decidedBy, reason = null } = {}, { commandId = null } = {}) {
    const targetStatus = decision === ApprovalDecision.APPROVE
      ? ApprovalStatus.APPROVED
      : decision === ApprovalDecision.REJECT
        ? ApprovalStatus.REJECTED
        : null;
    if (!targetStatus) throw new InvariantError(`unknown approval decision: ${decision}`);
    if (typeof decidedBy !== "string" || decidedBy.trim() === "") {
      throw new InvariantError(`approval ${approvalId} cannot be ${targetStatus} without a deciding subject`);
    }
    return this.#mutateApproval(approvalId, expectedVersion, targetStatus, "decideApproval", {
      commandId,
      build: (current) => ({
        ...current,
        decision: {
          status: targetStatus,
          decidedBy,
          decidedAt: now(),
          reason,
        },
      }),
    });
  }

  /**
   * Withdraws a grant. REVOKED does not mean "the operation failed" — it means
   * the permission that existed no longer does. Who revoked it, when, and why are
   * recorded, and the original decision is preserved beside them: a revocation is
   * history over a decision, not an edit of it.
   */
  revokeApproval(approvalId, expectedVersion, { revokedBy, reason } = {}, { commandId = null } = {}) {
    if (typeof revokedBy !== "string" || revokedBy.trim() === "") {
      throw new InvariantError(`approval ${approvalId} cannot be REVOKED without a revoking subject`);
    }
    if (typeof reason !== "string" || reason.trim() === "") {
      throw new InvariantError(`approval ${approvalId} cannot be REVOKED without a reason`);
    }
    return this.#mutateApproval(approvalId, expectedVersion, ApprovalStatus.REVOKED, "revokeApproval", {
      commandId,
      build: (current) => ({
        ...current,
        decision: { ...current.decision, status: ApprovalStatus.REVOKED },
        revocation: { revokedBy, revokedAt: now(), reason },
      }),
      // The event states the revocation, not the decision it superseded: who
      // withdrew the permission, when, and why.
      payload: (next) => ({ ...next.revocation }),
    });
  }

  /**
   * Records an expiry that has ALREADY happened, and is the only thing that ever
   * persists APPROVED → EXPIRED. Read paths treat the approval as expired the
   * moment its deadline passes (`effectiveApprovalStatus`); this operation is for
   * making that visible in the durable record and the event log, on first
   * detection, with no scheduler anywhere in the system.
   *
   * Claiming an expiry that has not happened is refused: EXPIRED is an
   * observation about the clock, not a decision someone may take.
   */
  expireApproval(approvalId, expectedVersion, { commandId = null, at = new Date() } = {}) {
    const current = this.#required(Collection.APPROVAL, approvalId, "approval");
    if (!current.expiresAt) {
      throw new InvariantError(`approval ${approvalId} has no deadline and cannot expire`);
    }
    if (at.getTime() <= Date.parse(current.expiresAt)) {
      throw new InvariantError(
        `approval ${approvalId} has not passed its deadline (${current.expiresAt}) and cannot be recorded as EXPIRED`,
      );
    }
    const from = current.decision.status;
    return this.#mutateApproval(approvalId, expectedVersion, ApprovalStatus.EXPIRED, "expireApproval", {
      commandId,
      build: (record) => ({
        ...record,
        decision: { ...record.decision, status: ApprovalStatus.EXPIRED },
      }),
      payload: () => ({ expiresAt: current.expiresAt, from }),
    });
  }

  /**
   * The only field an existing request may move is its deadline, and only while
   * nobody has decided it. Everything that defines WHAT was approved (target,
   * version, action, capability, scope, risk, requester, bound command) is bound
   * for the life of the approval, and the decision block is never edited: a
   * decision is superseded by revocation, or replaced by a NEW request.
   */
  updateApproval(id, expectedVersion, patch, { commandId = null } = {}) {
    return this.runInTransaction(() => {
      const replay = this.#replayCommand(commandId, "updateApproval");
      if (replay) return this.getApproval(replay);
      const current = this.#required(Collection.APPROVAL, id, "approval");
      if (current.version !== expectedVersion) {
        throw new ConflictError(`approval ${id} expected v${expectedVersion}, current v${current.version}`);
      }
      const status = effectiveApprovalStatus(current);
      if (status !== ApprovalStatus.PENDING) {
        throw new InvariantError(
          `approval ${id} is ${status}: a decided request is not edited, it is revoked or replaced`,
        );
      }
      for (const field of Object.keys(patch ?? {})) {
        if (APPROVAL_UPDATABLE_FIELDS.includes(field)) continue;
        throw new InvariantError(
          APPROVAL_BOUND_FIELDS.includes(field)
            ? `approval ${id} binds ${field}: it defines what was approved and cannot be changed`
            : `approval ${id} cannot be updated in ${field}`,
        );
      }
      const next = {
        ...current,
        ...structuredClone(patch ?? {}),
        version: current.version + 1,
        updatedAt: now(),
      };
      this.#assertApprovalCoherent(next);
      if (!this.updateRecord(Collection.APPROVAL, id, next, expectedVersion)) {
        throw new ConflictError(`approval ${id} expected v${expectedVersion}, but it changed in another writer`);
      }
      this.#event("approval.updated", id, { patch: structuredClone(patch ?? {}) }, {
        commandId,
        aggregateVersion: next.version,
      });
      this.#rememberCommand(commandId, "updateApproval", id);
      return structuredClone(next);
    });
  }

  /**
   * Proves that an Approval authorizes a concrete action, right now, on the
   * target state as it is NOW. Pure read: nothing is written, nothing is
   * consumed, and no "used" flag exists in v0.1 — recording consumption would be
   * effect tracking, which is a later problem (and a read-only check stays
   * honest: it cannot half-succeed).
   *
   * Every check fails closed, and the failure carries a machine-readable reason:
   * existence, effective status, attribution, target type, target id, action,
   * CAPABILITY, scope, the bound command, expiry, and — the one that matters most
   * — the target's CURRENT version. An approval pinned to v3 authorizes v3 and
   * nothing else; when the target moves to v4 the permission is STALE, not
   * extended.
   *
   * `capability` is checked as strictly as `action`: an approval to run a
   * capability is not a permission to do something else that happens to look
   * similar, and the presented capability is part of what is being authorized.
   */

  assertApprovalUsable({
    approvalId,
    targetType,
    targetId,
    targetVersion = null,
    action,
    capability,
    scope,
    commandId = null,
    at = new Date(),
  } = {}) {
    // A consumption must SAY which capability it exercises. An unnamed capability
    // is a caller that cannot be authorized, not a wildcard.
    if (typeof capability !== "string" || capability.trim() === "") {
      throw new InvariantError(
        `approval consumption must present the capability it exercises (approval ${approvalId})`,
      );
    }
    // COMMAND-target approvals remain reserved in G2. Durable Command identity
    // exists, but the Policy/Approval target semantics are not frozen yet.
    if (targetType === ApprovalTargetType.COMMAND) {
      throw new InvariantError(COMMAND_APPROVAL_UNAVAILABLE);
    }

    const approval = this.getRecord(Collection.APPROVAL, approvalId);
    if (!approval) {
      throw new ApprovalError(
        ApprovalFailureReason.MISSING,
        `approval not found: ${approvalId}`,
      );
    }

    const status = effectiveApprovalStatus(approval, at);
    if (status !== ApprovalStatus.APPROVED) {
      // The reason IS the status, so "still pending", "rejected", "revoked" and
      // "expired" stay distinguishable. A status this version cannot reason about
      // is reported as UNKNOWN rather than quietly treated as usable.
      const reason = typeof status === "string" && ApprovalFailureReason[status]
        ? ApprovalFailureReason[status]
        : ApprovalFailureReason.UNKNOWN;
      const explanation = status === ApprovalStatus.PENDING
        ? "is still PENDING and authorizes nothing"
        : status === ApprovalStatus.EXPIRED
          ? `EXPIRED at ${approval.expiresAt} and no longer authorizes anything`
          : `is ${status ?? "(no status)"} and authorizes nothing`;
      throw new ApprovalError(reason, `approval ${approval.id} ${explanation}`);
    }

    // An APPROVED approval with no named approver cannot exist through the rules;
    // if it exists anyway (hand-edited durable state, an older writer) it must not
    // authorize anything either.
    if (
      typeof approval.decision.decidedBy !== "string" ||
      approval.decision.decidedBy.trim() === "" ||
      !approval.decision.decidedAt
    ) {
      throw new ApprovalError(
        ApprovalFailureReason.UNATTRIBUTED,
        `approval ${approval.id} is APPROVED without an attributable decision`,
      );
    }

    const request = approval.request;
    const mismatch = (reason, detail) => new ApprovalError(
      reason,
      `approval ${approval.id} ${detail}`,
    );

    if (request.targetType !== targetType) {
      throw mismatch(
        ApprovalFailureReason.TARGET_TYPE_MISMATCH,
        `authorizes ${request.targetType} ${request.targetId}, not ${targetType} ${targetId}`,
      );
    }
    if (request.targetId !== targetId) {
      throw mismatch(
        ApprovalFailureReason.TARGET_ID_MISMATCH,
        `authorizes ${request.targetType} ${request.targetId}, not ${targetId}`,
      );
    }
    if (request.action !== action) {
      throw mismatch(ApprovalFailureReason.ACTION_MISMATCH, `authorizes action "${request.action}", not "${action}"`);
    }
    // The capability is part of the authorized action, so it is compared exactly
    // and independently: matching action + scope with a different capability is a
    // different authorization, not a variation of this one.
    if (request.capability !== capability) {
      throw mismatch(
        ApprovalFailureReason.CAPABILITY_MISMATCH,
        `authorizes capability "${request.capability}", not "${capability}"`,
      );
    }
    if (request.scope !== scope) {
      throw mismatch(ApprovalFailureReason.SCOPE_MISMATCH, `authorizes scope "${request.scope}", not "${scope}"`);
    }

    // A command-bound approval is consumed by that command and no other.
    if (approval.commandId != null && approval.commandId !== commandId) {
      throw mismatch(
        ApprovalFailureReason.COMMAND_MISMATCH,
        `is bound to command ${approval.commandId}, not ${commandId ?? "(none)"}`,
      );
    }

    // No COMMAND branch: an approval about a Command cannot exist in v0.1 (see
    // the guard at the top), so anything reaching here is a real aggregate with a
    // real version, and current reality decides whether the permission still
    // applies.

    // Current Reality outranks a recorded permission: the version that was
    // approved must still be the version that exists.
    const currentVersion = this.#findApprovalTargetVersion(request.targetType, request.targetId);
    if (currentVersion == null) {
      throw mismatch(
        ApprovalFailureReason.TARGET_MISSING,
        `authorizes ${request.targetType} ${request.targetId}, which does not exist`,
      );
    }
    if (currentVersion !== request.targetVersion) {
      throw mismatch(
        ApprovalFailureReason.STALE,
        `authorizes ${request.targetType} ${request.targetId} v${request.targetVersion}, ` +
          `which is now v${currentVersion}`,
      );
    }
    if (targetVersion != null && targetVersion !== request.targetVersion) {
      throw mismatch(
        ApprovalFailureReason.STALE,
        `authorizes ${request.targetType} ${request.targetId} v${request.targetVersion}, not v${targetVersion}`,
      );
    }

    return structuredClone(approval);
  }

  // ── Approval internals ────────────────────────────────────────────────────

  /**
   * The single writer for every approval lifecycle transition.
   *
   * State, event and command row commit together, and the compare-and-set write
   * is what makes two approvers racing on the same version produce ONE decision:
   * the loser gets a conflict, never a second `approval.approved` event.
   */
  #mutateApproval(approvalId, expectedVersion, targetStatus, operation, { commandId = null, build, payload = null } = {}) {
    return this.runInTransaction(() => {
      const replay = this.#replayCommand(commandId, operation);
      if (replay) return this.getApproval(replay);

      const current = this.#required(Collection.APPROVAL, approvalId, "approval");
      if (current.version !== expectedVersion) {
        throw new ConflictError(`approval ${approvalId} expected v${expectedVersion}, current v${current.version}`);
      }
      const transition = APPROVAL_TRANSITIONS[targetStatus];
      const stored = current.decision.status;
      if (!transition.from.includes(stored)) {
        throw new InvariantError(
          stored === targetStatus
            ? `approval ${approvalId} is already ${targetStatus}: a decision is taken once, and a repeat is not a no-op`
            : `approval ${approvalId} is ${stored} and may not become ${targetStatus}`,
        );
      }
      // A deadline that has passed closes the request. Every transition except
      // recording the expiry itself is refused once the approval is effectively
      // EXPIRED — including a revocation, which needs a grant that is still valid
      // to withdraw.
      const effective = effectiveApprovalStatus(current);
      if (targetStatus !== ApprovalStatus.EXPIRED && effective !== stored) {
        throw new InvariantError(
          `approval ${approvalId} is ${effective} (deadline ${current.expiresAt}) and may not become ${targetStatus}`,
        );
      }

      const next = {
        ...build(current),
        version: current.version + 1,
        updatedAt: now(),
      };
      this.#assertApprovalCoherent(next);
      if (!this.updateRecord(Collection.APPROVAL, approvalId, next, expectedVersion)) {
        throw new ConflictError(`approval ${approvalId} expected v${expectedVersion}, but it changed in another writer`);
      }
      this.#event(transition.event, approvalId, payload ? payload(next) : this.#approvalDecisionPayload(next), {
        commandId,
        aggregateVersion: next.version,
      });
      this.#rememberCommand(commandId, operation, approvalId);
      return structuredClone(next);
    });
  }

  #rejectControlCommand(current, reason, approvalReason, mutationId, approvalId = null) {
    const next = {
      ...current,
      version: current.version + 1,
      status: CommandStatus.REJECTED,
      authorization: {
        approvalId,
        authorizedAt: null,
        rejectedAt: now(),
        reason,
        approvalReason,
      },
      updatedAt: now(),
    };
    this.#assertCommandCoherent(next);
    if (!this.updateRecord(Collection.COMMAND, current.id, next, current.version)) {
      throw new ConflictError(
        `command ${current.id} expected v${current.version}, but it changed in another writer`,
      );
    }
    this.#event("command.rejected", current.id, {
      reason,
      approvalReason,
      approvalId,
      targetType: current.targetType,
      targetId: current.targetId,
      targetVersion: current.targetVersion,
    }, { commandId: mutationId, aggregateVersion: next.version });
    this.#rememberCommand(mutationId, "authorizeControlCommand", current.id);
    return { action: "REJECT", reason, approvalReason, command: structuredClone(next) };
  }

  #commandIntentPayload(command) {
    return {
      targetType: command.targetType,
      targetId: command.targetId,
      targetVersion: command.targetVersion,
      action: command.action,
      capability: command.capability,
      scope: command.scope,
      riskLevel: command.riskLevel,
      requestedBy: command.requestedBy,
      expectedVersion: command.expectedVersion,
      idempotencyKey: command.idempotencyKey,
    };
  }

  #assertCommandCoherent(command) {
    if (!command?.id || !Number.isInteger(command.version) || command.version < 1) {
      throw new InvariantError("command identity is incomplete");
    }
    if (!Object.values(CommandTargetType).includes(command.targetType)) {
      throw new InvariantError(`command ${command.id} has unknown target type: ${command.targetType}`);
    }
    for (const field of ["targetId", "action", "capability", "scope", "requestedBy", "idempotencyKey"]) {
      if (typeof command[field] !== "string" || command[field].trim() === "") {
        throw new InvariantError(`command ${command.id} binds no ${field}`);
      }
    }
    if (!Number.isInteger(command.targetVersion) || command.targetVersion < 1) {
      throw new InvariantError(`command ${command.id} has invalid targetVersion`);
    }
    if (
      command.expectedVersion != null &&
      (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 1)
    ) {
      throw new InvariantError(`command ${command.id} has invalid expectedVersion`);
    }
    if (!Object.values(CommandStatus).includes(command.status)) {
      throw new InvariantError(`command ${command.id} has unknown status: ${command.status}`);
    }
    if (!G2_COMMAND_WRITABLE_STATUSES.includes(command.status)) {
      throw new InvariantError(
        `command ${command.id} status ${command.status} is reserved until the G3 Effect boundary`,
      );
    }
    const authorization = command.authorization ?? {};
    if (command.status === CommandStatus.CREATED) {
      if (authorization.authorizedAt || authorization.rejectedAt) {
        throw new InvariantError(`command ${command.id} is CREATED but carries an authorization decision`);
      }
    } else if (command.status === CommandStatus.AUTHORIZED) {
      if (!authorization.authorizedAt || !authorization.approvalId || authorization.rejectedAt) {
        throw new InvariantError(`command ${command.id} is AUTHORIZED without an attributable authorization`);
      }
    } else if (command.status === CommandStatus.REJECTED) {
      if (!authorization.rejectedAt || authorization.authorizedAt || !authorization.reason) {
        throw new InvariantError(`command ${command.id} is REJECTED without a rejection fact`);
      }
    }
  }

  /** Current authoritative version of an approval target, or null when there is none. */
  #findApprovalTargetVersion(targetType, targetId) {
    const collection = APPROVAL_TARGET_COLLECTION[targetType];
    if (!collection) return null;
    const record = this.getRecord(collection, targetId);
    return record ? record.version : null;
  }

  /** Same, but a missing target is a refusal: an approval about nothing is not a fact. */
  #approvalTargetVersion(targetType, targetId) {
    const collection = APPROVAL_TARGET_COLLECTION[targetType];
    if (!collection) {
      // Only COMMAND is absent from the map, and a COMMAND approval cannot reach
      // this far: every door refuses it first (see COMMAND_APPROVAL_UNAVAILABLE).
      throw new InvariantError(COMMAND_APPROVAL_UNAVAILABLE);
    }
    const record = this.getRecord(collection, targetId);
    if (!record) {
      throw new InvariantError(`approval target not found: ${targetType} ${targetId}`);
    }
    return record.version;
  }

  /**
   * Proves that a stored Approval record is internally coherent.
   *
   * It runs on every seed and every transition, including the transition that is
   * about to be written, so an incoherent approval cannot enter the store through
   * any door. What it protects is exactly the pair this round is about: a
   * permission must be ATTRIBUTABLE (who decided), BOUND (what/where/which
   * version), and its status must agree with the facts stored beside it.
   */
  #assertApprovalCoherent(approval) {
    const id = approval?.id;
    if (!id || !Number.isInteger(approval.version) || approval.version < 1) {
      throw new InvariantError("approval identity is incomplete");
    }
    const request = approval.request ?? {};
    if (!Object.values(ApprovalTargetType).includes(request.targetType)) {
      throw new InvariantError(`approval ${id} has an unknown target type: ${request.targetType}`);
    }
    if (typeof request.targetId !== "string" || request.targetId.trim() === "") {
      throw new InvariantError(`approval ${id} names no target`);
    }
    for (const field of ["action", "capability", "scope"]) {
      if (typeof request[field] !== "string" || request[field].trim() === "") {
        throw new InvariantError(`approval ${id} binds no ${field}`);
      }
    }
    if (typeof approval.requestedBy !== "string" || approval.requestedBy.trim() === "") {
      throw new InvariantError(`approval ${id} names no requester`);
    }
    if (request.targetType === ApprovalTargetType.COMMAND) {
      // Reserved in the vocabulary, unsupported in G2: Command identity exists,
      // but Policy/Approval composition has not yet decided this target form.
      throw new InvariantError(COMMAND_APPROVAL_UNAVAILABLE);
    }
    if (!Number.isInteger(request.targetVersion) || request.targetVersion < 1) {
      throw new InvariantError(
        `approval ${id} must pin the target version it authorizes, got ${request.targetVersion}`,
      );
    }

    const status = approval.decision?.status;
    if (!Object.values(ApprovalStatus).includes(status)) {
      throw new InvariantError(`approval ${id} has an unknown status: ${status}`);
    }
    const attributed = typeof approval.decision.decidedBy === "string"
      && approval.decision.decidedBy.trim() !== ""
      && Boolean(approval.decision.decidedAt);

    if (status === ApprovalStatus.APPROVED && !attributed) {
      // The headline rule of this round, enforced at the boundary: no approver,
      // no approval.
      throw new InvariantError(`approval ${id} is APPROVED without an attributable decision`);
    }
    if (status === ApprovalStatus.REJECTED && !attributed) {
      throw new InvariantError(`approval ${id} is REJECTED without an attributable decision`);
    }
    if (status === ApprovalStatus.PENDING && (approval.decision.decidedBy != null || approval.decision.decidedAt != null)) {
      throw new InvariantError(`approval ${id} is PENDING but already carries a decision`);
    }
    if (status === ApprovalStatus.EXPIRED && !approval.expiresAt) {
      throw new InvariantError(`approval ${id} is EXPIRED without a deadline`);
    }
    if (status === ApprovalStatus.REVOKED) {
      if (!attributed) {
        throw new InvariantError(`approval ${id} is REVOKED without the decision it revoked`);
      }
      const revocation = approval.revocation ?? {};
      if (
        typeof revocation.revokedBy !== "string" || revocation.revokedBy.trim() === "" ||
        !revocation.revokedAt ||
        typeof revocation.reason !== "string" || revocation.reason.trim() === ""
      ) {
        throw new InvariantError(`approval ${id} is REVOKED without recording who revoked it, when, and why`);
      }
    } else if (approval.revocation != null) {
      throw new InvariantError(`approval ${id} is ${status} but carries a revocation`);
    }
    if (approval.expiresAt != null && Number.isNaN(Date.parse(approval.expiresAt))) {
      throw new InvariantError(`approval ${id} has an unreadable deadline: ${approval.expiresAt}`);
    }
  }

  #approvalRequestPayload(approval) {
    const { targetType, targetId, targetVersion, action, capability, scope, riskLevel } = approval.request;
    return {
      targetType,
      targetId,
      targetVersion,
      action,
      capability,
      scope,
      riskLevel,
      requestedBy: approval.requestedBy,
      expiresAt: approval.expiresAt,
      commandId: approval.commandId,
    };
  }

  #approvalDecisionPayload(approval) {
    return {
      status: approval.decision.status,
      decidedBy: approval.decision.decidedBy,
      decidedAt: approval.decision.decidedAt,
      reason: approval.decision.reason,
    };
  }

  /**
   * Resolves one contract revision and proves its content is unchanged. A
   * revision is always named explicitly — there is no implicit "current
   * version" lookup — and mutating contract content without a new version fails
   * closed instead of being silently trusted.
   */
  #acceptanceRevision(id, version) {
    if (version == null) {
      throw new InvariantError(`acceptance contract revision must be named explicitly: ${id}`);
    }
    const key = acceptanceKey(id, version);
    const acceptance = this.getRecord(Collection.ACCEPTANCE, key);
    if (!acceptance) {
      throw new InvariantError(`acceptance contract revision not found: ${id} v${version}`);
    }
    if (this.getContractFingerprint(key) !== acceptanceContractFingerprint(acceptance)) {
      throw new InvariantError(`acceptance contract content changed without a new revision: ${id} v${version}`);
    }
    return acceptance;
  }

  /** Latest revision of a contract; used only to create the next revision. */
  #acceptanceHead(id) {
    let head = null;
    for (const acceptance of this.recordsMatching(Collection.ACCEPTANCE, "id", id)) {
      if (!head || acceptance.version > head.version) head = acceptance;
    }
    if (!head) throw new InvariantError(`acceptance not found: ${id}`);
    return head;
  }

  /**
   * The shared Goal / Milestone acceptance write.
   *
   * It takes a decision the Control Plane is not allowed to infer: the target's
   * contract revision, a PASS Verification, and evidence that still describes
   * the current child state are all re-proved here, inside the same transaction
   * as the status change — so a state that moved between the check and the write
   * cannot be accepted on the strength of a stale reading.
   */
  #acceptAggregate(collection, id, expectedVersion, operation, { verificationId, commandId = null } = {}) {
    return this.runInTransaction(() => {
      const replay = this.#replayCommand(commandId, operation);
      if (replay) return structuredClone(this.#required(collection, replay, "aggregate"));

      const target = this.#required(collection, id, "aggregate");
      if (target.version !== expectedVersion) {
        throw new ConflictError(`${collection} ${id} expected v${expectedVersion}, current v${target.version}`);
      }
      // Same whitelist rule as a Task, for the same reason: an unlisted state is
      // refused by default, and BLOCKED (a control state awaiting resolution) or
      // a terminal state is never reversed by acceptance.
      const allowed = ACCEPTABLE_SOURCE_AGGREGATE_STATES[collection];
      const targetStatus = ACCEPTED_TARGET_STATUS[collection];
      if (!allowed.includes(target.status)) {
        throw new InvariantError(
          target.status === targetStatus
            ? `${collection} ${id} is already ${targetStatus}: acceptance is terminal`
            : `${collection} ${id} is ${target.status} and may not enter ${targetStatus}: ` +
              `parent acceptance requires one of ${allowed.join(", ")}`,
        );
      }
      if (target.acceptanceId == null || target.acceptanceVersion == null) {
        throw new InvariantError(`${collection} ${id} has no acceptance contract to be accepted against`);
      }
      this.#assertAcceptanceContract(collection, target);
      const acceptance = this.#acceptanceRevision(target.acceptanceId, target.acceptanceVersion);

      const verification = this.#required(Collection.VERIFICATION, verificationId, "verification");
      if (verification.verdict !== "PASS") {
        throw new InvariantError(`${collection} ${id} cannot be accepted by a ${verification.verdict} verification`);
      }
      this.#proveAggregateVerification({ collection, target, verification });

      const next = {
        ...target,
        status: targetStatus,
        version: target.version + 1,
        updatedAt: now(),
      };
      if (!this.updateRecord(collection, id, next, expectedVersion)) {
        throw new ConflictError(`${collection} ${id} expected v${expectedVersion}, but it changed in another writer`);
      }
      // The revision record keeps its contract version; only the decision moves.
      this.putRecord(
        Collection.ACCEPTANCE,
        acceptanceKey(acceptance.id, acceptance.version),
        { ...acceptance, status: "PASSED", updatedAt: now() },
      );
      // The lifecycle event is named by the status reached — `goal.accepted`
      // versus `milestone.completed` — from the single mapping above.
      this.#event(
        LIFECYCLE_EVENT_TYPES[collection][targetStatus],
        id,
        { verificationId, version: next.version },
        { commandId, aggregateVersion: next.version },
      );
      this.#rememberCommand(commandId, operation, id);
      return structuredClone(next);
    });
  }

  /**
   * The aggregate state a parent's Evidence observes: one entry per child, in a
   * deterministic order, built ONLY from the authoritative child records found
   * through the child's own parent link.
   *
   * `Goal.taskIds` / `Milestone.goalIds` are derived caches and play no part: a
   * snapshot taken from a stale cache would be evidence about a list, not about
   * the project. An empty child set is refused rather than snapshotted, and so is
   * any child that has not reached its finished state — an unfinished aggregate
   * has no "finished" observation to record.
   */
  #childSnapshot(collection, target) {
    const childCollection = collection === Collection.GOAL ? Collection.TASK : Collection.GOAL;
    const linkField = collection === Collection.GOAL ? "goalId" : "milestoneId";
    const finishedStatus = ACCEPTED_CHILD_STATUS[collection];
    const children = this.recordsMatching(childCollection, linkField, target.id)
      .map((child) => ({
        refType: CHILD_REF_TYPE[collection],
        collection: childCollection,
        id: child.id,
        version: child.version,
        status: child.status,
        acceptanceId: child.acceptanceId ?? null,
        acceptanceVersion: child.acceptanceVersion ?? null,
      }))
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

    if (children.length === 0) {
      throw new InvariantError(`${collection} ${target.id} has no ${childCollection} to observe`);
    }
    const unfinished = children.filter((child) => child.status !== finishedStatus);
    if (unfinished.length) {
      throw new InvariantError(
        `${collection} ${target.id} is not finished: ` +
          unfinished.map((child) => `${child.id} is ${child.status}`).join(", "),
      );
    }
    return { targetType: ACCEPTANCE_TARGET_TYPE_BY_COLLECTION[collection], targetId: target.id, children };
  }

  /**
   * Re-derives the child snapshot from live records. Current Reality outranks
   * Historical Evidence: evidence describing a state the aggregate has left is
   * no longer a proof about the aggregate, however well-formed the verification
   * recorded against it may be.
   */
  #assertSnapshotCurrent({ collection, target, evidence }) {
    const current = snapshotRevision(this.#childSnapshot(collection, target));
    if (evidence.revision !== current) {
      throw new InvariantError(
        `aggregate evidence ${evidence.id} no longer describes the current state of ${target.id}`,
      );
    }
  }

  /**
   * Proves that a Verification may legally speak for a Goal or a Milestone.
   *
   * Aggregate evidence is not a Runtime product, so there is no Run/Attempt
   * lineage to walk. What replaces it is the snapshot identity: the evidence must
   * have observed THIS target, must carry no Run or Attempt, must be the
   * evidence of the contract revision the target pins, and must still describe
   * the child state as it is now. The same routine guards both doors, exactly as
   * its Task counterpart does.
   */
  #proveAggregateVerification({ collection, target, verification }) {
    const targetType = ACCEPTANCE_TARGET_TYPE_BY_COLLECTION[collection];
    if (verification.targetType !== targetType || verification.targetId !== target.id) {
      throw new InvariantError(
        `verification ${verification.id} does not belong to ${targetType} ${target.id}`,
      );
    }
    // An aggregate has no task, so an aggregate verification may not declare one.
    if (verification.taskId != null) {
      throw new InvariantError(
        `verification ${verification.id} is about ${targetType} ${target.id} and must not declare a task`,
      );
    }
    const acceptance = this.#acceptanceRevision(target.acceptanceId, target.acceptanceVersion);
    if (verification.acceptanceId !== acceptance.id || verification.acceptanceVersion !== acceptance.version) {
      throw new InvariantError(
        `verification ${verification.id} does not match the acceptance contract revision pinned by ${target.id}`,
      );
    }
    if (!verification.evidenceIds?.length) {
      throw new InvariantError(`verification ${verification.id} references no evidence`);
    }

    const chain = [];
    for (const evidenceId of verification.evidenceIds) {
      const evidence = this.#required(Collection.EVIDENCE, evidenceId, "evidence");
      if (evidence.targetType !== targetType || evidence.targetId !== target.id) {
        throw new InvariantError(`evidence ${evidenceId} does not belong to ${targetType} ${target.id}`);
      }
      // Aggregate evidence must not claim a Runtime product it never had.
      if (evidence.taskId != null || evidence.runId != null || evidence.attemptId != null) {
        throw new InvariantError(`aggregate evidence ${evidenceId} must not reference a task, run or attempt`);
      }
      if (evidence.acceptanceId !== acceptance.id || evidence.acceptanceVersion !== acceptance.version) {
        throw new InvariantError(`evidence ${evidenceId} does not match the acceptance contract of ${target.id}`);
      }
      this.#assertSnapshotCurrent({ collection, target, evidence });
      if (chain.length && evidence.revision !== chain[0].revision) {
        throw new InvariantError("verification mixes evidence with different revisions");
      }
      if (
        verification.verdict === "PASS" &&
        evidence.status !== EvidenceStatus.CANDIDATE &&
        evidence.status !== EvidenceStatus.VERIFIED
      ) {
        throw new InvariantError(`evidence ${evidenceId} is ${evidence.status} and cannot support a PASS verification`);
      }
      chain.push(evidence);
    }

    if (verification.revision == null || verification.revision !== chain[0].revision) {
      throw new InvariantError("verification revision must match the revision of the evidence it refers to");
    }

    return { acceptance, evidence: chain };
  }

  /**
   * Proves that a Verification may legally speak for a Task.
   *
   * Evidence is a claim; ownership is re-derived from the aggregates this store
   * owns, never from the claim itself:
   *
   *   Task ← Run ← Attempt ← Evidence   (one continuous lineage)
   *
   * plus the acceptance contract that Task owns and one bound source revision.
   * The same routine guards both doors: recording a Verification (proved against
   * the task the verification declares) and accepting a Task (proved against the
   * task actually being accepted), so neither a forged nor a stale Verification
   * can slip through.
   */
  #proveVerification({ task, verification }) {
    if (verification.taskId !== task.id) {
      throw new InvariantError(`verification ${verification.id} does not belong to task ${task.id}`);
    }
    // The declared target and the declared task must be the same thing: a
    // verification may not claim one task while naming another as its target.
    if (verification.targetId != null && verification.targetId !== task.id) {
      throw new InvariantError(
        `verification ${verification.id} names target ${verification.targetId} but task ${task.id}`,
      );
    }
    const acceptance = this.#acceptanceRevision(task.acceptanceId, task.acceptanceVersion);
    if (verification.acceptanceId !== acceptance.id || verification.acceptanceVersion !== acceptance.version) {
      throw new InvariantError(
        `verification ${verification.id} does not match the acceptance contract revision pinned by ${task.id}`,
      );
    }
    if (!verification.evidenceIds?.length) {
      throw new InvariantError(`verification ${verification.id} references no evidence`);
    }

    const chain = [];
    for (const evidenceId of verification.evidenceIds) {
      const evidence = this.#required(Collection.EVIDENCE, evidenceId, "evidence");
      if (evidence.taskId !== task.id) {
        throw new InvariantError(`evidence ${evidenceId} does not belong to task ${task.id}`);
      }
      const run = this.#required(Collection.RUN, evidence.runId, "run");
      const attempt = this.#required(Collection.ATTEMPT, evidence.attemptId, "attempt");
      if (run.taskId !== task.id) {
        throw new InvariantError(`evidence ${evidenceId} references run ${run.id} of task ${run.taskId}`);
      }
      if (attempt.runId !== run.id) {
        throw new InvariantError(`evidence ${evidenceId} references attempt ${attempt.id} of run ${attempt.runId}`);
      }
      if (evidence.acceptanceId !== acceptance.id || evidence.acceptanceVersion !== acceptance.version) {
        throw new InvariantError(`evidence ${evidenceId} does not match the acceptance contract of ${task.id}`);
      }
      if (chain.length) {
        const first = chain[0];
        if (evidence.runId !== first.runId || evidence.attemptId !== first.attemptId) {
          throw new InvariantError("verification mixes evidence from different runs or attempts");
        }
        if (evidence.revision !== first.revision) {
          throw new InvariantError("verification mixes evidence with different revisions");
        }
      }
      if (
        verification.verdict === "PASS" &&
        evidence.status !== EvidenceStatus.CANDIDATE &&
        evidence.status !== EvidenceStatus.VERIFIED
      ) {
        throw new InvariantError(`evidence ${evidenceId} is ${evidence.status} and cannot support a PASS verification`);
      }
      chain.push(evidence);
    }

    // A verification must name the exact revision it verified; a missing revision
    // is never "acceptable by default".
    if (verification.revision == null || verification.revision !== chain[0].revision) {
      throw new InvariantError("verification revision must match the revision of the evidence it refers to");
    }

    return { acceptance, evidence: chain };
  }

  /**
   * Proves that a parent's pinned acceptance contract really is about that
   * parent, as a fact rather than as a convention.
   *
   * `acceptanceId` names a contract; the (id, version) pair names ONE revision of
   * it, and a revision that cannot be resolved — or whose content no longer
   * matches its fingerprint — fails closed in `#acceptanceRevision`. On top of
   * that, a Goal or Milestone must pin a contract whose target type and target id
   * are its own: otherwise a milestone could be accepted by a contract written
   * about a different milestone, or about a task. Both halves of the pin are
   * required together; a bare id is not a revision and a bare version names
   * nothing.
   *
   * Only Goal and Milestone are checked here. A Task keeps its own rules (it is
   * pinned at creation and re-proved through Run/Attempt lineage), and Project
   * acceptance has no v0.1 lifecycle, so this guard deliberately stays silent
   * about it instead of inventing a rule.
   */
  #assertAcceptanceContract(collection, record) {
    const targetType = ACCEPTANCE_TARGET_TYPE_BY_COLLECTION[collection];
    if (!targetType) return;

    const acceptanceId = record.acceptanceId ?? null;
    const acceptanceVersion = record.acceptanceVersion ?? null;
    if (acceptanceId == null && acceptanceVersion == null) return;
    if (acceptanceId == null) {
      throw new InvariantError(
        `${collection} ${record.id} pins acceptance revision v${acceptanceVersion} without naming a contract`,
      );
    }
    if (acceptanceVersion == null) {
      throw new InvariantError(
        `${collection} ${record.id} names acceptance contract ${acceptanceId} without pinning a revision`,
      );
    }

    const acceptance = this.#acceptanceRevision(acceptanceId, acceptanceVersion);
    if (acceptance.targetType !== targetType || acceptance.targetId !== record.id) {
      throw new InvariantError(
        `${collection} ${record.id} pins acceptance contract ${acceptanceId} v${acceptanceVersion}, ` +
          `which targets ${acceptance.targetType} ${acceptance.targetId}`,
      );
    }
  }

  /**
   * Proves that a child's explicit parent links, when present, point at
   * aggregates that actually exist, and that a Goal's own project does not
   * contradict the project its Milestone belongs to.
   *
   * Relationship integrity is validated here, in the shared semantics, for every
   * seed and every versioned update (including re-parenting). A dangling
   * Task → Goal, Goal → Milestone, Goal → Project or Milestone → Project link
   * fails closed instead of quietly becoming an orphan that aggregation can never
   * see; so does a Goal that would land in two projects at once.
   */
  #assertRelationship(collection, record) {
    const links = PARENT_LINKS[collection] ?? [];
    for (const link of links) {
      const parentId = record[link.field];
      if (parentId == null) continue;
      if (!this.getRecord(link.collection, parentId)) {
        throw new InvariantError(
          `${collection} ${record.id} references ${link.collection} ${parentId} (${link.field}), which does not exist`,
        );
      }
    }

    // A Goal attached to a Milestone must declare the same project that the
    // milestone belongs to. Otherwise "which project does this goal belong to?"
    // would have two answers — `Project A └ Goal X └ Milestone B └ Project B` —
    // and project membership would stop being unambiguous.
    if (collection === Collection.GOAL && record.milestoneId != null && record.projectId != null) {
      const milestone = this.getRecord(Collection.MILESTONE, record.milestoneId);
      if (milestone && milestone.projectId !== record.projectId) {
        throw new InvariantError(
          `goal ${record.id} declares project ${record.projectId} but its milestone ${milestone.id} ` +
            `belongs to project ${milestone.projectId}`,
        );
      }
    }
  }

  #mutateVersioned(collection, id, expectedVersion, patch, eventType, operation, commandId) {
    return this.runInTransaction(() => {
      const replay = this.#replayCommand(commandId, operation);
      if (replay) return structuredClone(this.#required(collection, replay, "aggregate"));
      const current = this.#required(collection, id, "aggregate");
      if (current.version !== expectedVersion) {
        throw new ConflictError(`${id} expected v${expectedVersion}, current v${current.version}`);
      }
      const next = {
        ...current,
        ...structuredClone(patch),
        version: current.version + 1,
        updatedAt: now(),
      };
      // A re-parenting update is validated exactly like a seed.
      this.#assertRelationship(collection, next);
      this.#assertAcceptanceContract(collection, next);
      if (!this.updateRecord(collection, id, next, expectedVersion)) {
        // The record moved between the read and the write (another connection).
        // The backend's compare-and-set is the second line of defence; it must
        // never silently overwrite a newer authoritative version.
        throw new ConflictError(`${id} expected v${expectedVersion}, but it changed in another writer`);
      }
      // A scope-level decision (goal accepted, milestone completed, project
      // completed) is recorded under its own event name; everything else is a
      // plain update of that aggregate.
      const recordedType = LIFECYCLE_EVENT_TYPES[collection]?.[next.status] ?? eventType;
      this.#event(recordedType, id, { version: next.version, patch: structuredClone(patch) }, { commandId, aggregateVersion: next.version });
      this.#rememberCommand(commandId, operation, id);
      return structuredClone(next);
    });
  }

  #replayCommand(commandId, operation) {
    if (!commandId) return null;
    const existing = this.getCommand(commandId);
    if (!existing) return null;
    if (existing.operation !== operation) {
      throw new InvariantError(`command ${commandId} was already used for another operation`);
    }
    return existing.resultId;
  }

  #rememberCommand(commandId, operation, resultId) {
    if (commandId && !this.getCommand(commandId)) {
      this.putCommand(commandId, { operation, resultId });
    }
  }

  #required(collection, id, kind) {
    const value = this.getRecord(collection, id);
    if (!value) throw new Error(`${kind} not found: ${id}`);
    return value;
  }

  #event(type, aggregateId, payload, { commandId = null, aggregateVersion = null } = {}) {
    this.appendEvent({
      type,
      aggregateType: type.split(".")[0],
      aggregateId,
      aggregateVersion,
      payload: structuredClone(payload),
      commandId,
      occurredAt: now(),
    });
  }
}
