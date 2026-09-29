import {
  AttemptStatus,
  EvidenceStatus,
  ReconcileOutcome,
  RunStatus,
  TaskStatus,
  createAttempt,
  createEvidence,
  createRun,
  now,
} from "./domain.mjs";

export class Controller {
  constructor({ store, runtime, verifier, idFactory = defaultIdFactory } = {}) {
    if (!store || !runtime || !verifier) throw new Error("store, runtime and verifier are required");
    this.store = store;
    this.runtime = runtime;
    this.verifier = verifier;
    this.idFactory = idFactory;
  }

  async reconcileTask(taskId) {
    const task = this.store.getTask(taskId);
    // The contract revision is resolved from the TASK, never from the acceptance
    // object's current version: a task stays bound to the revision it was created
    // with even after the contract is revised.
    const acceptance = this.store.getAcceptance(task.acceptanceId, task.acceptanceVersion);

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
      // A BLOCKED Run is the only state that requires reconciliation; every
      // other Run is still observed passively.
      if (run.status === RunStatus.BLOCKED) {
        return this.#reconcileBlockedRun(task, acceptance, run);
      }
      return this.#observeRun(task, acceptance, run);
    }

    if (task.status === TaskStatus.NEEDS_REVIEW) {
      return this.#reverifyRecordedEvidence(task, acceptance);
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
    const result = await this.runtime.start({
      run: this.store.getRun(run.id),
      attempt: runningAttempt,
    });

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

    if (result.status !== AttemptStatus.COMPLETED) {
      return {
        action: result.status === AttemptStatus.LOST ? "RECONCILE" : "FAILED",
        task: this.store.getTask(task.id),
        run: this.store.getRun(run.id),
        attempt: this.store.getAttempt(attemptId),
      };
    }

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

    return this.#assessEvidence({ task, acceptance, runId: run.id, attemptId, evidence });
  }

  /**
   * Recovery, not Retry.
   *
   * A LOST Attempt means control was lost while an external operation was in
   * flight, so the first question is never "may I run it again?" but "what
   * actually happened?". The runtime is asked to observe; only a confirming
   * observation may legitimize a later transition, and `unknown` produces no
   * side effect at all. The blocked Run and its Attempt are never deleted or
   * rewritten — recovery is added as new history beside the old one.
   */
  async #reconcileBlockedRun(task, acceptance, run) {
    const attempt = run.currentAttemptId ? this.store.getAttempt(run.currentAttemptId) : null;

    // Only a Run blocked by a LOST Attempt has an external operation to
    // reconcile; anything else stays a passive observation.
    if (!attempt || attempt.status !== AttemptStatus.LOST) {
      return { action: "WAIT", reason: `run-${run.status.toLowerCase()}`, task, run, acceptance };
    }

    // Observation first: nothing below may move state before this returns.
    const observation = await this.runtime.reconcile({ task, acceptance, run, attempt });
    const outcome = observation?.outcome ?? ReconcileOutcome.UNKNOWN;

    // External work already happened: its result becomes Evidence for the Run
    // and Attempt that really produced it, then it enters the very same
    // Evidence → Verification → Acceptance path as a live result. Never re-execute.
    if (outcome === ReconcileOutcome.CONFIRMED_COMPLETED) {
      const evidence = createEvidence({
        id: this.idFactory("evidence"),
        taskId: task.id,
        runId: run.id,
        attemptId: attempt.id,
        acceptanceId: acceptance.id,
        acceptanceVersion: acceptance.version,
        revision: observation.revision ?? null,
        status: EvidenceStatus.CANDIDATE,
        contentRef: observation.resultRef ?? null,
      });
      this.store.recordEvidence(evidence);

      return {
        ...this.#assessEvidence({ task, acceptance, runId: run.id, attemptId: attempt.id, evidence }),
        reconciliation: { outcome, runId: run.id, attemptId: attempt.id },
      };
    }

    // External work provably did not happen: only now may recovery execute, and
    // it does so on a NEW Run so the blocked one survives as history.
    if (outcome === ReconcileOutcome.CONFIRMED_NO_EFFECT) {
      const recoveryRun = createRun({ id: this.idFactory("run"), taskId: task.id, status: RunStatus.READY });
      this.store.createRun(recoveryRun, { commandId: `reconcile:${task.id}:recovery-run:${run.id}` });
      const updatedTask = this.store.updateTask(
        task.id,
        task.version,
        { status: TaskStatus.IN_PROGRESS, currentRunId: recoveryRun.id },
        { commandId: `reconcile:${task.id}:recovery-start:${run.id}` },
      );

      return {
        ...await this.#executeRun(updatedTask, acceptance, recoveryRun),
        reconciliation: { outcome, runId: run.id, attemptId: attempt.id },
        recoveredFrom: { runId: run.id, attemptId: attempt.id },
      };
    }

