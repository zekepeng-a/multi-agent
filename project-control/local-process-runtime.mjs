import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { acceptCapsuleInput, capsuleReceipt, CapsuleInputRefusedError } from "./capsule-receipt.mjs";
import {
  RuntimeOutcome,
  RuntimeState,
  createRuntimeObservation,
  createRuntimeRef,
  createRuntimeResult,
  normalizeRuntimeCapabilities,
} from "./runtime-adapter.mjs";

/**
 * Real OS-process Runtime Adapter used as the G5 portable execution proof.
 *
 * Process specification comes from contextCapsule.process:
 *   { command: string, args?: string[], cwd?: string, env?: object }
 */
export class LocalProcessRuntimeAdapter {
  constructor({ adapterId = "local-process", defaultCwd = process.cwd(), killSignal = "SIGTERM" } = {}) {
    this.adapterId = adapterId;
    this.defaultCwd = defaultCwd;
    this.killSignal = killSignal;
    this.executions = new Map();
  }

  capabilities() {
    return normalizeRuntimeCapabilities({
      adapterId: this.adapterId,
      runtimeKind: "local-process",
      resume: false,
      sendMessage: false,
      eventStream: false,
      reconcile: false,
      pause: false,
    });
  }

  async start({ run, attempt, contextCapsule = {}, capsuleBinding = null, launchConfig = {}, signal = null } = {}) {
    const accepted = acceptCapsuleInput({ run, attempt, contextCapsule, capsuleBinding });
    const input = accepted ? launchConfig : contextCapsule;
    const spec = input?.process ?? input;
    if (typeof spec?.command !== "string" || spec.command.trim() === "") {
      throw new (accepted ? CapsuleInputRefusedError : Error)("LocalProcessRuntimeAdapter requires process.command");
    }
    const args = Array.isArray(spec.args) ? spec.args.map(String) : [];
    const externalId = randomUUID();
    const child = spawn(spec.command, args, {
      cwd: spec.cwd ?? this.defaultCwd,
      env: { ...process.env, ...(spec.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const runtimeRef = createRuntimeRef({
      adapterId: this.adapterId,
      runtimeKind: "local-process",
      externalId,
      metadata: {
        pid: child.pid ?? null,
        command: spec.command,
        args,
        runId: run?.id ?? null,
        attemptId: attempt?.id ?? null,
      },
    });

    const execution = {
      ...(accepted ? { capsuleInput: accepted } : {}),
      child,
      runtimeRef,
      state: RuntimeState.STARTING,
      stdout: "",
      stderr: "",
      exitCode: null,
      signal: null,
      resultPromise: null,
      completedAt: null,
    };
    this.executions.set(externalId, execution);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { execution.stdout += chunk; });
    child.stderr?.on("data", (chunk) => { execution.stderr += chunk; });

    child.once("spawn", () => {
      if (![RuntimeState.CANCELLED, RuntimeState.FAILED].includes(execution.state)) {
        execution.state = RuntimeState.RUNNING;
      }
    });

    execution.resultPromise = new Promise((resolve) => {
      let settled = false;
      const settle = (outcome, { exitCode = null, signalName = null, error = null } = {}) => {
        if (settled) return;
        settled = true;
        execution.exitCode = exitCode;
        execution.signal = signalName;
        execution.completedAt = new Date().toISOString();
        execution.state = outcome === RuntimeOutcome.COMPLETED
          ? RuntimeState.COMPLETED
          : outcome === RuntimeOutcome.CANCELLED
            ? RuntimeState.CANCELLED
            : RuntimeState.FAILED;

        const digest = createHash("sha256")
          .update(execution.stdout)
          .update("\0")
          .update(execution.stderr)
          .update("\0")
          .update(String(exitCode))
          .digest("hex");

        resolve(createRuntimeResult({
          outcome,
          runtimeRef,
          resultRef: `process-output://${externalId}`,
          revision: digest,
          completedAt: execution.completedAt,
          details: {
            exitCode,
            signal: signalName,
            stdout: execution.stdout,
            stderr: execution.stderr,
            error: error?.message ?? null,
          },
        }));
      };

      child.once("error", (error) => settle(RuntimeOutcome.FAILED, { error }));
      child.once("exit", (code, signalName) => {
        if (execution.state === RuntimeState.CANCELLED || signalName) {
          settle(RuntimeOutcome.CANCELLED, { exitCode: code, signalName });
        } else if (code === 0) {
          settle(RuntimeOutcome.COMPLETED, { exitCode: code });
        } else {
          settle(RuntimeOutcome.FAILED, { exitCode: code, signalName });
        }
      });
    });

    if (signal) {
      if (signal.aborted) await this.cancel(runtimeRef, "aborted-before-start");
      else signal.addEventListener("abort", () => { void this.cancel(runtimeRef, "aborted"); }, { once: true });
    }

    return {
      runtimeRef: structuredClone(runtimeRef),
      ...(accepted ? { capsuleReceipt: capsuleReceipt(accepted, runtimeRef) } : {}),
      observation: createRuntimeObservation({
        state: execution.state,
        runtimeRef,
        details: { pid: child.pid ?? null },
      }),
    };
  }

  async observe(runtimeRef) {
    const execution = this.#required(runtimeRef);
    return createRuntimeObservation({
      state: execution.state,
      runtimeRef: execution.runtimeRef,
      details: {
        pid: execution.child.pid ?? null,
        exitCode: execution.exitCode,
        signal: execution.signal,
      },
    });
  }

  async collectResult(runtimeRef) {
    return this.#required(runtimeRef).resultPromise;
  }

  async cancel(runtimeRef, reason = null) {
    const execution = this.#required(runtimeRef);
    if ([RuntimeState.COMPLETED, RuntimeState.FAILED, RuntimeState.CANCELLED].includes(execution.state)) return;
    execution.state = RuntimeState.CANCELLED;
    execution.cancelReason = reason;
    try {
      execution.child.kill(this.killSignal);
    } catch {
      // collectResult/exit observation remains authoritative for local process outcome.
    }
  }

  #required(runtimeRef) {
    const id = runtimeRef?.externalId;
    const execution = id ? this.executions.get(id) : null;
    if (!execution) throw new Error(`local runtime execution not found: ${id ?? "(none)"}`);
    return execution;
  }
}
