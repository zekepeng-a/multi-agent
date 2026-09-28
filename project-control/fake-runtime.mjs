import { AttemptStatus, ReconcileOutcome, RunStatus, now } from "./domain.mjs";

export class FakeRuntime {
  constructor({
    mode = "success",
    revision = "fake-revision-1",
    reconcileOutcome = ReconcileOutcome.UNKNOWN,
    recoveredResultRef = "artifact://fake/recovered",
  } = {}) {
    // `mode` may be a single mode or a sequence consumed one per start(); the
    // last entry repeats. A sequence is what lets a test express "the first
    // attempt was lost, the recovery attempt succeeded".
    this.modes = Array.isArray(mode) ? [...mode] : [mode];
    this.revision = revision;
    this.reconcileOutcome = reconcileOutcome;
    this.recoveredResultRef = recoveredResultRef;
    this.started = [];
    this.reconciled = [];
  }

  async start({ run, attempt }) {
    this.started.push({ runId: run.id, attemptId: attempt.id });
    const mode = this.modes.length > 1 ? this.modes.shift() : this.modes[0];
    if (mode === "lost") {
      return { status: AttemptStatus.LOST, resultRef: null, revision: this.revision };
    }
    if (mode === "fail") {
      return { status: AttemptStatus.FAILED, resultRef: "artifact://fake/failure", revision: this.revision };
    }
    return {
      status: AttemptStatus.COMPLETED,
      resultRef: "artifact://fake/success",
      revision: this.revision,
      completedAt: now(),
    };
  }

  /**
   * Reconciliation observation for a blocked Run. Answers only "what actually
   * happened to the external operation" and must have no side effect: it never
   * repairs, retries or re-executes anything.
   */
  async reconcile({ run, attempt }) {
    this.reconciled.push({ runId: run.id, attemptId: attempt.id });
    if (this.reconcileOutcome === ReconcileOutcome.CONFIRMED_COMPLETED) {
      return {
        outcome: ReconcileOutcome.CONFIRMED_COMPLETED,
        resultRef: this.recoveredResultRef,
        revision: this.revision,
      };
    }
    if (this.reconcileOutcome === ReconcileOutcome.CONFIRMED_NO_EFFECT) {
      return { outcome: ReconcileOutcome.CONFIRMED_NO_EFFECT };
    }
    return { outcome: ReconcileOutcome.UNKNOWN };
  }
}
