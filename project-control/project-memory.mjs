// ADR-0008 shared Memory semantics. Construct this facade only at the existing
// trusted Control Plane composition boundary, never from Runtime/model input.
// Like the existing Store's primitives, this is not an authentication service.
import { createHash } from "node:crypto";
import {
  InvariantError, ConflictError, createMemory, now,
  MemoryType, MemoryConfidence, MemoryStatus, MemorySourceType,
} from "./domain.mjs";

const fail = (message) => { throw new InvariantError(message); };
const text = (value, label) => {
  if (typeof value !== "string" || !value.trim()) fail(`${label} must be non-empty`);
};
const same = (a, b) => stable(a) === stable(b);
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("Memory requires plain JSON objects");
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  if (value === undefined || (typeof value === "number" && !Number.isFinite(value))) fail("Memory requires finite JSON values");
  const result = JSON.stringify(value);
  if (result === undefined) fail("Memory requires JSON values");
  return result;
}
export const memoryFingerprint = (value) => createHash("sha256").update(stable(value)).digest("hex");

// Lifecycle is checked separately. Evidence/Verification do not have versions.
export function memorySourceFingerprint(record) {
  const { status, createdAt, updatedAt, ...meaning } = record;
  return memoryFingerprint(meaning);
}
const sourceKey = (ref) => `${ref.type}:${ref.targetType ?? ""}:${ref.id}`;
const supportedTargets = ["PROJECT", "MILESTONE", "GOAL", "TASK"];

export function proposeMemory(input) {
  const allowed = ["projectId", "type", "confidence", "content", "applicability", "assumptions", "sourceRefs", "claim"];
  if (!input || Object.keys(input).some((key) => !allowed.includes(key))) fail("candidate contains control-owned or unknown fields");
  for (const field of ["projectId", "content", "applicability"]) text(input[field], field);
  if (!Object.values(MemoryType).includes(input.type)) fail("unsupported Memory type");
  if (!Object.values(MemoryConfidence).includes(input.confidence)) fail("unsupported Memory confidence");
  if (!Array.isArray(input.sourceRefs) || !input.sourceRefs.length) fail("Memory requires necessary sourceRefs");
  if (!Array.isArray(input.assumptions) || input.assumptions.some((a) => typeof a !== "string")) fail("Memory requires explicit assumptions");
  if (input.confidence === "INFERRED" && !input.assumptions.length) fail("INFERRED requires assumptions");
  const keys = new Set();
  for (const ref of input.sourceRefs) {
    if (!Object.values(MemorySourceType).includes(ref.type)) fail("unsupported Memory source type");
    for (const field of ["id", "projectId", "scope"]) text(ref[field], `source ${field}`);
    if (ref.projectId !== input.projectId) fail("cross-project source ref");
    if (!ref.pin || (!Number.isInteger(ref.pin.version) && typeof ref.pin.fingerprint !== "string")) fail("source requires an exact pin");
    if (Object.keys(ref.pin).some((key) => !["version", "fingerprint"].includes(key))) fail("unsupported source pin fields");
    if (ref.pin.fingerprint != null && !/^[a-f0-9]{64}$/.test(ref.pin.fingerprint)) fail("invalid source fingerprint pin");
    if (ref.type === "DECISION" || ref.type === "PROJECT_STATE") {
      if (!Number.isInteger(ref.pin.version) || ref.pin.version < 1) fail("versioned source requires exact positive version");
    } else if (!/^[a-f0-9]{64}$/.test(ref.pin.fingerprint ?? "")) fail("immutable source requires fingerprint pin");
    if (ref.type === "PROJECT_STATE" && !supportedTargets.includes(ref.targetType)) fail("unsupported Project State target");
    if (Object.keys(ref).some((key) => !["type", "id", "projectId", "scope", "pin", "targetType", "acceptanceId", "acceptanceVersion", "verificationId"].includes(key))) fail("only necessary supporting refs are admitted; optional/context roles are unsupported");
    if (keys.has(sourceKey(ref))) fail("duplicate supporting source");
    keys.add(sourceKey(ref));
  }
  stable(input);
  return structuredClone(input);
}