    // Unknown (or an outcome this Controller does not recognize): stay blocked,
    // ask for reconciliation again on the next call, and re-execute nothing.
    return {
      action: "RECONCILE",
      reason: "reconciliation-unknown",
      task,
      run,
      attempt,
      acceptance,
      reconciliation: { outcome: ReconcileOutcome.UNKNOWN, runId: run.id, attemptId: attempt.id },
    };
  }

  /**
   * Produces and records ONE Verification for an existing Evidence record.
   *
   * It never executes anything and never touches Task state. Recording it runs
   * the store's full lineage / acceptance-revision / revision checks, which is
   * what makes an illegal verification fail closed instead of being applied.
   */
  #verifyEvidence({ task, acceptance, evidence, run }) {
    const verification = this.verifier.verify({ acceptance, evidence, task, run });
    this.store.recordVerification(verification);
    return verification;
  }

  /**
   * The single place where a Verification's verdict is applied to Task and
   * Acceptance state. The live execution path and the NEEDS_REVIEW recovery path
   * both come through here, so there is exactly one acceptance rule, never two.
   */
  #applyVerification({ task, acceptance, runId, attemptId, evidence, verification }) {
    if (verification.verdict !== "PASS") {
      const currentTask = this.store.getTask(task.id);
      // Re-verifying evidence that is already under review adds a verification
      // fact; it must not fabricate a state change. Only a real transition —
      // entering NEEDS_REVIEW, or pointing at different evidence — is written.
      if (currentTask.status !== TaskStatus.NEEDS_REVIEW || currentTask.latestEvidenceId !== evidence.id) {
        this.store.updateTask(
          task.id,
          currentTask.version,
          { status: TaskStatus.NEEDS_REVIEW, latestEvidenceId: evidence.id },
          { commandId: `verification-failed:${task.id}:${verification.id}` },
        );
      }
      return {
        action: "REVIEW",
        task: this.store.getTask(task.id),
        run: this.store.getRun(runId),
        attempt: this.store.getAttempt(attemptId),
        evidence: this.store.getEvidence(evidence.id),
        verification,
      };
    }

    const currentTask = this.store.getTask(task.id);
    const accepted = this.store.acceptTask(task.id, currentTask.version, {
      verificationId: verification.id,
      commandId: `accept:${task.id}:${verification.id}`,
    });

    return {
      action: "ACCEPT",
      task: accepted,
      run: this.store.getRun(runId),
      attempt: this.store.getAttempt(attemptId),
      evidence: this.store.getEvidence(evidence.id),
      verification: this.store.getVerification(verification.id),
    };
  }

  /** The live path: verify fresh Evidence, then apply the verdict. */
  #assessEvidence({ task, acceptance, runId, attemptId, evidence }) {
    const verification = this.#verifyEvidence({
      task,
      acceptance,
      evidence,
      run: this.store.getRun(runId),
    });
    return this.#applyVerification({ task, acceptance, runId, attemptId, evidence, verification });
  }

  /**
   * Recovery path for a task whose verification did not pass.
   *
   * It re-verifies the Evidence that is already on record — the same Evidence,
   * the same Run and the same Attempt. It never starts a runtime and never
   * creates a Run, an Attempt or Evidence. The new Verification passes the same
   * store checks as any other, and its verdict is applied by the same
   * #applyVerification, so a task can only leave NEEDS_REVIEW through a genuine
   * PASS. Anything that cannot be proven fails closed: it waits, and nothing
   * executes.
   */
  #reverifyRecordedEvidence(task, acceptance) {
    if (!task.latestEvidenceId) {
      return { action: "WAIT", reason: "needs-review-without-evidence", task };
    }

    let evidence;
    try {
      evidence = this.store.getEvidence(task.latestEvidenceId);
    } catch {
      return { action: "WAIT", reason: "needs-review-evidence-missing", task };
    }

    let run;
    try {
      run = this.store.getRun(evidence.runId);
      this.store.getAttempt(evidence.attemptId);
    } catch {
      return { action: "WAIT", reason: "needs-review-evidence-lineage-broken", task };
    }

    const verification = this.#verifyEvidence({ task, acceptance, evidence, run });
    return this.#applyVerification({
      task,
      acceptance,
      runId: evidence.runId,
      attemptId: evidence.attemptId,
      evidence,
      verification,
    });
  }

  #observeRun(task, acceptance, run) {
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
