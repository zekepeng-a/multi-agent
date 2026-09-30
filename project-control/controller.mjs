import {
  AttemptStatus,
  EffectObservation,
  EffectStatus,
  EvidenceStatus,
  GoalStatus,
  InvariantError,
  MilestoneStatus,
  ProjectStatus,
  ReconcileOutcome,
  RunStatus,
  TaskStatus,
  VerificationVerdict,
  createAttempt,
  createEvidence,
  createRun,
  now,
} from "./domain.mjs";
import { Collection } from "./store.mjs";
import { RuntimeOutcome } from "./runtime-adapter.mjs";
import { ProjectMemoryControl } from "./project-memory.mjs";
import { ContextCapsuleControl } from "./context-capsule.mjs";

export class Controller {
  constructor({
    store,
    runtime,
    verifier,
    effectDriver = null,
    policyEngine = null,
    runtimeContextFactory = null,
    memoryBoundary = null,
    capsuleBoundary = null,
    runtimeLaunchConfigFactory = null,
    idFactory = defaultIdFactory,
  } = {}) {
    if (!store || !runtime || !verifier) throw new Error("store, runtime and verifier are required");
    this.store = store;
    this.runtime = runtime;
    this.verifier = verifier;
    this.effectDriver = effectDriver;
    this.policyEngine = policyEngine;
    this.runtimeContextFactory = runtimeContextFactory;
    this.idFactory = idFactory;
    this.capsules = capsuleBoundary == null ? null : new ContextCapsuleControl({ ...capsuleBoundary, store, runtime });
    this.runtimeLaunchConfigFactory = runtimeLaunchConfigFactory;
    // Trusted composition input, never copied from Runtime output. G7.3 adds
    // no role/identity service and does not inject Memory into runtime context.
    this.memory = memoryBoundary == null ? null : new ProjectMemoryControl({ ...memoryBoundary, store });
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
      if (this.capsules && run.currentAttemptId) {
        const delivery = this.store.getAttempt(run.currentAttemptId).capsuleDelivery;
        if (["DISPATCHING", "UNKNOWN"].includes(delivery?.status) && !this.capsules.inFlight.has(run.currentAttemptId)) {
          this.capsules.recoverInterruptedDispatch(run.currentAttemptId, { commandId: `capsule-recover:${run.currentAttemptId}:${delivery.version}` });
          return this.#reconcileBlockedRun(task, acceptance, this.store.getRun(run.id));
        }
      }
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

    let runningAttempt = this.store.updateAttempt(attemptId, { status: AttemptStatus.RUNNING });
    let started;
    if (this.capsules) {
      try {
        const capsule = this.capsules.generate({ id: this.idFactory("capsule"), projectId: task.projectId, taskId: task.id, runId: run.id, attemptId },
          { commandId: `capsule-generate:${attemptId}` });
        const launchConfig = this.runtimeLaunchConfigFactory ? await this.runtimeLaunchConfigFactory({ task, run: this.store.getRun(run.id), attempt: runningAttempt }) : {};
        const dispatched = await this.capsules.dispatch({ capsuleId: capsule.id, attemptId,
          expectedDeliveryVersion: this.store.getAttempt(attemptId).capsuleDelivery.version, launchConfig }, { commandId: `capsule-dispatch:${attemptId}` });
        if (!dispatched.started) return { action: "WAIT", reason: `capsule-${dispatched.delivery.status.toLowerCase()}`, task: this.store.getTask(task.id) };
        started = dispatched.started;
      } catch (error) {
        // No external retry. Errors after reservation are uncertain input delivery.
        const delivery = this.store.getAttempt(attemptId).capsuleDelivery;
        if (delivery && ["DISPATCHING", "UNKNOWN"].includes(delivery.status)) {
          this.capsules.recoverInterruptedDispatch(attemptId, { commandId: `capsule-recover:${attemptId}:${delivery.version}` });
          return { action: "WAIT", reason: "capsule-unknown", error: error.message, task: this.store.getTask(task.id) };
        }
        this.store.updateAttempt(attemptId, { status: AttemptStatus.FAILED });
        const latest = this.store.getRun(run.id); this.store.updateRun(run.id, latest.version, { status: RunStatus.FAILED });
        return { action: "WAIT", reason: "capsule-preparation-refused", error: error.message, task: this.store.getTask(task.id) };
      }
    } else {
      const contextCapsule = typeof this.runtimeContextFactory === "function"
        ? await this.runtimeContextFactory({
            task: structuredClone(task),
            acceptance: structuredClone(acceptance),
            run: this.store.getRun(run.id),
            attempt: structuredClone(runningAttempt),
          })
        : {};

      started = await this.runtime.start({
        run: this.store.getRun(run.id),
        attempt: runningAttempt,
        contextCapsule: contextCapsule ?? {},
      });
    }

    // G5 normalized RuntimeAdapter path. Runtime identity is persisted on the
    // Attempt, never substituted for RunId/AttemptId.
    let result;
    if (started?.runtimeRef && typeof this.runtime.collectResult === "function") {
      runningAttempt = this.store.updateAttempt(attemptId, {
        runtimeRef: structuredClone(started.runtimeRef),
      });
      result = await this.runtime.collectResult(started.runtimeRef);
    } else {
      // Compatibility for an older injected runtime while callers migrate to
      // ADR-0004. New adapters must use RuntimeRef + collectResult().
      result = {
        outcome: started?.status === AttemptStatus.COMPLETED
          ? RuntimeOutcome.COMPLETED
          : started?.status === AttemptStatus.LOST
            ? RuntimeOutcome.LOST
            : started?.status === AttemptStatus.CANCELLED
              ? RuntimeOutcome.CANCELLED
              : RuntimeOutcome.FAILED,
        resultRef: started?.resultRef ?? null,
        revision: started?.revision ?? null,
        completedAt: started?.completedAt ?? null,
        runtimeRef: null,
      };
    }

    const finalAttemptStatus = result.outcome === RuntimeOutcome.COMPLETED
      ? AttemptStatus.COMPLETED
      : result.outcome === RuntimeOutcome.LOST
        ? AttemptStatus.LOST
        : result.outcome === RuntimeOutcome.CANCELLED
          ? AttemptStatus.CANCELLED
          : AttemptStatus.FAILED;

    this.store.updateAttempt(attemptId, {
      status: finalAttemptStatus,
      endedAt: result.completedAt ?? now(),
      resultRef: result.resultRef ?? null,
      ...(result.runtimeRef ? { runtimeRef: structuredClone(result.runtimeRef) } : {}),
    });

    const latestRun = this.store.getRun(run.id);
    const finalRunStatus = finalAttemptStatus === AttemptStatus.COMPLETED
      ? RunStatus.COMPLETED
      : finalAttemptStatus === AttemptStatus.LOST
        ? RunStatus.BLOCKED
        : finalAttemptStatus === AttemptStatus.CANCELLED
          ? RunStatus.CANCELLED
          : RunStatus.FAILED;

    this.store.updateRun(run.id, latestRun.version, { status: finalRunStatus });

    if (finalAttemptStatus !== AttemptStatus.COMPLETED) {
      return {
        action: finalAttemptStatus === AttemptStatus.LOST
          ? "RECONCILE"
          : finalAttemptStatus === AttemptStatus.CANCELLED
            ? "CANCELLED"
            : "FAILED",
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
    // Reconciliation is capability-gated in G5. A runtime that cannot observe
    // the lost execution leaves the controller safely blocked.
    let observation = { outcome: ReconcileOutcome.UNKNOWN };
    const runtimeCaps = typeof this.runtime.capabilities === "function"
      ? this.runtime.capabilities()
      : null;
    if (runtimeCaps?.reconcile === true && typeof this.runtime.reconcile === "function") {
      observation = await this.runtime.reconcile(
        attempt.runtimeRef,
        { task, acceptance, run, attempt },
      );
    } else if (!runtimeCaps && typeof this.runtime.reconcile === "function") {
      // Legacy compatibility path.
      observation = await this.runtime.reconcile({ task, acceptance, run, attempt });
    }
    const outcome = observation?.outcome ?? ReconcileOutcome.UNKNOWN;
    if (this.capsules && attempt.capsuleDelivery?.status === "UNKNOWN") {
      if (observation?.capsuleReceipt) this.capsules.reconcileDelivery(attempt.id, { receipt: observation.capsuleReceipt, runtimeRef: observation.runtimeRef },
        { commandId: `capsule-receipt-reconcile:${attempt.id}:${attempt.capsuleDelivery.version}`, expectedDeliveryVersion: attempt.capsuleDelivery.version });
      else if (outcome === ReconcileOutcome.CONFIRMED_NO_EFFECT) this.capsules.reconcileDelivery(attempt.id,
        { noExecution: true, observationRef: observation.observationRef ?? `runtime-reconcile:${attempt.id}`, reason: "Adapter confirmed no effect" },
        { commandId: `capsule-nonreceipt-reconcile:${attempt.id}:${attempt.capsuleDelivery.version}`, expectedDeliveryVersion: attempt.capsuleDelivery.version });
    }

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

  // ── Lifecycle reconciliation: Project → Milestone → Goal → Task ───────────
  //
  // These three methods only OBSERVE children and synchronise the parent's
  // Project Control state. They never call runtime.start(), never create a Run or
  // an Attempt, and never call reconcileTask — "parent lifecycle sync" and "task
  // execution scheduling" stay two separate layers. A parent can therefore only
  // ever move because state below it already exists.
  //
  // The ONE record a parent may create is the Aggregate Evidence of its own
  // children (see #acceptParent): an observation the Control Plane makes about
  // records it already owns, not a Runtime product, and not a reason to start
  // anything.
  //
  // RELATIONSHIP AUTHORITY: membership always comes from the child's explicit
  // parent link (`Task.goalId`, `Goal.milestoneId`, `Milestone.projectId`).
  // `Goal.taskIds` and `Milestone.goalIds` are derived/cached views and are never
  // consulted here; `Milestone.roadmapId` has no lifecycle and takes no part.
  //
  // BLOCKED: the Controller may ENTER BLOCKED by observing a blocked child, but it
  // never leaves BLOCKED on its own. BLOCKED is not "a child looks bad right now";
  // it is a control state the aggregate has entered and that an authority (or the
  // future explicit unblock command) has to clear. Clearing it by aggregation
  // would let a child's later recovery silently overturn a recorded decision.
  //
  // Actions: SYNC (a transition was written), NOOP (already in the target state,
  // or a terminal state that must not be reversed), ACCEPT (an acceptance
  // decision was written) and WAIT (no rule settles the case, with a reason).

  /**
   * Applies one lifecycle transition through the store — never by writing the
   * record directly. When the aggregate already holds the target status nothing
   * is written at all: no version churn and no redundant domain event.
   */
  #syncStatus(collection, record, targetStatus) {
    if (record.status === targetStatus) {
      return { action: "NOOP", record };
    }
    // Deterministic command identity for the transition, so a retried reconcile
    // replays instead of applying a second time.
    const commandId = `lifecycle:${collection}:${record.id}:${record.version}:${targetStatus}`;
    const patch = { status: targetStatus };
    const updated = collection === Collection.PROJECT
      ? this.store.updateProject(record.id, record.version, patch, { commandId })
      : collection === Collection.MILESTONE
        ? this.store.updateMilestone(record.id, record.version, patch, { commandId })
        : this.store.updateGoal(record.id, record.version, patch, { commandId });
    return { action: "SYNC", record: updated };
  }

  /**
   * Parent acceptance: the ONLY way a Goal or a Milestone that declares an
   * Acceptance Contract may be accepted.
   *
   * Without a contract, an aggregate whose children have all finished is a
   * derived summary, and the Controller may write it directly (the `#syncStatus`
   * path). With a contract, the same observation is not a decision: something has
   * to be VERIFIED against the contract revision the parent pinned, and the
   * verification has to be about evidence of this parent's actual children.
   *
   * The flow mirrors the task-level flow exactly, one level up:
   *
   *   contract revision → Aggregate Evidence → Verification → Acceptance
   *
   * 1. the pinned revision is resolved (a bare acceptanceId is not a revision);
   * 2. Aggregate Evidence is created or reused from the live child records — the
   *    Control Plane's own observation, since no runtime produces a Goal;
   * 3. one verdict is recorded per observation: an existing PASS for the same
   *    evidence and contract revision is reused rather than re-asked, so a
   *    repeated reconcile does not accumulate duplicate verification facts;
   * 4. only a PASS reaches the store's acceptance write, which re-proves the
   *    whole chain — target, contract revision, evidence currency — before the
   *    status change.
   *
   * Anything that cannot be proven is reported as WAIT with a reason. Nothing is
   * inferred, no status is invented, and no Runtime call is made: this is a
   * decision about records that already exist.
   */
  #acceptParent({ collection, target, context }) {
    const noun = collection === Collection.GOAL
      ? "goal"
      : collection === Collection.MILESTONE
        ? "milestone"
        : "project";
    const observed = { ...context, [noun]: target };

    let acceptance;
    let evidence;
    try {
      acceptance = this.store.getAcceptance(target.acceptanceId, target.acceptanceVersion);
      // NO command id here on purpose. This operation is idempotent by the
      // observation's OWN identity (same child state → same Evidence), whereas a
      // command id is durable and its replay returns the evidence it recorded —
      // so a per-target command id would freeze the first observation forever and
      // make a re-observation after a child change impossible.
      evidence = this.store.ensureAggregateEvidence(collection, target.id);
    } catch (error) {
      // An unpinned revision, a contract that is not about this parent, or a
      // child set that is not actually finished: the case is unprovable, and an
      // unprovable acceptance waits instead of being approximated.
      if (!(error instanceof InvariantError)) throw error;
      return { action: "WAIT", reason: `${noun}-acceptance-unprovable`, ...observed };
    }

    const verification = this.#aggregateVerdict({ target, acceptance, evidence });
    if (verification.verdict !== VerificationVerdict.PASS) {
      return {
        action: "WAIT",
        reason: `${noun}-acceptance-not-passed`,
        ...observed,
        evidence,
        verification,
      };
    }

    const current = collection === Collection.GOAL
      ? this.store.getGoal(target.id)
      : collection === Collection.MILESTONE
        ? this.store.getMilestone(target.id)
        : this.store.getProject(target.id);
    // The write re-proves everything inside one transaction; passing the version
    // read here makes a concurrent change a conflict rather than an overwrite.
    const options = {
      verificationId: verification.id,
      commandId: `accept:${collection}:${current.id}:${verification.id}`,
    };
    const accepted = collection === Collection.GOAL
      ? this.store.acceptGoal(current.id, current.version, options)
      : collection === Collection.MILESTONE
        ? this.store.completeMilestone(current.id, current.version, options)
        : this.store.acceptProject(current.id, current.version, options);

    return {
      action: "ACCEPT",
      reason: collection === Collection.GOAL
        ? "goal-accepted"
        : collection === Collection.MILESTONE
          ? "milestone-completed"
          : "project-completed",
      ...context,
      [noun]: accepted,
      evidence,
      verification,
    };
  }

  /**
   * One observation, one verdict.
   *
   * A verdict is a fact about a specific observation of a specific contract
   * revision, so re-asking the verifier for evidence that has not changed would
   * add a second verification of the same thing without adding information.
   * Reuse is also what makes `reconcile*` idempotent. A recorded FAIL or
   * INCONCLUSIVE is reused too: the observation is the same, so the verdict is
   * the same, and repeating the call must not manufacture a different one. A new
   * observation (the child state moved) is new evidence with a new id, and gets
   * its own verification.
   *
   * The store re-proves a reused verification against current state at acceptance
   * time, so reuse can never launder a stale verdict into an acceptance.
   */
  #aggregateVerdict({ target, acceptance, evidence }) {
    const recorded = this.store
      .getVerificationsForTarget(target.id)
      .filter(
        (verification) =>
          verification.acceptanceId === acceptance.id &&
          verification.acceptanceVersion === acceptance.version &&
          verification.evidenceIds?.includes(evidence.id),
      );
    const passed = recorded.find((verification) => verification.verdict === VerificationVerdict.PASS);
    if (passed) return passed;
    if (recorded.length) return recorded[recorded.length - 1];

    const verification = this.verifier.verify({ acceptance, evidence, target });
    this.store.recordVerification(verification);
    return verification;
  }

