import { ReconcileOutcome, now } from "./domain.mjs";
import { acceptCapsuleInput, capsuleReceipt } from "./capsule-receipt.mjs";
import {
  RuntimeOutcome,
  RuntimeState,
  createRuntimeObservation,
  createRuntimeRef,
  createRuntimeResult,
  normalizeRuntimeCapabilities,
} from "./runtime-adapter.mjs";

/**
 * Deterministic RuntimeAdapter used by controller tests.
 *
 * It implements the normalized G5 contract while retaining the historical
 * started/reconciled probes used by earlier Project Control tests.
 */
export class FakeRuntime {
  constructor({
    mode = "success",
    revision = "fake-revision-1",
    reconcileOutcome = ReconcileOutcome.UNKNOWN,
    recoveredResultRef = "artifact://fake/recovered",
  } = {}) {
    this.modes = Array.isArray(mode) ? [...mode] : [mode];
    this.revision = revision;
    this.reconcileOutcome = reconcileOutcome;
    this.recoveredResultRef = recoveredResultRef;
    this.started = [];
    this.reconciled = [];
    this.executions = new Map();
    this.sequence = 0;
  }

  capabilities() {
    return normalizeRuntimeCapabilities({
      adapterId: "fake-runtime",
      runtimeKind: "fake",
      reconcile: true,
    });
  }

  async start({ run, attempt, contextCapsule, capsuleBinding }) {
    const accepted = acceptCapsuleInput({ run, attempt, contextCapsule, capsuleBinding });
    this.started.push({ runId: run.id, attemptId: attempt.id });
    const mode = this.modes.length > 1 ? this.modes.shift() : this.modes[0];
    const externalId = `fake-${++this.sequence}`;
    const runtimeRef = createRuntimeRef({
      adapterId: "fake-runtime",
      runtimeKind: "fake",
      externalId,
      metadata: { runId: run.id, attemptId: attempt.id },
    });
    this.executions.set(externalId, {
      mode,
      runtimeRef,
      state: RuntimeState.RUNNING,
      cancelled: false,
      ...(accepted ? { capsuleInput: accepted } : {}),
    });
    return {
      runtimeRef,
      ...(accepted ? { capsuleReceipt: capsuleReceipt(accepted, runtimeRef) } : {}),
      observation: createRuntimeObservation({
        state: RuntimeState.RUNNING,
        runtimeRef,
      }),
    };
  }

  async observe(runtimeRef) {
    const execution = this.#required(runtimeRef);
    return createRuntimeObservation({
      state: execution.state,
      runtimeRef: execution.runtimeRef,
    });
  }

  async collectResult(runtimeRef) {
    const execution = this.#required(runtimeRef);
    if (execution.cancelled) {
      execution.state = RuntimeState.CANCELLED;
      return createRuntimeResult({
        outcome: RuntimeOutcome.CANCELLED,
        runtimeRef: execution.runtimeRef,
        revision: this.revision,
        completedAt: now(),
      });
    }
    if (execution.mode === "lost") {
      execution.state = RuntimeState.LOST;
      return createRuntimeResult({
        outcome: RuntimeOutcome.LOST,
        runtimeRef: execution.runtimeRef,
        resultRef: null,
        revision: this.revision,
      });
    }
    if (execution.mode === "fail") {
      execution.state = RuntimeState.FAILED;
      return createRuntimeResult({
        outcome: RuntimeOutcome.FAILED,
        runtimeRef: execution.runtimeRef,
        resultRef: "artifact://fake/failure",
        revision: this.revision,
        completedAt: now(),
      });
    }
    execution.state = RuntimeState.COMPLETED;
    return createRuntimeResult({
      outcome: RuntimeOutcome.COMPLETED,
      runtimeRef: execution.runtimeRef,
      resultRef: "artifact://fake/success",
      revision: this.revision,
      completedAt: now(),
    });
  }

  async cancel(runtimeRef) {
    const execution = this.#required(runtimeRef);
    execution.cancelled = true;
    execution.state = RuntimeState.CANCELLED;
  }

  /**
   * Normalized optional reconciliation capability.
   *
   * For compatibility with older tests/callers, this accepts either:
   *   reconcile(runtimeRef, { run, attempt })
   * or the legacy reconcile({ run, attempt }) object.
   */
  async reconcile(runtimeRefOrContext, context = {}) {
    const legacy = runtimeRefOrContext?.run && runtimeRefOrContext?.attempt;
    const run = legacy ? runtimeRefOrContext.run : context.run;
    const attempt = legacy ? runtimeRefOrContext.attempt : context.attempt;
    this.reconciled.push({ runId: run?.id ?? null, attemptId: attempt?.id ?? null });

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

  #required(runtimeRef) {
    const execution = runtimeRef?.externalId ? this.executions.get(runtimeRef.externalId) : null;
    if (!execution) throw new Error(`fake runtime execution not found: ${runtimeRef?.externalId ?? "(none)"}`);
    return execution;
  }
}
