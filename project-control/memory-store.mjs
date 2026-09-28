import {
  EvidenceStatus,
  ConflictError,
  InvariantError,
  TaskStatus,
  RunStatus,
  AttemptStatus,
  now,
} from "./domain.mjs";

export class MemoryStore {
  constructor() {
    this.projects = new Map();
    this.tasks = new Map();
    this.acceptances = new Map();
    this.runs = new Map();
    this.attempts = new Map();
    this.evidence = new Map();
    this.verifications = new Map();
    this.commands = new Map();
    this.events = [];
  }

  seedTask(task) {
    if (this.tasks.has(task.id)) throw new Error(`task already exists: ${task.id}`);
    this.tasks.set(task.id, structuredClone(task));
    this.#event("task.created", task.id, { version: task.version });
  }

  seedAcceptance(acceptance) {
    if (this.acceptances.has(acceptance.id)) throw new Error(`acceptance already exists: ${acceptance.id}`);
    this.acceptances.set(acceptance.id, structuredClone(acceptance));
    this.#event("acceptance.created", acceptance.id, { version: acceptance.version });
  }

  getTask(id) {
    return structuredClone(this.#required(this.tasks, id, "task"));
  }

  getAcceptance(id) {
    return structuredClone(this.#required(this.acceptances, id, "acceptance"));
  }

  getRun(id) {
    return structuredClone(this.#required(this.runs, id, "run"));
  }

  getRunsForTask(taskId) {
    return [...this.runs.values()]
      .filter((run) => run.taskId === taskId)
      .map((run) => structuredClone(run));
  }

  getAttempt(id) {
    return structuredClone(this.#required(this.attempts, id, "attempt"));
  }

  getEvidence(id) {
    return structuredClone(this.#required(this.evidence, id, "evidence"));
  }

  getVerification(id) {
    return structuredClone(this.#required(this.verifications, id, "verification"));
  }

  getEvents() {
    return structuredClone(this.events);
  }

  updateTask(id, expectedVersion, patch, { commandId = null } = {}) {
    return this.#mutateVersioned(
      this.tasks,
      id,
      expectedVersion,
      patch,
      "task.updated",
      "updateTask",
      commandId,
    );
  }

  createRun(run, { commandId = null } = {}) {
    const replay = this.#replayCommand(commandId, "createRun");
    if (replay) return this.getRun(replay);
    if (this.runs.has(run.id)) throw new Error(`run already exists: ${run.id}`);
    this.runs.set(run.id, structuredClone(run));
    this.#event("run.created", run.id, { taskId: run.taskId }, commandId);
    this.#rememberCommand(commandId, "createRun", run.id);
    return structuredClone(run);
  }

  updateRun(id, expectedVersion, patch, { commandId = null } = {}) {
    return this.#mutateVersioned(
      this.runs,
      id,
      expectedVersion,
      patch,
      "run.updated",
      "updateRun",
      commandId,
    );
  }

  createAttempt(attempt, { commandId = null } = {}) {
    const replay = this.#replayCommand(commandId, "createAttempt");
    if (replay) return this.getAttempt(replay);
    if (this.attempts.has(attempt.id)) throw new Error(`attempt already exists: ${attempt.id}`);
    this.attempts.set(attempt.id, structuredClone(attempt));
    this.#event("attempt.created", attempt.id, { runId: attempt.runId }, commandId);
    this.#rememberCommand(commandId, "createAttempt", attempt.id);
    return structuredClone(attempt);
  }

  updateAttempt(id, patch, { commandId = null } = {}) {
    const replay = this.#replayCommand(commandId, "updateAttempt");
    if (replay) return this.getAttempt(replay);
    const current = this.#required(this.attempts, id, "attempt");
    const next = { ...current, ...structuredClone(patch) };
    if (next.status === AttemptStatus.RUNNING && !next.startedAt) next.startedAt = now();
    if ([AttemptStatus.COMPLETED, AttemptStatus.FAILED, AttemptStatus.LOST, AttemptStatus.CANCELLED].includes(next.status)) {
      next.endedAt ??= now();
    }
    this.attempts.set(id, next);
    this.#event("attempt.updated", id, { status: next.status }, commandId);
    this.#rememberCommand(commandId, "updateAttempt", id);
    return structuredClone(next);
  }

  recordEvidence(evidence, { commandId = null } = {}) {
    const replay = this.#replayCommand(commandId, "recordEvidence");
    if (replay) return this.getEvidence(replay);
    if (this.evidence.has(evidence.id)) throw new Error(`evidence already exists: ${evidence.id}`);
    this.evidence.set(evidence.id, structuredClone(evidence));
    this.#event("evidence.recorded", evidence.id, {
      taskId: evidence.taskId,
      acceptanceId: evidence.acceptanceId,
      acceptanceVersion: evidence.acceptanceVersion,
      revision: evidence.revision,
    }, commandId);
    this.#rememberCommand(commandId, "recordEvidence", evidence.id);
    return structuredClone(evidence);
  }

  recordVerification(verification, { commandId = null } = {}) {
    const replay = this.#replayCommand(commandId, "recordVerification");
    if (replay) return this.getVerification(replay);
    if (this.verifications.has(verification.id)) throw new Error(`verification already exists: ${verification.id}`);
    const acceptance = this.#required(this.acceptances, verification.acceptanceId, "acceptance");
    if (acceptance.version !== verification.acceptanceVersion) {
      throw new InvariantError("verification targets a different acceptance contract version");
    }
    for (const evidenceId of verification.evidenceIds) {
      const evidence = this.#required(this.evidence, evidenceId, "evidence");
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
      task: this.#required(this.tasks, verification.taskId, "task"),
      verification,
    });
    this.verifications.set(verification.id, structuredClone(verification));
    this.#event("verification.recorded", verification.id, {
      acceptanceId: verification.acceptanceId,
      verdict: verification.verdict,
    }, commandId);
    this.#rememberCommand(commandId, "recordVerification", verification.id);
    return structuredClone(verification);
  }

  acceptTask(taskId, expectedVersion, { verificationId, commandId = null } = {}) {
    const replay = this.#replayCommand(commandId, "acceptTask");
    if (replay) return this.getTask(replay);
    const task = this.#required(this.tasks, taskId, "task");
    if (task.version !== expectedVersion) {
      throw new ConflictError(`task ${taskId} expected v${expectedVersion}, current v${task.version}`);
    }
    const verification = this.#required(this.verifications, verificationId, "verification");
    const acceptance = this.#required(this.acceptances, task.acceptanceId, "acceptance");
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
    this.tasks.set(taskId, next);
    this.acceptances.set(acceptance.id, { ...acceptance, status: "PASSED", updatedAt: now() });
    this.#event("task.accepted", taskId, { verificationId, version: next.version }, commandId);
    this.#rememberCommand(commandId, "acceptTask", taskId);
    return structuredClone(next);
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
    const acceptance = this.#required(this.acceptances, task.acceptanceId, "acceptance");
    if (verification.acceptanceId !== acceptance.id || verification.acceptanceVersion !== acceptance.version) {
      throw new InvariantError(`verification ${verification.id} does not match the acceptance contract of ${task.id}`);
    }
    if (!verification.evidenceIds?.length) {
      throw new InvariantError(`verification ${verification.id} references no evidence`);
    }

    const chain = [];
    for (const evidenceId of verification.evidenceIds) {
      const evidence = this.#required(this.evidence, evidenceId, "evidence");
      if (evidence.taskId !== task.id) {
        throw new InvariantError(`evidence ${evidenceId} does not belong to task ${task.id}`);
      }
      const run = this.#required(this.runs, evidence.runId, "run");
      const attempt = this.#required(this.attempts, evidence.attemptId, "attempt");
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

  #mutateVersioned(map, id, expectedVersion, patch, eventType, operation, commandId) {
    const replay = this.#replayCommand(commandId, operation);
    if (replay) return structuredClone(this.#required(map, replay, "aggregate"));
    const current = this.#required(map, id, "aggregate");
    if (current.version !== expectedVersion) {
      throw new ConflictError(`${id} expected v${expectedVersion}, current v${current.version}`);
    }
    const next = {
      ...current,
      ...structuredClone(patch),
      version: current.version + 1,
      updatedAt: now(),
    };
    map.set(id, next);
    this.#event(eventType, id, { version: next.version, patch: structuredClone(patch) }, commandId);
    this.#rememberCommand(commandId, operation, id);
    return structuredClone(next);
  }

  #replayCommand(commandId, operation) {
    if (!commandId) return null;
    const existing = this.commands.get(commandId);
    if (!existing) return null;
    if (existing.operation !== operation) {
      throw new InvariantError(`command ${commandId} was already used for another operation`);
    }
    return existing.resultId;
  }

  #rememberCommand(commandId, operation, resultId) {
    if (commandId && !this.commands.has(commandId)) {
      this.commands.set(commandId, { operation, resultId });
    }
  }

  #required(map, id, kind) {
    const value = map.get(id);
    if (!value) throw new Error(`${kind} not found: ${id}`);
    return value;
  }

  #event(type, aggregateId, payload, commandId = null) {
    this.events.push({
      id: `evt-${this.events.length + 1}`,
      type,
      aggregateId,
      payload: structuredClone(payload),
      commandId,
      occurredAt: now(),
    });
  }
}
