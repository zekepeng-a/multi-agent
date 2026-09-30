import { createHash } from "node:crypto";
import {
  RuntimeOutcome,
  RuntimeState,
  createRuntimeObservation,
  createRuntimeRef,
  createRuntimeResult,
  normalizeRuntimeCapabilities,
} from "./runtime-adapter.mjs";

/**
 * Adapter over DeepSeek Harness ctx.workflowEngine.
 *
 * The adapter depends only on the public Workflow seam shape:
 *   workflowEngine.start(request) -> WorkflowRun
 *   WorkflowRun: { id, result, cancel(), dispose() }
 *
 * No DSH Session/Workflow identity becomes Project Control authority.
 */
export class DshWorkflowRuntimeAdapter {
  constructor({ workflowEngine, adapterId = "dsh-workflow" } = {}) {
    if (!workflowEngine || typeof workflowEngine.start !== "function") {
      throw new Error("DshWorkflowRuntimeAdapter requires workflowEngine.start()");
    }
    this.workflowEngine = workflowEngine;
    this.adapterId = adapterId;
    this.executions = new Map();
  }

  capabilities() {
    return normalizeRuntimeCapabilities({
      adapterId: this.adapterId,
      runtimeKind: "dsh-workflow",
      resume: false,
      sendMessage: false,
      eventStream: false,
      reconcile: false,
      pause: false,
    });
  }

  async start({ run, attempt, contextCapsule = {}, signal = null } = {}) {
    const spec = contextCapsule?.dshWorkflow ?? contextCapsule;
    if (typeof spec?.script !== "string" || spec.script.trim() === "") {
      throw new Error("DshWorkflowRuntimeAdapter requires contextCapsule.dshWorkflow.script");
    }
    if (!spec?.meta || typeof spec.meta.name !== "string" || typeof spec.meta.description !== "string") {
      throw new Error("DshWorkflowRuntimeAdapter requires workflow meta name/description");
    }
    if (!spec.parent) {
      throw new Error("DshWorkflowRuntimeAdapter requires the live DSH parent Agent");
    }

    const live = this.workflowEngine.start({
      script: spec.script,
      meta: structuredClone(spec.meta),
      args: structuredClone(spec.args ?? null),
      subagentProvider: spec.subagentProvider,
      maxTotalAgents: spec.maxTotalAgents,
      parent: spec.parent,
      signal: signal ?? undefined,
    });
    if (!live?.id || !live.result || typeof live.cancel !== "function" || typeof live.dispose !== "function") {
      throw new Error("workflowEngine.start() returned an invalid WorkflowRun");
    }

    const runtimeRef = createRuntimeRef({
      adapterId: this.adapterId,
      runtimeKind: "dsh-workflow",
      externalId: String(live.id),
      workflowId: String(live.id),
      metadata: {
        workflowName: spec.meta.name,
        runId: run?.id ?? null,
        attemptId: attempt?.id ?? null,
      },
    });
    const execution = {
      live,
      runtimeRef,
      state: RuntimeState.RUNNING,
      terminal: null,
      disposed: false,
    };
    this.executions.set(runtimeRef.externalId, execution);

    live.result.then((result) => {
      execution.terminal = result;
      execution.state = result.stopReason === "completed"
        ? RuntimeState.COMPLETED
        : result.stopReason === "cancelled"
          ? RuntimeState.CANCELLED
          : RuntimeState.FAILED;
    });

    return {
      runtimeRef: structuredClone(runtimeRef),
      observation: createRuntimeObservation({
        state: RuntimeState.RUNNING,
        runtimeRef,
        details: { workflowName: spec.meta.name },
      }),
    };
  }

  async observe(runtimeRef) {
    const execution = this.#required(runtimeRef);
    return createRuntimeObservation({
      state: execution.state,
      runtimeRef: execution.runtimeRef,
      details: execution.terminal ? {
        stopReason: execution.terminal.stopReason,
        error: execution.terminal.error ?? null,
        agentsStarted: execution.terminal.agentsStarted,
      } : {},
    });
  }

  async collectResult(runtimeRef) {
    const execution = this.#required(runtimeRef);
    const result = execution.terminal ?? await execution.live.result;
    execution.terminal = result;

    const outcome = result.stopReason === "completed"
      ? RuntimeOutcome.COMPLETED
      : result.stopReason === "cancelled"
        ? RuntimeOutcome.CANCELLED
        : RuntimeOutcome.FAILED;
    execution.state = outcome === RuntimeOutcome.COMPLETED
      ? RuntimeState.COMPLETED
      : outcome === RuntimeOutcome.CANCELLED
        ? RuntimeState.CANCELLED
        : RuntimeState.FAILED;

    const value = result.stopReason === "completed" ? result.value : null;
    const revision = createHash("sha256")
      .update(JSON.stringify(value))
      .update("\0")
      .update(String(result.stopReason))
      .digest("hex");

    const normalized = createRuntimeResult({
      outcome,
      runtimeRef: execution.runtimeRef,
      resultRef: `dsh-workflow-result://${execution.runtimeRef.externalId}`,
      revision,
      completedAt: new Date().toISOString(),
      details: {
        stopReason: result.stopReason,
        error: result.error ?? null,
        agentsStarted: result.agentsStarted,
        value: structuredClone(value),
      },
    });

    if (!execution.disposed) {
      execution.disposed = true;
      await execution.live.dispose();
    }
    return normalized;
  }

  async cancel(runtimeRef, reason = null) {
    const execution = this.#required(runtimeRef);
    if ([RuntimeState.COMPLETED, RuntimeState.FAILED, RuntimeState.CANCELLED].includes(execution.state)) return;
    execution.live.cancel(reason ?? undefined);
  }

  #required(runtimeRef) {
    const id = runtimeRef?.externalId;
    const execution = id ? this.executions.get(id) : null;
    if (!execution) throw new Error(`DSH workflow execution not found: ${id ?? "(none)"}`);
    return execution;
  }
}
