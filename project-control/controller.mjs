import {
  ApprovalError,
  ApprovalTargetType,
  AttemptStatus,
  COMMAND_APPROVAL_UNAVAILABLE,
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
    const noun = collection === Collection.GOAL ? "goal" : "milestone";
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
      : this.store.getMilestone(target.id);
    // The write re-proves everything inside one transaction; passing the version
    // read here makes a concurrent change a conflict rather than an overwrite.
    const accepted = collection === Collection.GOAL
      ? this.store.acceptGoal(current.id, current.version, {
          verificationId: verification.id,
          commandId: `accept:${collection}:${current.id}:${verification.id}`,
        })
      : this.store.completeMilestone(current.id, current.version, {
          verificationId: verification.id,
          commandId: `accept:${collection}:${current.id}:${verification.id}`,
        });

    return {
      action: "ACCEPT",
      reason: collection === Collection.GOAL ? "goal-accepted" : "milestone-completed",
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

  // ── Human approval gate ───────────────────────────────────────────────────
  //
  // The gate asks ONE question: does an Approval authorize this concrete action,
  // on this concrete target, exercising this concrete capability, at its current
  // version? It is deliberately SYNCHRONOUS — it reads durable facts and starts
  // nothing, so it cannot be mistaken for, or accidentally wired into, an
  // execution path.
  //
  // What passing the gate means, and what it does not:
  //
  //   • it means the named action may proceed past the control gate;
  //   • it does NOT mean the command succeeded. v0.1 has no Command status and no
  //     Effect tracking, so authorization is reported as a decision and nothing
  //     is written about it: recording "consumed" would claim knowledge about the
  //     external world that this layer does not have (that is the Effect Ledger's
  //     job, and it is not in this round);
  //   • it does NOT accept anything. Permission and correctness are different
  //     facts, and no Task, Goal or Milestone changes status because a human said
  //     yes to an action.
  //
  // The gate also does not decide WHEN approval is required. That is a Policy
  // question, and inventing a per-Task "requires approval" flag here would be a
  // fake Policy Engine. A caller that has decided an action needs approval hands
  // in an approvalId; a caller that has none is refused, because the gate fails
  // closed.
  authorizeCommand({
    targetType,
    targetId,
    targetVersion = null,
    action,
    capability,
    scope,
    approvalId = null,
    commandId = null,
    expectedVersion = null,
  } = {}) {
    const intent = { targetType, targetId, targetVersion, action, capability, scope, commandId };
    // The request must name the capability it exercises: without it the gate
    // cannot tell which authorization is being exercised, and "no capability
    // stated" is never a wildcard.
    for (const field of ["targetType", "targetId", "action", "capability", "scope"]) {
      if (typeof intent[field] !== "string" || intent[field].trim() === "") {
        throw new InvariantError(`a command authorization must name its ${field}`);
      }
    }
    if (expectedVersion != null && targetType === ApprovalTargetType.COMMAND) {
      throw new InvariantError("a command target has no version, so no command can expect one");
    }

    // No approval to check: the answer is the same as it has always been, and it
    // is decided before anything else is asked of the request.
    if (!approvalId) {
      return { action: "WAIT", reason: "approval-required", intent };
    }

    // There is no durable Command control object in v0.1, so a COMMAND-typed
    // permission cannot be validated — let alone authorized. Fail closed, loudly,
    // the moment one is presented.
    if (targetType === ApprovalTargetType.COMMAND) {
      throw new InvariantError(COMMAND_APPROVAL_UNAVAILABLE);
    }

    let approval;
    try {
      approval = this.store.assertApprovalUsable({
        approvalId,
        targetType,
        targetId,
        targetVersion,
        action,
        capability,
        scope,
        commandId,
      });
    } catch (error) {
      // The store refuses with a machine-readable reason; the Controller turns it
      // into an actionable WAIT instead of throwing, and keeps the reason so the
      // difference between "nobody approved this" and "the target moved since it
      // was approved" survives to the caller.
      if (!(error instanceof ApprovalError)) throw error;
      return {
        action: "WAIT",
        reason: `approval-${String(error.approvalReason).toLowerCase().replaceAll("_", "-")}`,
        approvalReason: error.approvalReason,
        intent,
        approval: this.#approvalIfPresent(approvalId),
      };
    }

    // The permission is current — but a permission is not an exemption from
    // optimistic concurrency. The command still has to win its own expectedVersion
    // check, and it is checked against the target as it is now.
    if (expectedVersion != null) {
      const current = this.#approvalTarget(targetType, targetId);
      if (current.version !== expectedVersion) {
        return {
          action: "WAIT",
          reason: "command-version-conflict",
          intent,
          expectedVersion,
          currentVersion: current.version,
          approval,
        };
      }
    }

    return { action: "AUTHORIZE", reason: "command-authorized", intent, approval };
  }

  #approvalTarget(targetType, targetId) {
    switch (targetType) {
      case ApprovalTargetType.PROJECT: return this.store.getProject(targetId);
      case ApprovalTargetType.MILESTONE: return this.store.getMilestone(targetId);
      case ApprovalTargetType.GOAL: return this.store.getGoal(targetId);
      case ApprovalTargetType.TASK: return this.store.getTask(targetId);
      default: return null;
    }
  }

  #approvalIfPresent(approvalId) {
    try {
      return this.store.getApproval(approvalId);
    } catch {
      return null;
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
      const sync = this.#syncStatus(Collection.PROJECT, project, ProjectStatus.COMPLETED);
      return { action: sync.action, reason: "project-completed", project: sync.record, milestones, synced };
    }

    return { action: "NOOP", reason: "project-active", project, milestones, synced };
  }
}

function defaultIdFactory(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