function required(store, collection, id) {
  const record = store.getRecord(collection, id);
  if (!record) fail(`missing internal ${collection} ${id}`);
  return record;
}
function targetProject(store, type, id) {
  if (!supportedTargets.includes(type)) fail("unsupported source target");
  const target = required(store, type.toLowerCase(), id);
  const projectId = type === "PROJECT" ? target.id : target.projectId;
  required(store, "project", projectId);
  if (type === "TASK" && target.goalId) {
    if (targetProject(store, "GOAL", target.goalId).projectId !== projectId) fail("task/goal ownership mismatch");
  }
  if (type === "GOAL" && target.milestoneId) {
    if (targetProject(store, "MILESTONE", target.milestoneId).projectId !== projectId) fail("goal/milestone ownership mismatch");
  }
  return { target, projectId };
}
function assertEvidence(store, evidence, projectId) {
  const type = evidence.targetType ?? "TASK";
  const { target, projectId: owner } = targetProject(store, type, evidence.targetId ?? evidence.taskId);
  if (owner !== projectId) fail("cross-project Evidence ownership");
  if (!["CANDIDATE", "VERIFIED", "ACCEPTED"].includes(evidence.status)) fail(`Evidence ${evidence.id} is ${evidence.status}`);
  // Reuse the same pinned contract, execution and aggregate snapshot proof.
  store.proveMemoryVerification({ id: `memory-check:${evidence.id}`, targetType: type,
    targetId: target.id, taskId: evidence.taskId, acceptanceId: evidence.acceptanceId,
    acceptanceVersion: evidence.acceptanceVersion, evidenceIds: [evidence.id],
    revision: evidence.revision, verdict: "FAIL" });
  if (evidence.workspaceId) {
    const workspace = required(store, "workspace", evidence.workspaceId);
    if (workspace.projectId !== projectId) fail("cross-project Evidence workspace");
  }
  return type;
}

function observeEvidence(evidence, type, observeReality) {
  // Aggregate evidence is re-proved against Control Store child snapshots.
  // Runtime artifacts need a trusted bounded observation, not a URL resolver.
  if (type !== "TASK" && !evidence.workspaceId) return null;
  if (typeof observeReality !== "function") return { unavailable: true, reason: "required reality observer is unavailable" };
  try {
    const observation = observeReality(structuredClone(evidence));
    if (!observation || observation instanceof Promise || !["CURRENT", "INVALID"].includes(observation.status) || !observation.observationRef || !Number.isFinite(Date.parse(observation.observedAt)) || (observation.status === "CURRENT" ? !observation.revision : !observation.reason)) {
      return { unavailable: true, reason: "required reality could not be observed reliably" };
    }
    return structuredClone(observation);
  } catch { return { unavailable: true, reason: "required reality observation failed" }; }
}

