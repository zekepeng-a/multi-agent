// ADR-0009: trusted Control Plane composition, not a Runtime-facing mutation API.
// Storage transactions, events and mutation replay remain the Store's primitives.
import { CapsuleRole, CapsuleSourceType, createContextCapsule, InvariantError, ConflictError, now } from "./domain.mjs";
import { Collection } from "./store.mjs";
import { canonicalCapsuleJson, capsuleHash, capsuleFingerprint } from "./capsule-json.mjs";
import { queryCurrentMemory, memorySourceFingerprint, resolveMemorySource } from "./project-memory.mjs";

const fail = message => { throw new InvariantError(message); };
const equal = (a, b) => canonicalCapsuleJson(a) === canonicalCapsuleJson(b);
const nonempty = (v, label) => { if (typeof v !== "string" || !v.trim()) fail(`${label} must be non-empty`); };
const key = ref => `${ref.type}:${ref.id}:${ref.version ?? ""}:${ref.useScope ?? "CURRENT"}`;
const authority = Object.freeze({ PROJECT: "PROJECT_STATE", GOAL: "PROJECT_STATE", MILESTONE: "PROJECT_STATE",
  TASK: "EXECUTION_OBJECTIVE", ACCEPTANCE: "ACCEPTANCE_CONTRACT", DECISION: "DIRECTION_ONLY",
  MEMORY: "KNOWLEDGE_ONLY", EVIDENCE: "EVIDENCE_ONLY", VERIFICATION: "VERIFICATION_ONLY",
  WORKSPACE: "WORKSPACE_SCOPE", REALITY: "OBSERVATION_ONLY", POLICY: "POLICY_RESTRICTIONS",
  APPROVAL: "EXISTING_PERMISSION_FACT", POLICY_DECISION: "POLICY_AUDIT_ONLY", RUNTIME: "EXECUTION_RESTRICTIONS" });

export class ContextCapsuleControl {
  constructor({ store, runtime, controlActorId, profile, workspaceId, observeWorkspace, observeReality = null,
    policyContext, runtimeContext, verifyRequiredIntegrity, additionalSources = () => [], clock = now } = {}) {
    if (!store || !runtime) fail("Capsule requires Store and Runtime");
    nonempty(controlActorId, "trusted control actor");
    nonempty(profile?.id, "trusted profile id");
    nonempty(profile?.version, "trusted profile version");
    nonempty(profile?.assemblerVersion, "assembler version");
    if (!Number.isSafeInteger(profile?.maxBytes) || profile.maxBytes < 1) fail("profile requires positive byte budget");
    if (!workspaceId || typeof observeWorkspace !== "function" || typeof policyContext !== "function" || typeof runtimeContext !== "function") fail("trusted workspace, policy and runtime boundaries are required");
    if (typeof additionalSources !== "function") fail("source selector must be trusted callable");
    if (typeof verifyRequiredIntegrity !== "function") fail("trusted required integrity verifier is required");
    canonicalCapsuleJson(profile);
    this.store = store; this.runtime = runtime; this.controlActorId = controlActorId;
    this.profile = structuredClone({ ...profile, includeInferred: profile.includeInferred === true });
    this.workspaceId = workspaceId; this.observeWorkspace = observeWorkspace; this.observeReality = observeReality;
    this.policyContext = policyContext; this.runtimeContext = runtimeContext; this.additionalSources = additionalSources; this.clock = clock;
    this.verifyRequiredIntegrity = verifyRequiredIntegrity;
    this.inFlight = new Set();
  }