  // ── Durable Command authorization (G2) ─────────────────────────────────────
  //
  // A Command is created first as durable immutable intent. Authorization then
  // operates only on that stored record. The Controller never accepts a second
  // caller-presented action/capability/scope at authorization time.

  createCommand(request, { mutationId = null } = {}) {
    return this.store.createControlCommand(request, { mutationId });
  }

  authorizeCommand(
    commandId,
    expectedCommandVersion,
    { approvalId = null, policyContext = {}, mutationId = null } = {},
  ) {
    if (typeof commandId !== "string" || commandId.trim() === "") {
      throw new InvariantError("command authorization requires a durable command id");
    }
    if (!Number.isInteger(expectedCommandVersion) || expectedCommandVersion < 1) {
      throw new InvariantError("command authorization requires a positive expected command version");
    }

    const command = this.store.getControlCommand(commandId);
    const target = this.store.getControlCommandTarget(commandId);

    // Missing target is a pre-policy control failure. The store owns the
    // rejection transition and checks it before requiring a PolicyDecision.
    if (!target) {
      return this.store.authorizeControlCommand(
        commandId,
        expectedCommandVersion,
        { policyDecisionId: null, approvalId },
        { mutationId: mutationId ? `${mutationId}:authorize` : null },
      );
    }

    this.#requirePolicyEngine();
    const evaluation = this.policyEngine.evaluate({
      command,
      target,
      context: policyContext,
    });
    const decision = this.store.recordPolicyDecision(
      commandId,
      expectedCommandVersion,
      {
        id: this.idFactory("policy"),
        effect: evaluation.effect,
        policyVersion: evaluation.policyVersion,
        reasons: evaluation.reasons ?? [],
        matchedRuleIds: evaluation.matchedRuleIds ?? [],
        context: policyContext,
        request: evaluation.request,
      },
      { mutationId: mutationId ? `${mutationId}:policy` : null },
    );

    return this.store.authorizeControlCommand(
      commandId,
      expectedCommandVersion,
      { policyDecisionId: decision.id, approvalId },
      { mutationId: mutationId ? `${mutationId}:authorize` : null },
    );
  }

