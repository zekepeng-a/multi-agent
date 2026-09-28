import {
  AttemptStatus,
  EvidenceStatus,
  InvariantError,
  RunStatus,
  TaskStatus,
  createAttempt,
  createEvidence,
  createRun,
  createVerification,
  now,
  VerificationVerdict,
} from "./domain.mjs";

export class Controller {
  constructor({ store, runtime, idFactory = defaultIdFactory } = {}) {
    if (!store || !runtime) throw new Error("store and runtime are required");
    this.store = store;
    this.runtime = runtime;
    this.idFactory = idFactory;
  }

  async reconcileTask(taskId) {
    const task = this.store.getTask(taskId);
    const acceptance = this.store.getAcceptance(task.acceptanceId);

    if (task.status === TaskStatus.ACCEPTED || task.status === TaskStatus.CANCELLED) {
      return { action: "NOOP", reason: `task-${task.status.toLowerCase()}`, task };
    }

    if (task.status === TaskStatus.READY) {
      const runId = this.idFactory("run");
      const run = createRun({ id: runId, taskId, status: RunStatus.READY });
      this.store.createRun(run, { commandId: `reconcile:${taskId}:run:${task.version}` });
      const updatedTask = this.store.updateTask(
        taskId,
        task.version,
        { status: TaskStatus.IN_PROGRESS, currentRunId: runId },
        { commandId: `reconcile:${taskId}:task-start:${task.version}` },
      );
      return this.#executeRun(updatedTask, acceptance, run);
    }

    if (task.status === TaskStatus.IN_PROGRESS && task.currentRunId) {
      const run = this.store.getRun(task.currentRunId);
      return this.#observeRun(task, acceptance, run);
    }

    if (task.status === TaskStatus.NEEDS_REVIEW) {
      return { action: "WAIT", reason: "verification-required", task };
    }

    if (task.status === TaskStatus.BLOCKED || task.status === TaskStatus.REJECTED) {
      return { action: "WAIT", reason: `task-${task.status.toLowerCase()}`, task };
    }

    return { action: "WAIT", reason: "no-legal-controller-action", task };
  }

  async #executeRun(task, acceptance, run) {
    const attemptId = this.idFactory("attempt");
    const existingAttempts = this.store.getRunsForTask(task.id).flatMap((r) => r.attemptIds);
    const attempt = createAttempt({
      id: attemptId,
      runId: run.id,
      attemptNumber: existingAttempts.length + 1,
    });
    this.store.createAttempt(attempt);
    this.store.updateRun(run.id, run.version, {
      status: RunStatus.RUNNING,
      currentAttemptId: attemptId,
      attemptIds: [...run.attemptIds, attemptId],
    });

    const runningAttempt = this.store.updateAttempt(attemptId, { status: AttemptStatus.RUNNING });
    const result = await this.runtime.start({ run: this.store.getRun(run.id), attempt: runningAttempt });

    this.store.updateAttempt(attemptId, {
      status: result.status,
      endedAt: result.completedAt ?? now(),
      resultRef: result.resultRef ?? null,
    });

    const latestRun = this.store.getRun(run.id);
    const finalRunStatus = result.status === AttemptStatus.COMPLETED
      ? RunStatus.COMPLETED
      : result.status === AttemptStatus.LOST
        ? RunStatus.BLOCKED
        : RunStatus.FAILED;

    this.store.updateRun(run.id, latestRun.version, { status: finalRunStatus });

    if (result.status === AttemptStatus.COMPLETED) {
      const evidence = createEvidence({
        id: this.idFactory("evidence"),
        taskId: task.id,
        runId: run.id,
        attemptId,
        acceptanceId: acceptance.id,
        acceptanceVersion: acceptance.version,
        revision: result.revision,
        status: EvidenceStatus.CANDIDATE,
        contentRef: result.resultRef,
      });
      this.store.recordEvidence(evidence);

      const verification = createVerification({
        id: this.idFactory("verification"),
        acceptanceId: acceptance.id,
        acceptanceVersion: acceptance.version,
        evidenceIds: [evidence.id],
        verdict: VerificationVerdict.PASS,
        revision: result.revision,
      });
      this.store.recordVerification(verification);

      const currentTask = this.store.getTask(task.id);
      const accepted = this.store.acceptTask(task.id, currentTask.version, {
        verificationId: verification.id,
        commandId: `accept:${task.id}:${verification.id}`,
      });
      return {
        action: "ACCEPT",
        task: accepted,
        run: this.store.getRun(run.id),
        attempt: this.store.getAttempt(attemptId),
        evidence: this.store.getEvidence(evidence.id),
        verification: this.store.getVerification(verification.id),
      };
    }

    return {
      action: result.status === AttemptStatus.LOST ? "RECONCILE" : "FAILED",
      task: this.store.getTask(task.id),
      run: this.store.getRun(run.id),
      attempt: this.store.getAttempt(attemptId),
    };
  }

  #observeRun(task, acceptance, run) {
    if (run.status === RunStatus.COMPLETED) {
      const evidence = [...this.store.evidence.values?.() ?? []];
      if (!evidence.length) throw new InvariantError("completed run has no evidence");
    }
    return {
      action: "WAIT",
      reason: `run-${run.status.toLowerCase()}`,
      task,
      run,
      acceptance,
    };
  }
}

function defaultIdFactory(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