  #required(collection, id) {
    const record = this.store.getRecord(collection, id);
    if (!record) fail(`missing ${collection} source ${id}`);
    return record;
  }

  #binding({ projectId, taskId, runId, attemptId }) {
    const task = this.#required("task", taskId), run = this.#required("run", runId), attempt = this.#required("attempt", attemptId);
    if (task.projectId !== projectId || run.taskId !== taskId || attempt.runId !== runId ||
        task.currentRunId !== runId || run.currentAttemptId !== attemptId || !run.attemptIds.includes(attemptId)) fail("mismatched Project/Task/Run/Attempt binding");
    if (!["CREATED", "RUNNING"].includes(attempt.status) || !["READY", "RUNNING"].includes(run.status) || task.status !== "IN_PROGRESS") fail("execution binding is not dispatchable");
    const project = this.#required("project", projectId);
    if (project.status !== "ACTIVE") fail("project is not active");
    const goal = task.goalId ? this.#required("goal", task.goalId) : null;
    const milestone = goal?.milestoneId ? this.#required("milestone", goal.milestoneId) : null;
    if ((goal && goal.projectId !== projectId) || (milestone && milestone.projectId !== projectId)) fail("cross-project hierarchy");
    const acceptance = this.store.getAcceptance(task.acceptanceId, task.acceptanceVersion);
    if (acceptance.targetType !== "TASK" || acceptance.targetId !== taskId) fail("wrong Task contract target");
    return { binding: { projectId, taskId, runId, attemptId }, task, run, attempt, project, goal, milestone, acceptance };
  }

  #external(boundary, ctx, label) {
    const observation = boundary(structuredClone(ctx.binding), structuredClone(ctx));
    canonicalCapsuleJson(observation);
    const allowed = ["id", "version", "status", "binding", "restrictions", "provenance", "observationRef", "observedAt", "adapterId", "approvalRequests", "policyDecisionIds", "denyExecution"];
    if (observation && Object.keys(observation).some(k => !allowed.includes(k))) fail(`${label} snapshot contains launch/session/unknown fields`);
    if (!observation || observation.status !== "CURRENT" || !observation.observationRef || !observation.observedAt || !observation.provenance ||
        !observation.id || !observation.version || !Array.isArray(observation.restrictions) || !equal(observation.binding, ctx.binding)) fail(`unresolved ${label} trusted execution observation`);
    return observation;
  }

  #selection(ctx) {
    const policy = this.#external(this.policyContext, ctx, "Policy"), runtime = this.#external(this.runtimeContext, ctx, "Runtime");
    if (policy.denyExecution === true) fail("current Policy DENY blocks execution");
    const capabilities = this.runtime.capabilities();
    canonicalCapsuleJson(capabilities);
    if (!capabilities.adapterId || !capabilities.runtimeKind || runtime.adapterId !== capabilities.adapterId) fail("Runtime capability/binding mismatch");
    const required = [
      { type: "PROJECT", id: ctx.project.id }, { type: "TASK", id: ctx.task.id },
      { type: "ACCEPTANCE", id: ctx.task.acceptanceId, version: ctx.task.acceptanceVersion },
      { type: "WORKSPACE", id: this.workspaceId }, { type: "REALITY", id: this.workspaceId },
      { type: "POLICY", id: policy.id }, { type: "RUNTIME", id: runtime.id },
    ];
    if (ctx.goal) required.push({ type: "GOAL", id: ctx.goal.id });
    if (ctx.milestone) required.push({ type: "MILESTONE", id: ctx.milestone.id });
    for (const [targetType, target] of [["PROJECT", ctx.project], ["MILESTONE", ctx.milestone], ["GOAL", ctx.goal]]) {
      if (target?.acceptanceId) required.push({ type: "ACCEPTANCE", id: target.acceptanceId, version: target.acceptanceVersion, targetType, targetId: target.id });
    }
    for (const decision of this.store.getActiveDecisionsForProject(ctx.binding.projectId)) required.push({ type: "DECISION", id: decision.id });
    if (!Array.isArray(policy.approvalRequests ?? [])) fail("Policy approval completeness is unresolved");
    for (const request of policy.approvalRequests ?? []) required.push({ type: "APPROVAL", id: request.approvalId, approvalRequest: request });
    if (!Array.isArray(policy.policyDecisionIds ?? [])) fail("PolicyDecision membership is unresolved");
    for (const id of policy.policyDecisionIds ?? []) required.push({ type: "POLICY_DECISION", id });
    const extras = this.additionalSources(structuredClone(ctx));
    canonicalCapsuleJson(extras);
    if (!Array.isArray(extras)) fail("source selection must be a finite array");
    const supplemental = [];
    for (const ref of extras) {
      if (Object.keys(ref).some(k => !["type", "id", "projectId", "role", "useScope", "version", "targetType", "targetId", "approvalRequest"].includes(k)) ||
          (ref.useScope != null && !["CURRENT", "HISTORY"].includes(ref.useScope))) fail("unsupported source selection fields/scope");
      if (!["REQUIRED", "SUPPLEMENTAL"].includes(ref.role)) fail("source requires explicit necessity");
      if (ref.role === "REQUIRED") required.push(ref); else supplemental.push(ref);
    }
    const memories = queryCurrentMemory(this.store, { projectId: ctx.binding.projectId, includeInferred: this.profile.includeInferred,
      limit: Number.MAX_SAFE_INTEGER, observeReality: this.observeReality });
    for (const memory of memories) supplemental.push({ type: "MEMORY", id: memory.id });
    const unique = refs => [...new Map(refs.map(ref => [key(ref), ref])).values()].sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
    const requiredRefs = unique(required);
    const requiredKeys = new Set(requiredRefs.map(key));
    const supplementalRefs = unique(supplemental).filter(ref => !requiredKeys.has(key(ref)));
    // The checkpoint binds the rules AND membership, rather than selected rows alone.
    const checkpoint = { profileFingerprint: capsuleFingerprint(this.profile), decisionRule: "ALL_PROJECT_ACTIVE_V1",
      requiredRefs, policyFingerprint: this.#externalPin(policy), runtimeFingerprint: this.#externalPin({ ...runtime, capabilities }) };
    return { requiredRefs, supplementalRefs, checkpoint, policy, runtime: { ...runtime, capabilities }, memories };
  }

  #externalPin(observation) {
    const { observedAt, observationRef, ...meaning } = observation;
    return capsuleFingerprint(meaning);
  }

  #ownership(record, type, projectId) {
    const owner = type === "PROJECT" ? record.id : record.projectId;
    if (owner !== projectId) fail(`cross-project ${type} source`);
  }

  #source(ref, role, ctx, selection) {
    if (!Object.values(CapsuleSourceType).includes(ref.type)) fail("unsupported Capsule source family");
    nonempty(ref.id, "source identity");
    const historical = ref.useScope === "HISTORY";
    if (historical && (role !== "SUPPLEMENTAL" || !["EVIDENCE", "VERIFICATION"].includes(ref.type))) fail("history is only supplemental Evidence/Verification");
    if (ref.projectId != null && ref.projectId !== ctx.binding.projectId) fail("cross-project source request");
    let content, pin, provenance, observation = { status: historical ? "HISTORICAL" : "CURRENT", observedAt: this.clock(),
      observationRef: `control:${ref.type}:${ref.id}`, observer: { type: "CONTROL_PLANE", actorId: this.controlActorId } };
    if (["PROJECT", "GOAL", "MILESTONE", "TASK"].includes(ref.type)) {
      content = this.#required(ref.type.toLowerCase(), ref.id); this.#ownership(content, ref.type, ctx.binding.projectId);
      if (ref.type === "TASK" && content.id !== ctx.task.id) fail("Task source must match execution objective");
      pin = { version: content.version, fingerprint: capsuleFingerprint(content) }; provenance = { collection: ref.type, id: content.id };
      if (["ACCEPTED", "COMPLETED"].includes(content.status)) {
        const eventType = { PROJECT: "project.completed", MILESTONE: "milestone.completed", GOAL: "goal.accepted", TASK: "task.accepted" }[ref.type];
        const event = this.store.allEvents().filter(e => e.type === eventType && e.aggregateId === ref.id).at(-1);
        const resolved = resolveMemorySource(this.store, { type: "PROJECT_STATE", targetType: ref.type, id: ref.id, projectId: ctx.binding.projectId,
          scope: "capsule-current-state", pin: { version: content.version }, acceptanceId: content.acceptanceId, acceptanceVersion: content.acceptanceVersion, verificationId: event?.payload.verificationId }, { observeReality: this.observeReality });
        if (!event?.payload.verificationId || resolved.validity !== "CURRENT") fail("accepted Project State lacks current contract-bound proof");
        observation.proof = resolved;
      }
    } else if (ref.type === "ACCEPTANCE") {
      const targetType = ref.targetType ?? "TASK", target = { TASK: ctx.task, PROJECT: ctx.project, MILESTONE: ctx.milestone, GOAL: ctx.goal }[targetType];
      if (!target || ref.id !== target.acceptanceId || ref.version !== target.acceptanceVersion || (ref.targetId && ref.targetId !== target.id)) fail("wrong pinned contract revision");
      content = this.store.getAcceptance(ref.id, ref.version);
      if (content.targetType !== targetType || content.targetId !== target.id) fail("wrong contract target");
      // Revision meaning is immutable; aggregate acceptance status is not contract content.
      const { status, updatedAt, ...contract } = content; content = contract;
      pin = { version: ref.version, fingerprint: capsuleFingerprint(contract) }; provenance = { targetType, targetId: target.id };
    } else if (ref.type === "DECISION") {
      content = this.#required("decision", ref.id); this.#ownership(content, ref.type, ctx.binding.projectId);
      if (content.status !== "ACTIVE") fail("inactive Decision cannot enter execution");
      pin = { version: content.version, fingerprint: capsuleFingerprint(content) }; provenance = { decidedBy: content.decidedBy, sourceRefs: content.sourceRefs };
    } else if (ref.type === "MEMORY") {
      const owned = this.#required("memory", ref.id); this.#ownership(owned, ref.type, ctx.binding.projectId);
      const selected = selection.memories.find(memory => memory.id === ref.id);
      if (!selected) fail("Memory is not ADR-0008 current-use eligible");
      const { currentUse, ...meaning } = selected;
      content = meaning; observation.memoryCurrentUse = currentUse;
      pin = { version: content.version, fingerprint: capsuleFingerprint(content) }; provenance = { validation: content.validation, sourceRefs: content.sourceRefs, promotedBy: content.promotedBy };
    } else if (["EVIDENCE", "VERIFICATION"].includes(ref.type)) {
      content = this.#required(ref.type.toLowerCase(), ref.id);
      const targetType = content.targetType ?? "TASK", targetId = content.targetId ?? content.taskId;
      const target = this.#required(targetType.toLowerCase(), targetId); this.#ownership(target, targetType, ctx.binding.projectId);
      pin = { fingerprint: memorySourceFingerprint(content) }; provenance = { targetType, targetId, acceptanceId: content.acceptanceId, acceptanceVersion: content.acceptanceVersion };
      if (historical) {
        // Still prove archived contract/execution linkage; do not assert current proof.
        const contract = this.store.getAcceptance(content.acceptanceId, content.acceptanceVersion);
        if (contract.targetType !== targetType || contract.targetId !== targetId) fail("historical contract target mismatch");
        if (ref.type === "VERIFICATION") for (const id of content.evidenceIds) {
          const evidence = this.#required("evidence", id);
          const evidenceType = evidence.targetType ?? "TASK", evidenceId = evidence.targetId ?? evidence.taskId;
          this.#ownership(this.#required(evidenceType.toLowerCase(), evidenceId), evidenceType, ctx.binding.projectId);
          if (evidenceType !== targetType || evidenceId !== targetId || evidence.acceptanceId !== content.acceptanceId || evidence.acceptanceVersion !== content.acceptanceVersion || evidence.revision !== content.revision) fail("historical Verification lineage mismatch");
        }
        if (content.taskId && content.runId) {
          const run = this.#required("run", content.runId), attempt = this.#required("attempt", content.attemptId);
          if (run.taskId !== content.taskId || attempt.runId !== run.id) fail("historical evidence lineage mismatch");
        }
        pin.archiveFingerprint = capsuleFingerprint(content);
      } else {
        const resolved = resolveMemorySource(this.store, { type: ref.type, id: ref.id, projectId: ctx.binding.projectId, scope: "capsule-current", pin }, { observeReality: this.observeReality });
        if (resolved.validity !== "CURRENT") fail(`source validity ${resolved.validity}: ${resolved.reason}`);
        observation = { ...observation, proof: resolved };
      }
    } else if (["WORKSPACE", "REALITY"].includes(ref.type)) {
      const workspace = this.#required("workspace", ref.id); this.#ownership(workspace, "WORKSPACE", ctx.binding.projectId);
      if (workspace.status !== "ACTIVE") fail("Workspace is not active");
      if (workspace.kind === "ISOLATED" && (workspace.owner?.runId !== ctx.run.id || workspace.owner?.attemptId !== ctx.attempt.id)) fail("Workspace execution ownership mismatch");
      const actual = this.observeWorkspace(structuredClone(workspace), structuredClone(ctx.binding));
      canonicalCapsuleJson(actual);
      if (actual?.status !== "CURRENT" || !actual.observationRef || !actual.observedAt || !actual.revision || actual.revision !== workspace.currentRevision) fail("Workspace/Reality unresolved or drifted");
      content = ref.type === "WORKSPACE" ? workspace : { workspaceId: workspace.id, revision: actual.revision };
      pin = { version: workspace.version, revision: actual.revision, fingerprint: capsuleFingerprint(content) };
      provenance = { workspaceId: workspace.id, rootRef: workspace.rootRef };
      observation = { ...observation, external: actual };
    } else if (["POLICY", "RUNTIME"].includes(ref.type)) {
      content = ref.type === "POLICY" ? selection.policy : selection.runtime;
      if (content.id !== ref.id) fail("trusted execution source identity mismatch");
      pin = { version: content.version, fingerprint: this.#externalPin(content) }; provenance = content.provenance;
      observation = { ...observation, external: { observationRef: content.observationRef, observedAt: content.observedAt, status: content.status } };
    } else if (ref.type === "POLICY_DECISION") {
      content = this.#required("policy_decision", ref.id);
      const command = this.#required("control_command", content.commandId), target = this.#required(command.targetType.toLowerCase(), command.targetId);
      this.#ownership(target, command.targetType, ctx.binding.projectId);
      if (command.version < content.commandVersion || command.targetVersion !== content.targetVersion || target.version !== content.targetVersion || selection.policy.version !== content.policyVersion) fail("PolicyDecision binding/policy drift");
      if (content.effect === "DENY" && role === "REQUIRED") fail("applicable PolicyDecision DENY blocks execution");
      pin = { fingerprint: capsuleFingerprint(content), commandVersion: command.version, commandFingerprint: capsuleFingerprint(command) }; provenance = { commandId: command.id, subjectId: content.subjectId, policyVersion: content.policyVersion };
    } else if (ref.type === "APPROVAL") {
      const request = ref.approvalRequest;
      if (!request || request.approvalId !== ref.id) fail("Approval requires trusted action/capability/scope binding");
      this.store.assertApprovalUsable({ ...request, at: new Date(this.clock()) });
      content = this.#required("approval", ref.id);
      const target = content.request ?? content;
      if (["PROJECT", "TASK", "GOAL", "MILESTONE"].includes(target.targetType)) this.#ownership(this.#required(target.targetType.toLowerCase(), target.targetId), target.targetType, ctx.binding.projectId);
      else if (!equal(request.executionBinding, ctx.binding)) fail("Approval requires trusted project execution binding");
      pin = { version: content.version, fingerprint: capsuleFingerprint(content) }; provenance = { requestedBy: content.requestedBy, decision: content.decision };
    }
    canonicalCapsuleJson(content); canonicalCapsuleJson(provenance);
    return { type: ref.type, id: ref.id, projectId: ["POLICY", "RUNTIME"].includes(ref.type) ? null : ctx.binding.projectId,
      executionBinding: ["POLICY", "RUNTIME", "APPROVAL"].includes(ref.type) ? ctx.binding : null,
      pin, authority: authority[ref.type], provenance, role, useScope: historical ? "HISTORY" : "CURRENT", validityObservation: observation,
      sourceRef: structuredClone(ref), content };
  }

  #mutation(operation, intent, commandId, callback) {
    nonempty(commandId, "mutation replay id");
    const fingerprint = capsuleFingerprint(intent), replayOperation = `capsule.${operation}:${fingerprint}`;
    return this.store.runInTransaction(() => {
      const replay = this.store.getCommand(commandId);
      if (replay) {
        if (replay.operation !== replayOperation) fail("Capsule replay intent mismatch");
        return { replay: true, value: JSON.parse(replay.resultId) };
      }
      const value = callback();
      this.store.putCommand(commandId, { operation: replayOperation, resultId: JSON.stringify(value) });
      return { replay: false, value };
    });
  }

  #event(type, id, payload, commandId) {
    this.store.appendEvent({ type: `capsule.${type}`, aggregateType: "capsule", aggregateId: id, aggregateVersion: null,
      payload, commandId, occurredAt: this.clock() });
  }

  #delivery(attempt, delivery, patch = {}) {
    const next = { ...attempt, ...patch, capsuleDelivery: { ...delivery, version: (attempt.capsuleDelivery?.version ?? 0) + 1 } };
    if (!this.store.compareRecord(Collection.ATTEMPT, attempt.id, next, attempt)) throw new ConflictError("Attempt capsule delivery CAS conflict");
    return next;
  }

  generate({ id, projectId, taskId, runId, attemptId }, { commandId } = {}) {
    const intent = { id, projectId, taskId, runId, attemptId, profile: this.profile };
    const result = this.#mutation("generate", intent, commandId, () => {
      nonempty(id, "ContextCapsuleId");
      const ctx = this.#binding({ projectId, taskId, runId, attemptId });
      if (ctx.attempt.capsuleDelivery && ctx.attempt.capsuleDelivery.status !== "PREPARED") fail("dispatch binding cannot be replaced");
      if (Object.values(ctx.binding).includes(id)) fail("CapsuleId must be independent of execution identities");
      const selection = this.#selection(ctx);
      const required = selection.requiredRefs.map(ref => this.#source(ref, "REQUIRED", ctx, selection));
      const integrity = this.#integrity(required, ctx);
      const supplemental = [];
      for (const ref of selection.supplementalRefs) {
        try { supplemental.push(this.#source(ref, "SUPPLEMENTAL", ctx, selection)); }
        catch (error) { if (/cross-project/.test(error.message)) throw error; /* unavailable non-necessary content omitted */ }
      }
      const priorities = this.profile.supplementalPriority ?? {};
      supplemental.sort((a, b) => (priorities[a.type] ?? 100) - (priorities[b.type] ?? 100) || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
      const payload = { capsuleId: id, schemaVersion: "1", assemblerVersion: this.profile.assemblerVersion, profile: this.profile,
        generatedAt: this.clock(), generatedBy: { type: "CONTROL_PLANE", actorId: this.controlActorId }, binding: ctx.binding,
        executionPins: { taskVersion: ctx.task.version, runVersion: ctx.run.version, attemptNumber: ctx.attempt.attemptNumber },
        selectionCheckpoint: selection.checkpoint, requiredIntegrity: integrity, sources: required, omissions: { supplementalCount: supplemental.length } };
      if (Buffer.byteLength(canonicalCapsuleJson(payload), "utf8") > this.profile.maxBytes) fail("required Capsule exceeds final UTF-8 byte budget");
      for (const item of supplemental) {
        const candidate = { ...payload, sources: [...payload.sources, item], omissions: { supplementalCount: payload.omissions.supplementalCount - 1 } };
        if (Buffer.byteLength(canonicalCapsuleJson(candidate), "utf8") <= this.profile.maxBytes) { payload.sources = candidate.sources; payload.omissions = candidate.omissions; }
      }
      const record = createContextCapsule({ id, payload });
      if (!this.store.insertRecord(Collection.CAPSULE, id, record)) fail("CapsuleId already exists; regeneration requires new identity");
      this.#delivery(ctx.attempt, { status: "PREPARED", capsuleId: id, payloadHash: record.payloadHash, preparedAt: this.clock() });
      this.#event("prepared", id, { binding: ctx.binding, payloadHash: record.payloadHash }, commandId);
      return id;
    });
    return this.history(result.value);
  }

  history(id) {
    const record = this.#required(Collection.CAPSULE, id);
    let payload;
    try { payload = JSON.parse(record.payloadJson); } catch { fail("Capsule archive missing/corrupt; cannot regenerate history"); }
    if (canonicalCapsuleJson(payload) !== record.payloadJson || capsuleHash(record.payloadJson) !== record.payloadHash ||
        Buffer.byteLength(record.payloadJson, "utf8") !== record.byteLength || payload.capsuleId !== id ||
        !equal(payload.binding, { projectId: record.projectId, taskId: record.taskId, runId: record.runId, attemptId: record.attemptId })) fail("Capsule archive integrity failure");
    return structuredClone({ ...record, payload });
  }

  #fresh(record) {
    const p = record.payload, ctx = this.#binding(p.binding), selection = this.#selection(ctx);
    if (!equal(p.profile, this.profile) || p.assemblerVersion !== this.profile.assemblerVersion || p.schemaVersion !== "1" ||
        record.byteLength > this.profile.maxBytes || p.executionPins.taskVersion !== ctx.task.version ||
        p.executionPins.runVersion !== ctx.run.version || p.executionPins.attemptNumber !== ctx.attempt.attemptNumber ||
        !equal(p.selectionCheckpoint, selection.checkpoint)) fail("Capsule selection, execution or profile drift; regenerate new CapsuleId");
    const actualRequired = p.sources.filter(s => s.role === "REQUIRED").map(s => s.sourceRef);
    if (!equal(actualRequired, selection.requiredRefs)) fail("Capsule required selection incomplete");
    const currentSources = [];
    for (const source of p.sources) {
      const current = this.#source(source.sourceRef, source.role, ctx, selection);
      currentSources.push(current);
      if (!equal(source.pin, current.pin) || source.authority !== current.authority || !equal(source.provenance, current.provenance)) fail(`Capsule ${source.role} source drift; regenerate new CapsuleId`);
    }
    this.#integrity(currentSources.filter(s => s.role === "REQUIRED"), ctx);
    return { ctx, checkedAt: this.clock(), storePins: p.executionPins,
      // Attempt metadata carries pins and observation facts, never another payload.
      sourceObservations: currentSources.map(s => ({ type: s.type, id: s.id, pin: s.pin,
        status: s.validityObservation.status, observedAt: s.validityObservation.observedAt,
        observationRef: s.validityObservation.observationRef,
        sourceChecks: (s.validityObservation.memoryCurrentUse?.checks ?? (s.validityObservation.proof ? [s.validityObservation.proof] : [])).map(c => ({
          ref: c.ref, validity: c.validity, controlObservation: c.controlObservation, observations: c.observations,
        })) })),
      externalObservations: currentSources.filter(s => s.validityObservation.external).map(s => ({ type: s.type, id: s.id, pin: s.pin, observation: s.validityObservation.external })) };
  }

  #integrity(sources, ctx) {
    // Existing trusted composition verifies semantic compatibility/completeness.
    // It is not an Agent role assertion and does not confer source authority.
    const result = this.verifyRequiredIntegrity(structuredClone(sources), structuredClone(ctx.binding));
    canonicalCapsuleJson(result);
    if (result?.complete !== true || result?.consistent !== true || !result.observationRef || !result.reason) fail("required integrity/consistency cannot be proved");
    return { ...result, observedAt: this.clock(), observer: { type: "CONTROL_PLANE", actorId: this.controlActorId } };
  }

  reserve({ capsuleId, attemptId, expectedDeliveryVersion }, { commandId } = {}) {
    const result = this.#mutation("reserve", { capsuleId, attemptId, expectedDeliveryVersion }, commandId, () => {
      const record = this.history(capsuleId);
      if (record.attemptId !== attemptId) fail("Capsule cannot be reused across Attempts");
      const attempt = this.#required("attempt", attemptId);
      if (attempt.capsuleDelivery?.status !== "PREPARED" || attempt.capsuleDelivery.version !== expectedDeliveryVersion || attempt.capsuleDelivery.capsuleId !== capsuleId) throw new ConflictError("Attempt already reserved or stale delivery version");
      const freshness = this.#fresh(record);
      this.#delivery(attempt, { ...attempt.capsuleDelivery, status: "DISPATCHING", dispatchCommandId: commandId,
        reservedAt: this.clock(), freshness: { checkedAt: freshness.checkedAt, storePins: freshness.storePins, externalObservations: freshness.externalObservations, sourceObservations: freshness.sourceObservations } });
      this.#event("dispatch-reserved", capsuleId, { attemptId, payloadHash: record.payloadHash }, commandId);
      return capsuleId;
    });
    return { won: !result.replay, record: this.history(result.value) };
  }

  #receipt(record, receipt, runtimeRef) {
    if (!receipt || !runtimeRef || !receipt.receivedAt || Number.isNaN(Date.parse(receipt.receivedAt)) ||
        receipt.capsuleId !== record.id || receipt.payloadHash !== record.payloadHash || !equal(receipt.runtimeRef, runtimeRef) ||
        !runtimeRef.externalId || runtimeRef.adapterId !== this.runtime.capabilities().adapterId || runtimeRef.runtimeKind !== this.runtime.capabilities().runtimeKind ||
        !["projectId", "taskId", "runId", "attemptId"].every(k => receipt[k] === record[k])) fail("untrusted/mismatched Adapter receipt");
    canonicalCapsuleJson(receipt);
    return structuredClone(receipt);
  }

  #observe(attemptId, status, facts, { commandId, expectedDeliveryVersion } = {}) {
    return this.#mutation("observe", { attemptId, status, facts, expectedDeliveryVersion }, commandId, () => {
      const attempt = this.#required("attempt", attemptId), delivery = attempt.capsuleDelivery;
      if (!delivery || !["DISPATCHING", "UNKNOWN"].includes(delivery.status) || delivery.version !== expectedDeliveryVersion) throw new ConflictError("delivery observation CAS/terminal conflict");
      const record = this.history(delivery.capsuleId);
      if (status === "RECEIVED") facts = { ...facts, receipt: this.#receipt(record, facts.receipt, facts.runtimeRef) };
      if (status === "NOT_RECEIVED" && (!facts.reason || facts.noExecution !== true)) fail("trusted explicit non-receipt requires no-execution proof");
      if (!["RECEIVED", "NOT_RECEIVED", "UNKNOWN"].includes(status)) fail("invalid delivery observation");
      const updated = this.#delivery(attempt, { ...delivery, status, observations: [...(delivery.observations ?? []), { status, ...facts,
        observer: { type: "CONTROL_PLANE", actorId: this.controlActorId }, observedAt: this.clock() }] }, facts.runtimeRef ? { runtimeRef: structuredClone(facts.runtimeRef) } : {});
      this.#event("delivery-observed", record.id, { attemptId, status, facts }, commandId);
      return updated.capsuleDelivery;
    }).value;
  }

  // Called only with attributable Adapter/recovery observations at the existing
  // trusted reconciliation seam. Worker messages are not input proof.
  reconcileDelivery(attemptId, observation, options) {
    if (observation?.receipt) return this.#observe(attemptId, "RECEIVED", { receipt: observation.receipt, runtimeRef: observation.runtimeRef }, options);
    if (observation?.noExecution === true && observation.observationRef && observation.reason) return this.#observe(attemptId, "NOT_RECEIVED", observation, options);
    fail("reconciliation requires attributable receipt/non-receipt facts");
  }

  recoverInterruptedDispatch(attemptId, { commandId } = {}) {
    if (this.inFlight.has(attemptId)) fail("cannot recover an in-process dispatch");
    const attempt = this.#required("attempt", attemptId), d = attempt.capsuleDelivery;
    if (d?.status === "DISPATCHING") this.#observe(attemptId, "UNKNOWN", { reason: "interrupted dispatch; delivery not proven" }, { commandId, expectedDeliveryVersion: d.version });
    const current = this.#required("attempt", attemptId);
    if (current.capsuleDelivery?.status === "UNKNOWN") this.store.runInTransaction(() => {
      this.store.updateAttempt(attemptId, { status: "LOST" });
      const run = this.store.getRun(current.runId);
      if (run.status !== "BLOCKED") this.store.updateRun(run.id, run.version, { status: "BLOCKED" });
    });
    return this.store.getAttempt(attemptId);
  }

  async dispatch({ capsuleId, attemptId, expectedDeliveryVersion, launchConfig = {} }, { commandId } = {}) {
    const reservation = this.reserve({ capsuleId, attemptId, expectedDeliveryVersion }, { commandId });
    if (!reservation.won) return { dispatched: false, replay: true, delivery: this.store.getAttempt(attemptId).capsuleDelivery };
    const record = reservation.record, attempt = this.store.getAttempt(attemptId), run = this.store.getRun(record.runId);
    this.inFlight.add(attemptId);
    let started;
    try {
      started = await this.runtime.start({ run, attempt, contextCapsule: JSON.parse(record.payloadJson),
        capsuleBinding: { capsuleId: record.id, payloadHash: record.payloadHash, projectId: record.projectId, taskId: record.taskId, runId: record.runId, attemptId }, launchConfig });
      this.#receipt(record, started?.capsuleReceipt, started?.runtimeRef);
    } catch (error) {
      const explicit = error?.code === "CAPSULE_NOT_RECEIVED" && error?.noExecution === true;
      const status = explicit ? "NOT_RECEIVED" : "UNKNOWN";
      const runtimeRef = started?.runtimeRef?.adapterId === this.runtime.capabilities().adapterId ? started.runtimeRef : null;
      this.#observe(attemptId, status, { reason: error.message, ...(runtimeRef ? { runtimeRef } : {}), ...(explicit ? { noExecution: true } : {}) },
        { commandId: `${commandId}:observation`, expectedDeliveryVersion: attempt.capsuleDelivery.version });
      if (explicit) this.store.runInTransaction(() => {
        this.store.updateAttempt(attemptId, { status: "FAILED" });
        const latestRun = this.store.getRun(run.id); this.store.updateRun(run.id, latestRun.version, { status: "FAILED" });
      });
      else this.#recoverInterruptedDispatchAfterCall(attemptId);
      return { dispatched: true, started: null, delivery: this.store.getAttempt(attemptId).capsuleDelivery };
    } finally { this.inFlight.delete(attemptId); }
    const delivery = this.#observe(attemptId, "RECEIVED", { receipt: started.capsuleReceipt, runtimeRef: started.runtimeRef },
      { commandId: `${commandId}:observation`, expectedDeliveryVersion: attempt.capsuleDelivery.version });
    return { dispatched: true, started, delivery };
  }

  #recoverInterruptedDispatchAfterCall(attemptId) {
    this.store.runInTransaction(() => {
      this.store.updateAttempt(attemptId, { status: "LOST" });
      const attempt = this.store.getAttempt(attemptId), run = this.store.getRun(attempt.runId);
      if (run.status !== "BLOCKED") this.store.updateRun(run.id, run.version, { status: "BLOCKED" });
    });
  }
}