  #requirePolicyEngine() {
    if (!this.policyEngine || typeof this.policyEngine.evaluate !== "function") {
      throw new InvariantError("G4 command authorization requires a policy engine");
    }
  }


  // ── External Effect boundary (G3) ───────────────────────────────────────────
  //
  // The Effect is durable before this Controller crosses the driver boundary.
  // A local throw after DISPATCHED becomes UNKNOWN, never "failed/no effect".

  async dispatchEffect(
    { id, commandId, destination, idempotencyKey = null, projectId = null } = {},
    { mutationId = null } = {},
  ) {
    this.#requireEffectDriver();
    const effect = this.store.createEffectFromCommand(
      { id, commandId, destination, idempotencyKey, projectId },
      { mutationId: mutationId ? `${mutationId}:request` : null },
    );
    // A replay of the whole controller operation may return the already-final
    // Effect from the request mutation. Never cross the external boundary again.
    if (effect.status !== EffectStatus.REQUESTED) return effect;
    return this.#dispatchRequestedEffect(effect, mutationId);
  }

  async retryEffect(effectId, expectedVersion, { mutationId = null } = {}) {
    this.#requireEffectDriver();
    const requested = this.store.rerequestEffect(effectId, expectedVersion, {
      mutationId: mutationId ? `${mutationId}:rerequest` : null,
    });
    if (requested.status !== EffectStatus.REQUESTED) return requested;
    return this.#dispatchRequestedEffect(requested, mutationId);
  }

  async reconcileEffect(effectId, expectedVersion, { mutationId = null } = {}) {
    this.#requireEffectDriver();
    const current = this.store.getEffect(effectId);
    if (![EffectStatus.DISPATCHED, EffectStatus.UNKNOWN].includes(current.status)) {
      throw new InvariantError(
        `effect ${effectId} is ${current.status}; only DISPATCHED/UNKNOWN effects require reconciliation`,
      );
    }

    const reconciling = this.store.beginEffectReconciliation(effectId, expectedVersion, {
      mutationId: mutationId ? `${mutationId}:begin` : null,
    });
    if ([EffectStatus.SUCCEEDED, EffectStatus.FAILED_NO_EFFECT].includes(reconciling.status)) {
      return reconciling;
    }

    let observation;
    try {
      observation = await this.effectDriver.reconcile(reconciling);
    } catch {
      observation = { outcome: EffectObservation.UNKNOWN };
    }

    return this.store.applyEffectReconciliation(
      effectId,
      reconciling.version,
      {
        outcome: observation?.outcome ?? EffectObservation.UNKNOWN,
        observationRef: observation?.observationRef ?? null,
        receipt: observation?.receipt ?? null,
      },
      { mutationId: mutationId ? `${mutationId}:observe` : null },
    );
  }

  async #dispatchRequestedEffect(effect, mutationId) {
    const dispatched = this.store.markEffectDispatched(effect.id, effect.version, {
      mutationId: mutationId ? `${mutationId}:dispatch` : null,
    });

    let observation;
    try {
      observation = await this.effectDriver.dispatch(dispatched);
    } catch {
      observation = { outcome: EffectObservation.UNKNOWN };
    }

    return this.store.recordEffectOutcome(
      dispatched.id,
      dispatched.version,
      {
        outcome: observation?.outcome ?? EffectObservation.UNKNOWN,
        receipt: observation?.receipt ?? null,
        observationRef: observation?.observationRef ?? null,
      },
      { mutationId: mutationId ? `${mutationId}:outcome` : null },
    );
  }

  #requireEffectDriver() {
    if (!this.effectDriver || typeof this.effectDriver.dispatch !== "function" || typeof this.effectDriver.reconcile !== "function") {
      throw new InvariantError("G3 effect operation requires an effect driver");
    }
  }

  async reconcileGoal(goalId) {
    const goal = this.store.getGoal(goalId);

    if (
      goal.status === GoalStatus.ACCEPTED ||
      goal.status === GoalStatus.REJECTED ||
      goal.status === GoalStatus.CANCELLED
    ) {
      return { action: "NOOP", reason: `goal-${goal.status.toLowerCase()}`, goal, tasks: [] };
    }
    if (goal.status === GoalStatus.DRAFT) {
      return { action: "WAIT", reason: "goal-draft", goal, tasks: [] };
    }

    const tasks = this.store.getTasksForGoal(goalId);

    if (goal.status === GoalStatus.BLOCKED) {
      // BLOCKED is a control state awaiting resolution, not a derived child
      // summary. A recovery below it — even every task reaching ACCEPTED — must
      // not clear it, and the goal must never be walked back to READY or
      // IN_PROGRESS either. Only an explicit unblock (future round) may leave it.
      return { action: "WAIT", reason: "goal-blocked-awaiting-resolution", goal, tasks };
    }

    if (tasks.length === 0) {
      return { action: "WAIT", reason: "goal-without-tasks", goal, tasks };
    }
    const statuses = tasks.map((task) => task.status);

    if (statuses.every((status) => status === TaskStatus.ACCEPTED)) {
      if (goal.acceptanceId != null) {
        // A Goal with a contract is not accepted by aggregation: child
        // completion is the INPUT to acceptance, never the decision. The Goal
        // is accepted only through its own contract-bound flow.
        return this.#acceptParent({
          collection: Collection.GOAL,
          target: goal,
          context: { tasks },
        });
      }
      const sync = this.#syncStatus(Collection.GOAL, goal, GoalStatus.ACCEPTED);
      return { action: sync.action, reason: "goal-accepted", goal: sync.record, tasks };
    }

    if (statuses.includes(TaskStatus.BLOCKED)) {
      const sync = this.#syncStatus(Collection.GOAL, goal, GoalStatus.BLOCKED);
      return { action: sync.action, reason: "goal-blocked", goal: sync.record, tasks };
    }

    if (statuses.some((status) => status === TaskStatus.IN_PROGRESS || status === TaskStatus.NEEDS_REVIEW)) {
      const sync = this.#syncStatus(Collection.GOAL, goal, GoalStatus.IN_PROGRESS);
      return { action: sync.action, reason: "goal-in-progress", goal: sync.record, tasks };
    }

    if (statuses.every((status) => status === TaskStatus.READY)) {
      // Nothing has started. A Goal already at READY stays there; a Goal further
      // along is never walked backwards by aggregation.
      return goal.status === GoalStatus.READY
        ? { action: "NOOP", reason: "goal-ready", goal, tasks }
        : { action: "WAIT", reason: "goal-regression-not-allowed", goal, tasks };
    }

    // REJECTED / CANCELLED tasks, or any mix the rules above do not settle: a
    // terminal decision belongs to an authority, never to aggregation.
    return { action: "WAIT", reason: "goal-task-decision-required", goal, tasks };
  }

  async reconcileMilestone(milestoneId) {
    const milestone = this.store.getMilestone(milestoneId);

    if (milestone.status === MilestoneStatus.COMPLETED || milestone.status === MilestoneStatus.CANCELLED) {
      return { action: "NOOP", reason: `milestone-${milestone.status.toLowerCase()}`, milestone, goals: [] };
    }
    if (milestone.status === MilestoneStatus.DRAFT) {
      return { action: "WAIT", reason: "milestone-draft", milestone, goals: [] };
    }

    // Observe the next level first, so one call synchronises the whole chain.
    const synced = [];
    for (const goal of this.store.getGoalsForMilestone(milestoneId)) {
      synced.push(await this.reconcileGoal(goal.id));
    }
    const goals = this.store.getGoalsForMilestone(milestoneId);

    if (milestone.status === MilestoneStatus.BLOCKED) {
      // Same rule as a Goal: the milestone entered a control state that an
      // authority clears. Neither COMPLETED (all goals accepted) nor IN_PROGRESS
      // (a goal moving again) may be inferred from the children.
      return { action: "WAIT", reason: "milestone-blocked-awaiting-resolution", milestone, goals, synced };
    }

    if (goals.length === 0) {
      return { action: "WAIT", reason: "milestone-without-goals", milestone, goals, synced };
    }
    const statuses = goals.map((goal) => goal.status);

    if (statuses.every((status) => status === GoalStatus.ACCEPTED)) {
      if (milestone.acceptanceId != null) {
        // Same rule one level up: all goals accepted is the input to the
        // milestone's own contract-bound acceptance, not the decision itself.
        return this.#acceptParent({
          collection: Collection.MILESTONE,
          target: milestone,
          context: { goals, synced },
        });
      }
      const sync = this.#syncStatus(Collection.MILESTONE, milestone, MilestoneStatus.COMPLETED);
      return { action: sync.action, reason: "milestone-completed", milestone: sync.record, goals, synced };
    }

    if (statuses.includes(GoalStatus.BLOCKED)) {
      const sync = this.#syncStatus(Collection.MILESTONE, milestone, MilestoneStatus.BLOCKED);
      return { action: sync.action, reason: "milestone-blocked", milestone: sync.record, goals, synced };
    }

    if (statuses.includes(GoalStatus.IN_PROGRESS)) {
      const sync = this.#syncStatus(Collection.MILESTONE, milestone, MilestoneStatus.IN_PROGRESS);
      return { action: sync.action, reason: "milestone-in-progress", milestone: sync.record, goals, synced };
    }

    if (statuses.every((status) => status === GoalStatus.READY)) {
      return milestone.status === MilestoneStatus.READY
        ? { action: "NOOP", reason: "milestone-ready", milestone, goals, synced }
        : { action: "WAIT", reason: "milestone-regression-not-allowed", milestone, goals, synced };
    }

    // DRAFT / REJECTED / CANCELLED goals are not an aggregation decision.
    return { action: "WAIT", reason: "milestone-goal-decision-required", milestone, goals, synced };
  }

  async reconcileProject(projectId) {
    const project = this.store.getProject(projectId);

    if (project.status !== ProjectStatus.ACTIVE) {
      // PAUSED / COMPLETED / ARCHIVED are decisions taken elsewhere; this
      // Controller never resumes or re-opens a project.
      return { action: "NOOP", reason: `project-${project.status.toLowerCase()}`, project };
    }

    const synced = [];
    for (const milestone of this.store.getMilestonesForProject(projectId)) {
      synced.push(await this.reconcileMilestone(milestone.id));
    }
    const milestones = this.store.getMilestonesForProject(projectId);

    if (milestones.length === 0) {
      return { action: "WAIT", reason: "project-without-milestones", project, milestones, synced };
    }

    if (milestones.some((milestone) => milestone.status === MilestoneStatus.BLOCKED)) {
      // ProjectStatus has no BLOCKED. The project stays ACTIVE and the blocking
      // condition is reported rather than invented as a project state.
      return { action: "WAIT", reason: "project-blocked-by-milestone", project, milestones, synced };
    }

    if (milestones.every((milestone) => milestone.status === MilestoneStatus.COMPLETED)) {
      if (project.acceptanceId != null) {
        return this.#acceptParent({
          collection: Collection.PROJECT,
          target: project,
          context: { milestones, synced },
        });
      }
      const sync = this.#syncStatus(Collection.PROJECT, project, ProjectStatus.COMPLETED);
      return { action: sync.action, reason: "project-completed", project: sync.record, milestones, synced };
    }

    return { action: "NOOP", reason: "project-active", project, milestones, synced };
  }
}

function defaultIdFactory(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