export function resolveMemorySource(store, ref, { observeReality = null, confidence = null } = {}) {
  const observedAt = now();
  const observations = [];
  try {
    let record;
    let evidence = [];
    if (ref.type === "DECISION") {
      record = required(store, "decision", ref.id);
      required(store, "project", record.projectId);
      if (record.projectId !== ref.projectId) fail("cross-project Decision ownership");
      if (record.status !== "ACTIVE") fail(`Decision ${ref.id} is ${record.status}`);
    } else if (ref.type === "EVIDENCE") {
      record = required(store, "evidence", ref.id);
      evidence = [record];
    } else if (ref.type === "VERIFICATION") {
      record = required(store, "verification", ref.id);
      if (targetProject(store, record.targetType ?? "TASK", record.targetId ?? record.taskId).projectId !== ref.projectId) fail("cross-project Verification ownership");
      evidence = store.proveMemoryVerification(record).evidence;
    } else if (ref.type === "PROJECT_STATE") {
      const owned = targetProject(store, ref.targetType, ref.id);
      record = owned.target;
      if (owned.projectId !== ref.projectId) fail("cross-project Project State ownership");
      if (ref.verificationId != null) {
        if (record.acceptanceId !== ref.acceptanceId || record.acceptanceVersion !== ref.acceptanceVersion) fail("Project State Acceptance pin mismatch");
        const verification = required(store, "verification", ref.verificationId);
        const proof = store.proveMemoryVerification(verification);
        const acceptedStatus = ref.targetType === "TASK" || ref.targetType === "GOAL" ? "ACCEPTED" : "COMPLETED";
        const eventType = { TASK: "task.accepted", GOAL: "goal.accepted", MILESTONE: "milestone.completed", PROJECT: "project.completed" }[ref.targetType];
        if (record.status !== acceptedStatus || proof.acceptance.status !== "PASSED" || verification.verdict !== "PASS" || verification.targetId !== record.id || verification.targetType !== ref.targetType) fail("Project State lacks its own passed Acceptance proof");
        if (!store.allEvents().some((event) => event.type === eventType && event.aggregateId === record.id && event.payload.verificationId === verification.id)) fail("Project State has no contract-bound acceptance event");
        evidence = proof.evidence;
      }
    } else fail("unsupported Memory source type");
    if (ref.pin?.version != null && record.version !== ref.pin.version) fail("source exact-version pin changed");
    if (ref.pin?.fingerprint != null && memorySourceFingerprint(record) !== ref.pin.fingerprint) fail("source immutable fingerprint changed");
    if (!ref.pin) fail("source is unpinned");
    let unresolved = false;
    for (const item of evidence) {
      const type = assertEvidence(store, item, ref.projectId);
      if (confidence != null && confidence !== "INFERRED" && item.status === "CANDIDATE") fail("CANDIDATE Evidence may only support INFERRED");
      const observation = observeEvidence(item, type, observeReality);
      if (observation) {
        observations.push({ evidenceId: item.id, ...observation });
        if (observation.unavailable) unresolved = true;
        else if (observation.status === "INVALID") fail(`required reality invalid for Evidence ${item.id}: ${observation.reason}`);
        else if (observation.revision !== item.revision || (item.workspaceId && observation.workspaceRevision !== item.workspaceRevision)) fail(`required reality revision changed for Evidence ${item.id}`);
      }
    }
    return { ref: structuredClone(ref), validity: unresolved ? "UNRESOLVED" : "CURRENT",
      reason: unresolved ? "required reality observation unavailable" : "all required checks current",
      controlObservation: { observedAt, pin: structuredClone(ref.pin) }, observations,
      evidence: structuredClone(evidence), source: structuredClone(record) };
  } catch (error) {
    // Existing proof helpers report missing pinned control objects as Error.
    // Storage/driver failures still propagate, rather than pretending falsity.
    if (!(error instanceof InvariantError) && !/not found:/.test(error.message)) throw error;
    return { ref: structuredClone(ref), validity: "INVALID", reason: error.message,
      controlObservation: { observedAt, pin: structuredClone(ref.pin ?? null) }, observations };
  }
}

function admit(candidate, checks) {
  const { type, confidence, sourceRefs, claim = {} } = candidate;
  const families = sourceRefs.map((ref) => ref.type);
  const all = (types) => families.every((type) => types.includes(type));
  if (type === "DECISION" || type === "CONSTRAINT") {
    if (confidence !== "ACCEPTED" || families.length !== 1 || families[0] !== "DECISION") fail("DECISION/CONSTRAINT + ACCEPTED requires exactly one ACTIVE Decision");
    if (type === "CONSTRAINT") {
      text(claim.constraint, "explicit constraint");
      const decision = checks[0].source;
      if (![decision.title, decision.rationale].some((value) => value.includes(claim.constraint))) fail("constraint must be explicit in the source Decision");
    }
  } else if (type === "FACT" && confidence === "ACCEPTED") {
    if (!all(["PROJECT_STATE"]) || sourceRefs.some((ref) => !ref.acceptanceId || !ref.acceptanceVersion || !ref.verificationId)) fail("FACT + ACCEPTED requires own contract-bound PROJECT_STATE proof");
  } else if ((type === "FACT" || type === "LESSON") && confidence === "VERIFIED") {
    if (!all(["EVIDENCE", "VERIFICATION"]) || !families.includes("EVIDENCE") || !families.includes("VERIFICATION")) fail("VERIFIED requires Evidence and matching Verification");
    if (!["PASS", "FAIL"].includes(claim.verdict)) fail("VERIFIED claim requires explicit supported verdict");
    const verifications = checks.filter((c) => c.ref.type === "VERIFICATION").map((c) => c.source);
    const evidence = checks.filter((c) => c.ref.type === "EVIDENCE").map((c) => c.source);
    if (verifications.some((v) => v.verdict !== claim.verdict || !v.evidenceIds.every((id) => evidence.some((e) => e.id === id))) || evidence.some((e) => e.status === "CANDIDATE" || !verifications.some((v) => v.evidenceIds.includes(e.id)))) fail("verdict/claim mismatch or unmatched/CANDIDATE Evidence");
  } else if (confidence === "INFERRED" && (type === "FACT" || type === "LESSON")) {
    if (!all(type === "FACT" ? ["EVIDENCE", "VERIFICATION", "PROJECT_STATE"] : Object.values(MemorySourceType))) fail("unsupported INFERRED source family");
  } else fail("closed type/confidence/source admission matrix refuses this combination");
  if (confidence !== "INFERRED" && checks.some((c) => c.evidence?.some((e) => e.status === "CANDIDATE"))) fail("CANDIDATE Evidence may only support INFERRED");
}

