// Project Control Runtime Adapter contract.
//
// Runtime adapters execute work and report observations/results. They do not own
// Project State, Verification or Acceptance.

export const RuntimeState = Object.freeze({
  STARTING: "STARTING",
  RUNNING: "RUNNING",
  WAITING: "WAITING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  LOST: "LOST",
});

export const RuntimeOutcome = Object.freeze({
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  LOST: "LOST",
});

export class UnsupportedRuntimeCapabilityError extends Error {
  constructor(adapterId, capability) {
    super(`runtime adapter ${adapterId} does not support capability: ${capability}`);
    this.name = "UnsupportedRuntimeCapabilityError";
    this.code = "UNSUPPORTED_RUNTIME_CAPABILITY";
    this.adapterId = adapterId;
    this.capability = capability;
  }
}

export function normalizeRuntimeCapabilities({
  adapterId,
  runtimeKind,
  resume = false,
  sendMessage = false,
  eventStream = false,
  reconcile = false,
  pause = false,
} = {}) {
  if (typeof adapterId !== "string" || adapterId.trim() === "") {
    throw new Error("runtime adapter requires a non-empty adapterId");
  }
  if (typeof runtimeKind !== "string" || runtimeKind.trim() === "") {
    throw new Error("runtime adapter requires a non-empty runtimeKind");
  }
  return Object.freeze({
    adapterId,
    runtimeKind,
    resume: Boolean(resume),
    sendMessage: Boolean(sendMessage),
    eventStream: Boolean(eventStream),
    reconcile: Boolean(reconcile),
    pause: Boolean(pause),
  });
}

export function createRuntimeRef({
  adapterId,
  runtimeKind,
  externalId,
  sessionId = null,
  workflowId = null,
  teamId = null,
  provider = null,
  metadata = {},
} = {}) {
  for (const [field, value] of Object.entries({ adapterId, runtimeKind, externalId })) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`runtime ref requires a non-empty ${field}`);
    }
  }
  return {
    adapterId,
    runtimeKind,
    externalId,
    sessionId,
    workflowId,
    teamId,
    provider,
    metadata: structuredClone(metadata ?? {}),
  };
}

export function createRuntimeObservation({
  state,
  runtimeRef,
  observedAt = new Date().toISOString(),
  details = {},
} = {}) {
  if (!Object.values(RuntimeState).includes(state)) {
    throw new Error(`unknown runtime state: ${state}`);
  }
  if (!runtimeRef?.externalId) throw new Error("runtime observation requires runtimeRef");
  return {
    state,
    observedAt,
    runtimeRef: structuredClone(runtimeRef),
    details: structuredClone(details ?? {}),
  };
}

export function createRuntimeResult({
  outcome,
  runtimeRef,
  resultRef = null,
  revision = null,
  completedAt = null,
  details = {},
} = {}) {
  if (!Object.values(RuntimeOutcome).includes(outcome)) {
    throw new Error(`unknown runtime outcome: ${outcome}`);
  }
  if (!runtimeRef?.externalId) throw new Error("runtime result requires runtimeRef");
  return {
    outcome,
    runtimeRef: structuredClone(runtimeRef),
    resultRef,
    revision,
    completedAt,
    details: structuredClone(details ?? {}),
  };
}

export function assertCapability(adapter, capability) {
  const caps = adapter?.capabilities?.();
  if (!caps || caps[capability] !== true) {
    throw new UnsupportedRuntimeCapabilityError(caps?.adapterId ?? "unknown", capability);
  }
  return caps;
}

export function assertRuntimeAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") throw new Error("runtime adapter is required");
  for (const method of ["capabilities", "start", "observe", "collectResult", "cancel"]) {
    if (typeof adapter[method] !== "function") {
      throw new Error(`runtime adapter must implement ${method}()`);
    }
  }
  return adapter;
}
