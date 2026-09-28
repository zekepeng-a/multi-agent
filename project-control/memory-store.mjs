import {
  ConflictError,
  InvariantError,
  TaskStatus,
  RunStatus,
  AttemptStatus,
  EvidenceStatus,
  VerificationVerdict,
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
    return [...this.runs.values()].filter((run) => run.taskId === taskId).map(structuredClone);
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
    return this.#mutateVersioned(this.tasks, id, expectedVersion, patch, "task.updated", commandId);
  }

  createRun(run, { commandId = null } = {}) {
    this.#idempotent(commandId, "createRun", run.id);
    if (this.runs.has(run.id)) throw new Error(`run already exists: ${run.id}`);
    this.runs.set(run.id, structuredClone(run));
    this.#event("run.created", run.id, { taskId: run.taskId }, commandId);
    this.#rememberCommand(commandId, run.id);
    return structuredClone(run);
  }

  updateRun(id, expectedVersion, patch, { commandId = null } = {}) {
    return this.#mutateVersioned(this.runs, id, expectedVersion, patch, "run.updated", commandId);
  }

  createAttempt(attempt, { commandId = null } = {}) {
    this.#idempotent(commandId, "createAttempt", attempt.id);
    if (this.attempts.has(attempt.id)) throw new Error(`attempt already exists: ${attempt.id}`);
    this.attempts.set(attempt.id, structuredClone(attempt));
    this.#event("attempt.created", attempt.id, { runId: attempt.runId }, commandId);
    this.#rememberCommand(commandId, attempt.id);
    return structuredClone(attempt);
  }

  updateAttempt(id, patch, { commandId = null } = {}) {
    const current = this.#required(this.attempts, id, "attempt");
    const next = { ...current, ...structuredClone(patch) };
    if (next.status === AttemptStatus.RUNNING && !next.startedAt) next.startedAt = now();
    if ([AttemptStatus.COMPLETED, AttemptStatus.FAILED, AttemptStatus.LOST, AttemptStatus.CANCELLED].includes(next.status)) {
      next.endedAt ??= now();
    }
    this.attempts.set(id, next);
    this.#event("attempt.updated", id, { status: next.status }, commandId);
    return structuredClone(next);
  }

  recordEvidence(evidence, { commandId = null } = {}) {
    this.#idempotent(commandId, "recordEvidence", evidence.id);
    if (this.evidence.has(evidence.id)) throw new Error(`evidence already exists: ${evidence.id}`);
    this.evidence.set(evidence.id, structuredClone(evidence));
    this.#event("evidence.recorded", evidence.id, {
      taskId: evidence.taskId,
      acceptanceId: evidence.acceptanceId,
      acceptanceVersion: evidence.acceptanceVersion,
      revision: evidence.revision,
    }, commandId);
    this.#rememberCommand(commandId, evidence.id);
    return structuredClone(evidence);
  }

  recordVerification(verification, { commandId = null } = {}) {
    this.#idempotent(commandId, "recordVerification", verification.id);
    if (this.verifications.has(verification.id)) throw new Error(`verification already exists: ${verification.id}`);
    const acceptance = this.#required(this.acceptances, verification.acceptanceId, "acceptance");
    if (acceptance.version !== verification.acceptanceVersion) {
      throw new InvariantError("verification targets a different acceptance contract version");
    }
    for (const evidenceId of verification.evidenceIds) {
      const evidence = this.#required(this.evidence, evidenceId, "evidence");
      if (evidence.acceptanceId !== verification.acceptanceId ||
          evidence.acceptanceVersion !== verification.acceptanceVersion) {
        throw new InvariantError("verification evidence does not match acceptance contract");
      }
    }
    this.verifications.set(verification.id, structuredClone(verification));
    this.#event("verification.recorded", verification.id, {
      acceptanceId: verification.acceptanceId,
      verdict: verification.verdict,
    }, commandId);
    this.#rememberCommand(commandId, verification.id);
    return structuredClone(verification);
  }

  acceptTask(taskId, expectedVersion, { verificationId, commandId = null } = {}) {
    this.#idempotent(commandId, "acceptTask", taskId);
    const task = this.#required(this.tasks, taskId, "task");
    if (task.version !== expectedVersion) throw new ConflictError(`task ${taskId} expected v${expectedVersion}, current v${task.version}`);
    const verification = this.#required(this.verifications, verificationId, "verification");
    const acceptance = this.#required(this.acceptances, task.acceptanceId, "acceptance");
    if (verification.acceptanceId !== acceptance.id ||
        verification.acceptanceVersion !== acceptance.version ||
        verification.verdict !== VerificationVerdict.PASS) {
      throw new InvariantError("task cannot be accepted by this verification");
    }
    const next = { ...task, status: TaskStatus.ACCEPTED, version: task.version + 1, updatedAt: now() };
    this.tasks.set(taskId, next);
    this.acceptances.set(acceptance.id, { ...acceptance, status: "PASSED", updatedAt: now() });
    this.#event("task.accepted", taskId, { verificationId, version: next.version }, commandId);
    this.#rememberCommand(commandId, taskId);
    return structuredClone(next);
  }

  #mutateVersioned(map, id, expectedVersion, patch, eventType, commandId) {
    this.#idempotent(commandId, eventType, id);
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
    this.#rememberCommand(commandId, id);
    return structuredClone(next);
  }

  #idempotent(commandId, operation, resultId) {
    if (!commandId) return;
    const existing = this.commands.get(commandId);
    if (existing) {
      if (existing.operation !== operation) {
        throw new InvariantError(`command ${commandId} was already used for another operation`);
      }
      return existing.resultId;
    }
    return null;
  }

  #rememberCommand(commandId, resultId) {
    if (commandId && !this.commands.has(commandId)) {
      this.commands.set(commandId, { operation: "mutation", resultId });
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