function checkCandidate(store, candidate, observer) {
  const checks = candidate.sourceRefs.map((ref) => resolveMemorySource(store, ref, { observeReality: observer, confidence: candidate.confidence }));
  if (checks.some((c) => c.validity !== "CURRENT")) fail(`Memory sources are not CURRENT: ${checks.filter((c) => c.validity !== "CURRENT").map((c) => c.reason).join("; ")}`);
  admit(candidate, checks);
  return checks;
}

function eligibility(store, record, observeReality, includeInferred) {
  const checks = record.sourceRefs.map((ref) => resolveMemorySource(store, ref, { observeReality, confidence: record.confidence }));
  const reasons = [];
  if (record.status !== "ACTIVE") reasons.push(`recorded lifecycle ${record.status}`);
  for (const check of checks) if (check.validity !== "CURRENT") reasons.push(`${sourceKey(check.ref)}: ${check.validity}: ${check.reason}`);
  if (checks.every((check) => check.validity === "CURRENT")) {
    try { admit(record, checks); } catch (error) {
      if (!(error instanceof InvariantError)) throw error;
      reasons.push(`source admission no longer current: ${error.message}`);
    }
  }
  if (record.confidence === "INFERRED" && !includeInferred) reasons.push("INFERRED requires explicit opt-in");
  return { eligible: !reasons.length, reasons, checks,
    consistency: { controlStore: "read snapshot", externalReality: "independent pinned observations; no cross-boundary atomic snapshot" } };
}

