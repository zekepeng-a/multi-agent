// Project Control OS — store contract + shared control semantics.
//
// Exactly one implementation owns the control rules (validation, lineage proof,
// contract revision pinning, command idempotency, event emission). Backends
// provide storage primitives only. That is what keeps MemoryStore and SqliteStore
// from drifting apart, and it keeps SQL out of both the Controller and the rules.
//
// A backend must implement the primitives in the "Backend primitives" block
// below; everything after it is shared behaviour.

import {
  EvidenceStatus,
  ConflictError,
  InvariantError,
  ProjectStatus,
  MilestoneStatus,
  GoalStatus,
  TaskStatus,
  RunStatus,
  AttemptStatus,
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
  return JSON.stringify({
    id: acceptance.id,
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
   * Milestones of a project. Membership is read from the child's explicit
   * `projectId` link — the same convention the store already uses for
   * `Run.taskId` and `Evidence.taskId` — so it can never be inferred or guessed.
   * `Milestone.goalIds` is the canonical membership list kept on the milestone
   * itself; the two are expected to agree, and this round does not maintain one
   * from the other.
   */
  getMilestonesForProject(projectId) {
    return this.recordsMatching(Collection.MILESTONE, "projectId", projectId);
  }

  seedGoal(goal) {
    this.runInTransaction(() => {
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

  /** Goals of a milestone, read from the child's explicit `milestoneId` link. */
  getGoalsForMilestone(milestoneId) {
    return this.recordsMatching(Collection.GOAL, "milestoneId", milestoneId);
  }

  /** Goals of a project, read from the child's explicit `projectId` link. */
  getGoalsForProject(projectId) {
    return this.recordsMatching(Collection.GOAL, "projectId", projectId);
  }

  /** Tasks of a goal, read from the child's explicit `goalId` link. */
  getTasksForGoal(goalId) {
    return this.recordsMatching(Collection.TASK, "goalId", goalId);
  }

  seedTask(task) {
    this.runInTransaction(() => {
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
      // be provable back to the task it declares, through evidence that really
      // belongs to that task's Run and Attempt.
      if (!verification.taskId) {
        throw new InvariantError("verification must declare the task it belongs to");
      }
      this.#proveVerification({
        task: this.#required(Collection.TASK, verification.taskId, "task"),
        verification,
      });
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