export function queryCurrentMemory(store, { projectId, includeInferred = false, types = Object.values(MemoryType), query = "", limit = 20, observeReality = null } = {}) {
  text(projectId, "current-use ProjectId");
  if (typeof includeInferred !== "boolean" || !Number.isInteger(limit) || limit < 0 || typeof query !== "string" || !Array.isArray(types) || types.some((type) => !Object.values(MemoryType).includes(type))) fail("invalid Memory query");
  return store.runInReadSnapshot(() => {
    required(store, "project", projectId);
    const eligible = store.recordsMatching("memory", "projectId", projectId)
      .filter((record) => record.status === "ACTIVE" && types.includes(record.type))
      .map((record) => ({ ...record, currentUse: eligibility(store, record, observeReality, includeInferred) }))
      .filter((record) => record.currentUse.eligible);
    const tokens = [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
    const score = (record) => tokens.filter((token) => record.content.toLowerCase().includes(token)).length;
    return eligible.sort((a, b) => score(b) - score(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, limit);
  });
}

export function queryMemoryHistory(store, { id = null, projectId = null, statuses = null, observeReality = null } = {}) {
  if (!id && (!projectId || !Array.isArray(statuses) || !statuses.length || statuses.some((status) => !Object.values(MemoryStatus).includes(status)))) fail("history requires MemoryId or ProjectId with explicit lifecycle statuses");
  return store.runInReadSnapshot(() => {
    const records = id ? [required(store, "memory", id)] : store.recordsMatching("memory", "projectId", projectId).filter((r) => statuses.includes(r.status));
    if (projectId && records.some((r) => r.projectId !== projectId)) fail("cross-project history selection");
    return records.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((r) => ({ ...r, currentUse: eligibility(store, r, observeReality, false) }));
  });
}

function event(store, type, record, payload, commandId) {
  store.appendEvent({ type, aggregateType: "memory", aggregateId: record.id,
    aggregateVersion: record.version, payload: structuredClone(payload), commandId: commandId ?? null, occurredAt: now() });
}
function mutation(store, operation, intent, commandId, fn) {
  if (commandId != null) text(commandId, "mutation replay identity");
  // Bind intent in the existing replay registry's operation column; no new
  // durable Command lifecycle or backend-specific replay side table.
  const identity = `memory.${operation}:${memoryFingerprint(intent)}`;
  return store.runInTransaction(() => {
    if (commandId) {
      const replay = store.getCommand(commandId);
      if (replay) {
        if (replay.operation !== identity) fail("mutation replay identity reused for a different intent");
        return structuredClone(required(store, "memory", replay.resultId));
      }
    }
    const result = fn();
    if (commandId) store.putCommand(commandId, { operation: identity, resultId: result.id });
    return structuredClone(result);
  });
}

export class ProjectMemoryControl {
  #store; #actor; #human; #reviewer; #observe; #issued = new WeakMap();
  constructor({ store, controlActorId, humanActorId = null, resolveReviewerAssignment = null, observeReality = null } = {}) {
    if (!store) fail("Memory requires Control Store");
    text(controlActorId, "trusted control actor identity");
    if (humanActorId != null) text(humanActorId, "trusted human identity");
    this.#store = store;
    this.#actor = { type: "CONTROL_PLANE", actorId: controlActorId };
    this.#human = humanActorId;
    this.#reviewer = resolveReviewerAssignment;
    this.#observe = observeReality;
  }
  propose(input) { return proposeMemory(input); }
  validate(input, { method = "HUMAN", judgement = null, assignmentRef = null } = {}) {
    const candidate = proposeMemory(input);
    return this.#store.runInReadSnapshot(() => {
      const checks = checkCandidate(this.#store, candidate, this.#observe);
      let validator;
      let assignment = null;
      if (method === "HUMAN") {
        if (!this.#human) fail("no trusted HUMAN identity at the control boundary");
        validator = { type: "HUMAN", actorId: this.#human };
      } else if (method === "REVIEWER") {
        if (typeof this.#reviewer !== "function") fail("self-reported REVIEWER has no trusted assignment");
        assignment = this.#reviewer({ assignmentRef, candidate: structuredClone(candidate), candidateFingerprint: memoryFingerprint(candidate) });
        if (!assignment || assignment instanceof Promise || !assignment.actorId || !assignment.taskId || !assignment.assignmentRef || assignment.projectId !== candidate.projectId || assignment.candidateFingerprint !== memoryFingerprint(candidate)) fail("untraceable reviewer identity/task assignment");
        if (targetProject(this.#store, "TASK", assignment.taskId).projectId !== candidate.projectId) fail("reviewer task outside project");
        if (assignment.runId) {
          if (required(this.#store, "run", assignment.runId).taskId !== assignment.taskId) fail("reviewer Run/task mismatch");
          if (!assignment.attemptId || required(this.#store, "attempt", assignment.attemptId).runId !== assignment.runId) fail("reviewer Attempt/Run mismatch");
        } else if (assignment.attemptId) fail("reviewer Attempt requires Run");
        validator = { type: "REVIEWER", actorId: assignment.actorId };
      } else if (method === "CONTROL_PLANE_EXACT") {
        if (candidate.confidence === "INFERRED") fail("control cannot self-validate free-form inference");
        const literal = candidate.claim?.literal;
        const source = checks.find((c) => sourceKey(c.ref) === literal?.sourceKey)?.source;
        const allowedFields = ["title", "rationale", "status", "revision", "verdict"];
        if (!source || !allowedFields.includes(literal.field) || typeof source[literal.field] !== "string" || candidate.content !== source[literal.field]) fail("control validation requires exact deterministic source field rendering");
        if (candidate.confidence === "ACCEPTED" && checks.length !== 1) fail("exact rendering cannot attest additional unnecessary sources");
        if (candidate.confidence === "VERIFIED" && checks.filter((check) => check.ref.type === "VERIFICATION").length !== 1) fail("exact rendering requires one corresponding Verification proof");
        if (candidate.type === "CONSTRAINT" && !candidate.content.includes(candidate.claim.constraint)) fail("exact constraint rendering must include the explicit source constraint");
        validator = this.#actor;
      } else fail("unsupported validation method; role strings cannot authorize validation");
      if (method !== "CONTROL_PLANE_EXACT") {
        if (!judgement || judgement.faithful !== true || !same([...judgement.necessarySources ?? []].sort(), candidate.sourceRefs.map(sourceKey).sort())) fail("semantic judgement must attest fidelity and every necessary source; no contextual refs");
        text(judgement.reason, "attributable validation reason");
        if (candidate.confidence === "VERIFIED" && judgement.verdict !== candidate.claim.verdict) fail("semantic verdict/claim mismatch");
      }
      const attestation = structuredClone({ validator, method, assignment,
        candidateFingerprint: memoryFingerprint(candidate), sourceRefs: candidate.sourceRefs,
        confidence: candidate.confidence, scope: candidate.applicability,
        assumptions: candidate.assumptions, result: "VALIDATED", validatedAt: now(),
        judgement: method === "CONTROL_PLANE_EXACT" ? { exact: candidate.claim.literal, necessarySources: candidate.sourceRefs.map(sourceKey) } : judgement,
        observations: checks });
      this.#issued.set(attestation, memoryFingerprint(attestation));
      return attestation;
    });
  }
  promote({ id, candidate: input, attestation, supersedesMemoryId = null, expectedVersion = null }, { commandId = null } = {}) {
    const candidate = proposeMemory(input);
    const intent = { id, candidate, attestation, supersedesMemoryId, expectedVersion, actor: this.#actor };
    return mutation(this.#store, "promote", intent, commandId, () => {
      if (!this.#issued.has(attestation) || this.#issued.get(attestation) !== memoryFingerprint(attestation) || attestation.result !== "VALIDATED" || attestation.candidateFingerprint !== memoryFingerprint(candidate) || !same(attestation.sourceRefs, candidate.sourceRefs) || attestation.confidence !== candidate.confidence || attestation.scope !== candidate.applicability || !same(attestation.assumptions, candidate.assumptions)) fail("unissued, rejected or mismatched validation attestation");
      required(this.#store, "project", candidate.projectId);
      const observations = checkCandidate(this.#store, candidate, this.#observe);
      if (this.#store.getRecord("memory", id)) fail("promotion/replacement requires new MemoryId");
      let old = null;
      if (supersedesMemoryId != null) {
        old = required(this.#store, "memory", supersedesMemoryId);
        if (old.version !== expectedVersion) throw new ConflictError("Memory replacement expected_version conflict");
        if (old.projectId !== candidate.projectId || !["ACTIVE", "STALE"].includes(old.status)) fail("replacement requires same Project and non-terminal Memory");
      } else if (expectedVersion != null) fail("new promotion has no previous version");
      const record = createMemory({ id, candidate, validation: attestation, promotedBy: this.#actor, observations, supersedesMemoryId });
      if (!this.#store.insertRecord("memory", id, record)) throw new ConflictError("new MemoryId collision");
      if (old) {
        const next = { ...old, version: old.version + 1, status: "SUPERSEDED", supersededByMemoryId: id, updatedAt: now() };
        if (!this.#store.updateRecord("memory", old.id, next, expectedVersion)) throw new ConflictError("Memory replacement compare-and-set conflict");
        event(this.#store, "memory.superseded", next, { actor: this.#actor, reason: "independently validated replacement", replacementId: id, observations }, commandId);
      }
      event(this.#store, "memory.promoted", record, { actor: this.#actor, reason: attestation.judgement.reason ?? "exact deterministic field rendering", validation: attestation, observations, supersedesMemoryId }, commandId);
      return record;
    });
  }
  withdraw(id, expectedVersion, reason, { commandId = null } = {}) {
    if (!this.#human) fail("withdrawal requires trusted HUMAN instruction");
    return this.#stale(id, expectedVersion, reason, "HUMAN_WITHDRAWAL", { type: "HUMAN", actorId: this.#human }, commandId);
  }
  reconcile(id, expectedVersion, { commandId = null } = {}) {
    return this.#stale(id, expectedVersion, "required source invalidation", "SOURCE_INVALIDATION", this.#actor, commandId);
  }
  #stale(id, expectedVersion, reason, kind, actor, commandId) {
    text(reason, "attributable staleness reason");
    return mutation(this.#store, "stale", { id, expectedVersion, reason, kind, actor }, commandId, () => {
      const record = required(this.#store, "memory", id);
      if (record.version !== expectedVersion) throw new ConflictError("Memory stale expected_version conflict");
      if (record.status !== "ACTIVE") fail("only ACTIVE Memory may become STALE; no resurrection or terminal mutation");
      const observations = record.sourceRefs.map((ref) => resolveMemorySource(this.#store, ref, { observeReality: this.#observe, confidence: record.confidence }));
      if (kind === "SOURCE_INVALIDATION" && !observations.some((check) => check.validity === "INVALID")) fail("reconciliation requires known INVALID source; UNRESOLVED is not falsity");
      const next = { ...record, version: record.version + 1, status: "STALE", updatedAt: now(), staleness: { kind, reason, actor, observations, staledAt: now() } };
      if (!this.#store.updateRecord("memory", id, next, expectedVersion)) throw new ConflictError("Memory stale compare-and-set conflict");
      event(this.#store, "memory.staled", next, next.staleness, commandId);
      return next;
    });
  }
  query(options) { return queryCurrentMemory(this.#store, { ...options, observeReality: this.#observe }); }
  history(options) { return queryMemoryHistory(this.#store, { ...options, observeReality: this.#observe }); }
}
