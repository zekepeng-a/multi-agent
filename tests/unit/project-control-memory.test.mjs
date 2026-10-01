import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryStore } from "../../project-control/memory-store.mjs";
import { SqliteStore, isSqliteAvailable, SQLITE_REQUIREMENT } from "../../project-control/sqlite-store.mjs";
import { Controller } from "../../project-control/controller.mjs";
import { createProject, createGoal, createMilestone, createAcceptance, createVerification } from "../../project-control/domain.mjs";
import { proposeMemory, memoryFingerprint, memorySourceFingerprint, resolveMemorySource, queryCurrentMemory, queryMemoryHistory } from "../../project-control/project-memory.mjs";
import { seedMemoryFixture, boundary, candidate, fact, acceptedFact, inferred, ref, judgement, promote, decisionInput } from "../helpers/pc-memory-fixture.mjs";

const backends = [
  { name: "MemoryStore", make: () => new MemoryStore() },
  { name: "SQLite", skip: !isSqliteAvailable() && SQLITE_REQUIREMENT, make(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-memory-"));
    const store = new SqliteStore(path.join(dir, "control.db"));
    t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); });
    return store;
  } },
];

for (const backend of backends) {
  const run = (name, fn) => test(`${backend.name}: ${name}`, { skip: backend.skip }, (t) => {
    const store = backend.make(t); seedMemoryFixture(store);
    return fn({ t, store, control: boundary(store) });
  });

  run("proposal has no identity/state authority; self-reported roles cannot authorize validation", ({ store, control }) => {
    const input = candidate(store);
    assert.deepEqual(control.propose(input), input);
    assert.equal(store.allRecords("memory").length, 0);
    assert.throws(() => proposeMemory({ ...input, role: "REVIEWER" }), /control-owned/);
    const untrusted = boundary(store, { humanActorId: null });
    assert.throws(() => untrusted.validate(input, { method: "HUMAN", judgement: judgement(input), actorId: "human" }), /trusted HUMAN/);
    assert.throws(() => untrusted.validate(input, { method: "REVIEWER", assignmentRef: "self" }), /trusted assignment/);
    assert.throws(() => untrusted.validate(input, { method: "AGENT" }), /role strings/);
    assert.throws(() => untrusted.promote({ id: "m", candidate: input, attestation: { result: "VALIDATED", validator: { type: "CONTROL_PLANE" } } }), /unissued/);
    assert.throws(() => untrusted.withdraw("m", 1, "self-reported human"), /trusted HUMAN/);
    const controller = new Controller({ store, runtime: {}, verifier: {}, memoryBoundary: { controlActorId: "control", humanActorId: "human" } });
    assert.ok(controller.memory);
    assert.equal(new Controller({ store, runtime: {}, verifier: {} }).memory, null);
  });

  run("trusted reviewer assignment binds exact candidate and task/run/attempt; no role registry", ({ store }) => {
    const input = candidate(store);
    const reviewer = boundary(store, { humanActorId: null, resolveReviewerAssignment: ({ candidateFingerprint }) => ({ actorId: "reviewer-agent", projectId: "p", taskId: "t", runId: "r", attemptId: "at", assignmentRef: "trusted-task-assignment", candidateFingerprint }) });
    const attestation = reviewer.validate(input, { method: "REVIEWER", assignmentRef: "trusted-task-assignment", judgement: judgement(input) });
    assert.equal(attestation.validator.type, "REVIEWER");
    assert.equal(reviewer.promote({ id: "reviewed", candidate: input, attestation }).validation.assignment.taskId, "t");
    for (const over of [{ actorId: null }, { taskId: "missing" }, { projectId: "other" }, { candidateFingerprint: "wrong" }, { runId: "missing" }, { attemptId: "missing" }]) {
      const invalid = boundary(store, { resolveReviewerAssignment: () => ({ actorId: "reviewer", projectId: "p", taskId: "t", runId: "r", attemptId: "at", assignmentRef: "assignment", candidateFingerprint: memoryFingerprint(input), ...over }) });
      assert.throws(() => invalid.validate(input, { method: "REVIEWER", judgement: judgement(input) }));
    }
  });

  run("HUMAN fidelity differs from restricted exact control rendering", ({ store, control }) => {
    const exact = candidate(store, { claim: { literal: { sourceKey: "DECISION::d", field: "title" } } });
    const attestation = control.validate(exact, { method: "CONTROL_PLANE_EXACT" });
    assert.equal(attestation.validator.type, "CONTROL_PLANE");
    assert.equal(control.promote({ id: "exact", candidate: exact, attestation }).status, "ACTIVE");
    assert.throws(() => control.validate(candidate(store), { method: "CONTROL_PLANE_EXACT" }), /exact deterministic/);
    assert.throws(() => control.validate({ ...exact, content: "An invented implication" }, { method: "CONTROL_PLANE_EXACT" }), /exact deterministic/);
    assert.throws(() => control.validate(inferred(store), { method: "CONTROL_PLANE_EXACT" }), /free-form inference/);
    assert.throws(() => control.validate(candidate(store), { judgement: judgement(candidate(store), { faithful: false }) }), /fidelity/);
  });

  run("candidate/attestation immutable-field tampering and rejected/forged attestations fail atomically", ({ store, control }) => {
    const input = candidate(store);
    const attestation = control.validate(input, { judgement: judgement(input) });
    const before = store.allEvents();
    for (const over of [{ content: "changed" }, { confidence: "INFERRED" }, { applicability: "changed scope" }, { assumptions: ["changed"] }, { sourceRefs: [ref(store, "DECISION", "d", { scope: "changed" })] }]) {
      assert.throws(() => control.promote({ id: "m", candidate: { ...input, ...over }, attestation }));
    }
    assert.throws(() => control.promote({ id: "m", candidate: input, attestation: structuredClone(attestation) }), /unissued/);
    attestation.validator.actorId = "spoofed";
    assert.throws(() => control.promote({ id: "m", candidate: input, attestation }), /mismatched/);
    const rejected = control.validate(input, { judgement: judgement(input) }); rejected.result = "REJECTED";
    assert.throws(() => control.promote({ id: "m", candidate: input, attestation: rejected }), /rejected/);
    assert.deepEqual(store.allEvents(), before); assert.equal(store.allRecords("memory").length, 0);
  });

  run("closed type × confidence × source matrix admits precisely supported combinations", ({ store, control }) => {
    const admitted = [candidate(store), candidate(store, { type: "CONSTRAINT", content: "Do not implement Capsule.", claim: { constraint: "Do not implement Capsule." } }), fact(store), acceptedFact(store), inferred(store), fact(store, { type: "LESSON" }), fact(store, { confidence: "INFERRED", assumptions: ["bounded interpretation"], claim: {} })];
    admitted.forEach((input, i) => promote(control, input, `matrix-${i}`));
    const refused = [candidate(store, { type: "FACT" }), candidate(store, { confidence: "VERIFIED" }), candidate(store, { type: "LESSON" }), candidate(store, { type: "CONSTRAINT", content: "Invented constraint", claim: { constraint: "Invented constraint" } }), candidate(store, { type: "CONSTRAINT", confidence: "INFERRED", assumptions: ["invention"] }), candidate(store, { type: "UNKNOWN" }), fact(store, { confidence: "HIGH" }), fact(store, { sourceRefs: [ref(store, "VERIFICATION", "v")] }), inferred(store, { type: "FACT" })];
    refused.forEach((input) => assert.throws(() => control.validate(input, { judgement: judgement(input) })));
    for (const input of [candidate(store, { confidence: "INFERRED", assumptions: ["an invented choice"] }), candidate(store, { type: "CONSTRAINT", confidence: "VERIFIED", claim: { constraint: "Do not implement Capsule." } })]) {
      assert.throws(() => control.validate(input, { judgement: judgement(input) }));
    }
    assert.equal(store.getDecision("d").version, 1);
    assert.equal(store.getAcceptance("a", 1).status, "PASSED");
  });

  run("refs must be pinned, internal, supported, project-owned and necessary", ({ store, control }) => {
    const input = candidate(store);
    for (const source of [{ ...input.sourceRefs[0], pin: null }, { ...input.sourceRefs[0], id: "missing" }, { ...input.sourceRefs[0], type: "MEMORY" }, { ...input.sourceRefs[0], type: "EXTERNAL_REFERENCE" }, { ...input.sourceRefs[0], projectId: "other" }, { ...input.sourceRefs[0], optional: true }, { ...input.sourceRefs[0], pin: { version: 0 } }]) {
      assert.throws(() => control.validate({ ...input, sourceRefs: [source] }, { judgement: judgement({ ...input, sourceRefs: [source] }) }));
    }
    assert.throws(() => control.validate(input, { judgement: judgement(input, { necessarySources: [] }) }), /necessary source/);
    const wrong = store.getRecord("decision", "d"); store.putRecord("decision", "d", { ...wrong, projectId: "other" });
    assert.equal(resolveMemorySource(store, input.sourceRefs[0]).validity, "INVALID");
  });

  run("accepted FACT requires its own current contract and actual Acceptance, never status alone", ({ store, control }) => {
    promote(control, acceptedFact(store));
    const without = candidate(store, { type: "FACT", sourceRefs: [ref(store, "PROJECT_STATE", "p", { targetType: "PROJECT" })] });
    assert.throws(() => control.validate(without, { judgement: judgement(without) }), /own contract/);
    const input = acceptedFact(store, { sourceRefs: [ref(store, "PROJECT_STATE", "t", { targetType: "TASK", acceptanceId: "a", acceptanceVersion: 2, verificationId: "v" })] });
    assert.throws(() => control.validate(input, { judgement: judgement(input) }), /pin mismatch/);
    const contract = store.getAcceptance("a", 1); store.putRecord("acceptance", "a@1", { ...contract, status: "PENDING" });
    assert.equal(control.query({ projectId: "p" }).length, 0);
    store.putRecord("acceptance", "a@1", { ...contract, criteria: [{ id: "forged" }] });
    assert.equal(control.history({ id: "m" })[0].currentUse.eligible, false);
  });

  run("CANDIDATE is not upgraded; FAIL supports failure lesson but cannot claim PASS", ({ store, control }) => {
    const evidence = store.getEvidence("e"); store.putRecord("evidence", "e", { ...evidence, status: "CANDIDATE" });
    const input = fact(store);
    assert.throws(() => control.validate(input, { judgement: judgement(input) }), /CANDIDATE/);
    const interpretation = fact(store, { confidence: "INFERRED", assumptions: ["interpretation"], claim: {} });
    promote(control, interpretation, "inference");
    assert.equal(store.getEvidence("e").status, "CANDIDATE");
    store.putRecord("evidence", "e", evidence);
    store.recordVerification(createVerification({ id: "failure", taskId: "t", acceptanceId: "a", acceptanceVersion: 1, evidenceIds: ["e"], verdict: "FAIL", revision: "rev-1" }));
    const failure = fact(store, { type: "LESSON", content: "Observed failure at rev-1", claim: { verdict: "FAIL" }, sourceRefs: [ref(store, "EVIDENCE", "e"), ref(store, "VERIFICATION", "failure")] });
    promote(control, failure, "failure");
    const mismatch = { ...failure, claim: { verdict: "PASS" } };
    assert.throws(() => control.validate(mismatch, { judgement: judgement(mismatch) }), /verdict\/claim/);
    assert.throws(() => control.validate(failure, { judgement: judgement(failure, { verdict: "PASS" }) }), /semantic verdict/);
  });

  run("every necessary dependency must remain valid; deletion, pins and lifecycle suppress immediately", ({ store, control }) => {
    promote(control, fact(store));
    const evidence = store.getEvidence("e");
    for (const patch of [{ status: "STALE" }, { status: "SUPERSEDED" }, { revision: "changed" }, { attemptId: "missing" }, { acceptanceVersion: 2 }, { workspaceId: "missing", workspaceRevision: "changed" }]) {
      store.putRecord("evidence", "e", { ...evidence, ...patch });
      assert.equal(control.query({ projectId: "p", limit: 1 }).length, 0);
      assert.equal(control.history({ id: "m" })[0].status, "ACTIVE");
    }
    store.putRecord("evidence", "e", evidence);
    assert.equal(control.query({ projectId: "p" }).length, 1);
    const originalGet = store.getRecord.bind(store);
    store.getRecord = (collection, id) => collection === "evidence" && id === "e" ? null : originalGet(collection, id);
    assert.equal(control.query({ projectId: "p" }).length, 0);
    assert.match(control.history({ id: "m" })[0].currentUse.reasons.join(" "), /missing internal/);
  });

  run("PROJECT_STATE uses exact-version invalidation despite unchanged asserted fields", ({ store, control }) => {
    promote(control, acceptedFact(store));
    const current = store.getTask("t"); store.updateTask("t", current.version, { title: "unrelated title change" });
    const debug = control.history({ id: "m" })[0];
    assert.equal(debug.status, "ACTIVE"); assert.equal(debug.currentUse.eligible, false);
    assert.match(debug.currentUse.reasons.join(" "), /exact-version/);
    const stale = control.reconcile("m", 1, { commandId: "reconcile" });
    assert.equal(stale.staleness.kind, "SOURCE_INVALIDATION");
    assert.equal(stale.staleness.actor.type, "CONTROL_PLANE");
  });

  run("UNRESOLVED observations exclude without mutating lifecycle or inventing falsity", ({ store, control }) => {
    promote(control, fact(store));
    const before = store.allEvents();
    for (const observeReality of [null, () => { throw new Error("offline"); }, () => ({ status: "UNKNOWN" })]) {
      const unavailable = boundary(store, { observeReality });
      assert.equal(unavailable.query({ projectId: "p" }).length, 0);
      const debug = unavailable.history({ id: "m" })[0];
      assert.equal(debug.status, "ACTIVE"); assert.ok(debug.currentUse.checks.some((c) => c.validity === "UNRESOLVED"));
      assert.throws(() => unavailable.reconcile("m", 1), /UNRESOLVED is not falsity/);
    }
    assert.deepEqual(store.allEvents(), before);
  });

  run("source recheck at promotion refuses a previously valid attestation", ({ store, control }) => {
    const input = candidate(store);
    const attestation = control.validate(input, { judgement: judgement(input) });
    store.revokeDecision("d", 1, { revokedBy: { type: "HUMAN", actorId: "human" }, reason: "direction changed" });
    const before = store.allEvents();
    assert.throws(() => control.promote({ id: "m", candidate: input, attestation }, { commandId: "promotion" }), /not CURRENT/);
    assert.deepEqual(store.allEvents(), before); assert.equal(store.getCommand("promotion"), null);
  });

  run("Human withdrawal is attributable, separate from invalidation; no stale resurrection", ({ store, control }) => {
    const { args } = promote(control, candidate(store));
    assert.throws(() => control.withdraw("m", 1, ""), /non-empty/);
    const stale = control.withdraw("m", 1, "Human no longer wants this knowledge used", { commandId: "withdraw" });
    assert.equal(stale.staleness.kind, "HUMAN_WITHDRAWAL");
    assert.ok(stale.staleness.observations.every((c) => c.validity === "CURRENT"));
    assert.equal(control.promote(args, { commandId: "promote:m" }).status, "STALE");
    assert.equal(control.query({ projectId: "p" }).length, 0);
    assert.throws(() => control.withdraw("m", 2, "repeat"), /only ACTIVE/);
    assert.throws(() => control.promote(args), /new MemoryId/);
    assert.equal(store.getDecision("d").status, "ACTIVE");
  });

  run("new-id replacement independently validates, preserves meaning and atomically links lineage", ({ store, control }) => {
    const original = promote(control, candidate(store)).record;
    control.withdraw("m", 1, "reword for new scoped meaning");
    const next = candidate(store, { content: "Faithful scoped restatement of bounded Memory decision" });
    const replacement = promote(control, next, "m2", { supersedesMemoryId: "m", expectedVersion: 2 }).record;
    const old = control.history({ id: "m" })[0];
    assert.equal(old.status, "SUPERSEDED"); assert.equal(old.supersededByMemoryId, "m2");
    assert.equal(replacement.supersedesMemoryId, "m");
    assert.equal(old.content, original.content); assert.deepEqual(old.validation, original.validation);
    assert.equal(replacement.status, "ACTIVE");
    assert.throws(() => promote(control, candidate(store), "m3", { supersedesMemoryId: "m", expectedVersion: 3 }), /non-terminal/);
    const got = control.history({ id: "m2" })[0]; got.content = "changed clone";
    assert.equal(control.history({ id: "m2" })[0].content, next.content);
    assert.equal(typeof control.updateMemory, "undefined");
  });

  run("rollback covers both rows, all events and replay even after partial writes", ({ store, control }) => {
    promote(control, candidate(store));
    const input = candidate(store, { content: "replacement" }); const attestation = control.validate(input, { judgement: judgement(input) });
    const args = { id: "m2", candidate: input, attestation, supersedesMemoryId: "m", expectedVersion: 1 };
    const before = { rows: store.allRecords("memory"), events: store.allEvents() };
    for (const primitive of ["updateRecord", "appendEvent", "putCommand"]) {
      const original = store[primitive].bind(store);
      store[primitive] = (...values) => {
        const result = original(...values);
        if (primitive === "appendEvent" || primitive === "putCommand" || values[0] === "memory") throw new Error("injected write failure");
        return result;
      };
      assert.throws(() => control.promote(args, { commandId: "replace" }), /injected/);
      store[primitive] = original;
      assert.deepEqual(store.allRecords("memory"), before.rows); assert.deepEqual(store.allEvents(), before.events);
      assert.equal(store.getCommand("replace"), null);
    }
  });

  run("CAS rejects stale staling and competing replacements; failed promotion leaves no new record", ({ store, control }) => {
    promote(control, candidate(store));
    assert.throws(() => control.withdraw("m", 0, "stale caller"), /conflict/);
    const one = candidate(store, { content: "one" }); const two = candidate(store, { content: "two" });
    const a = control.validate(one, { judgement: judgement(one) }); const b = control.validate(two, { judgement: judgement(two) });
    control.promote({ id: "one", candidate: one, attestation: a, supersedesMemoryId: "m", expectedVersion: 1 });
    assert.throws(() => control.promote({ id: "two", candidate: two, attestation: b, supersedesMemoryId: "m", expectedVersion: 1 }), /conflict/);
    assert.equal(store.getRecord("memory", "two"), null);
    const original = store.updateRecord.bind(store); store.updateRecord = (...values) => values[0] === "memory" ? false : original(...values);
    assert.throws(() => control.withdraw("one", 1, "concurrent"), /compare-and-set/);
    assert.equal(store.getRecord("memory", "one").status, "ACTIVE");
  });

  run("replacement cross-project and reused identity fail closed", ({ store, control }) => {
    promote(control, candidate(store));
    store.createProjectDecision(decisionInput({ id: "other-d", projectId: "other" }));
    const input = candidate(store, { projectId: "other", sourceRefs: [{ ...ref(store, "DECISION", "other-d"), projectId: "other" }] });
    const attestation = control.validate(input, { judgement: judgement(input) });
    assert.throws(() => control.promote({ id: "other-m", candidate: input, attestation, supersedesMemoryId: "m", expectedVersion: 1 }), /same Project/);
    assert.equal(store.getRecord("memory", "other-m"), null);
    const duplicate = candidate(store); const proof = control.validate(duplicate, { judgement: judgement(duplicate) });
    assert.throws(() => control.promote({ id: "m", candidate: duplicate, attestation: proof, supersedesMemoryId: "m", expectedVersion: 1 }), /new MemoryId/);
  });

  run("Decision terminal lifecycle excludes Memory before reconciliation and never upgrades its authority", ({ store, control }) => {
    const original = store.getDecision("d");
    promote(control, candidate(store));
    assert.deepEqual(store.getDecision("d"), original);
    assert.equal(control.query({ projectId: "p" })[0].currentUse.checks[0].source.decidedBy.type, "HUMAN");
    store.supersedeDecision("d", 1, decisionInput({ id: "d2" }));
    assert.equal(control.query({ projectId: "p" }).length, 0);
    const history = control.history({ id: "m" })[0]; assert.equal(history.status, "ACTIVE");
    assert.equal(history.validation.observations[0].source.decidedBy.type, "HUMAN");
    control.reconcile("m", 1);
    assert.equal(store.getDecision("d2").status, "ACTIVE");
  });

  run("project/lifecycle/source filters precede deterministic relevance and limit", ({ store, control }) => {
    promote(control, candidate(store, { content: "needle needle needle" }), "a-stale");
    control.withdraw("a-stale", 1, "withdraw");
    promote(control, candidate(store, { content: "ordinary valid" }), "c");
    promote(control, candidate(store, { content: "ordinary valid" }), "b");
    assert.deepEqual(control.query({ projectId: "p", query: "needle", limit: 1 }).map((r) => r.id), ["b"]);
    promote(control, fact(store, { content: "needle" }), "invalid");
    const evidence = store.getEvidence("e"); store.putRecord("evidence", "e", { ...evidence, status: "STALE" });
    assert.deepEqual(control.query({ projectId: "p", query: "needle", limit: 1 }).map((r) => r.id), ["b"]);
    assert.equal(control.query({ projectId: "other" }).length, 0);
    assert.throws(() => control.query({ limit: 1 }), /ProjectId/);
    assert.throws(() => control.query({ projectId: "p", includeInferred: "yes" }), /invalid/);
  });

  run("INFERRED requires explicit opt-in; history is a distinct explicit read surface", ({ store, control }) => {
    promote(control, inferred(store));
    assert.equal(control.query({ projectId: "p" }).length, 0);
    const selected = control.query({ projectId: "p", includeInferred: true });
    assert.equal(selected[0].confidence, "INFERRED"); assert.equal(selected[0].assumptions.length, 1);
    assert.equal(control.history({ projectId: "p", statuses: ["ACTIVE"] }).length, 1);
    assert.throws(() => control.history({ projectId: "p" }), /explicit lifecycle/);
    assert.throws(() => control.history({ id: "m", projectId: "other" }), /cross-project/);
  });

  run("reads never write; independently pinned observations do not claim database/filesystem atomicity", ({ store, control }) => {
    promote(control, fact(store));
    const before = { memory: store.allRecords("memory"), events: store.allEvents() };
    for (const primitive of ["putRecord", "insertRecord", "updateRecord", "appendEvent", "putCommand"]) store[primitive] = () => { throw new Error("read attempted write"); };
    const result = control.query({ projectId: "p" })[0];
    assert.match(result.currentUse.consistency.externalReality, /no cross-boundary atomic/);
    assert.ok(result.currentUse.checks[0].controlObservation.observedAt);
    assert.equal(result.currentUse.checks[0].observations[0].observationRef, "test:observation");
    control.history({ id: "m" });
    assert.deepEqual(store.allRecords("memory"), before.memory); assert.deepEqual(store.allEvents(), before.events);
  });

  run("replay is intent-bound, durable and never resurrects stale/superseded results", ({ store, control }) => {
    const { args } = promote(control, candidate(store)); const before = store.allEvents();
    assert.equal(control.promote(args, { commandId: "promote:m" }).id, "m"); assert.deepEqual(store.allEvents(), before);
    assert.throws(() => control.promote({ ...args, id: "different" }, { commandId: "promote:m" }), /different intent/);
    control.withdraw("m", 1, "withdraw", { commandId: "withdraw" });
    assert.equal(control.withdraw("m", 1, "withdraw", { commandId: "withdraw" }).status, "STALE");
    assert.throws(() => control.withdraw("m", 1, "different", { commandId: "withdraw" }), /different intent/);
    const next = promote(control, candidate(store), "m2", { supersedesMemoryId: "m", expectedVersion: 2 });
    const count = store.allEvents().length;
    assert.equal(control.promote(args, { commandId: "promote:m" }).status, "SUPERSEDED");
    assert.equal(control.promote(next.args, { commandId: "promote:m2" }).id, "m2");
    assert.equal(store.allEvents().length, count);
  });

  run("unrelated control change and elapsed observation time do not invent invalidity", ({ store, control }) => {
    promote(control, candidate(store));
    store.updateProject("other", 1, { name: "changed unrelated project" });
    const observer = boundary(store, { observeReality: (e) => ({ status: "CURRENT", revision: e.revision, observationRef: "late-observation", observedAt: "2036-01-01T00:00:00Z" }) });
    assert.equal(observer.query({ projectId: "p" }).length, 1);
    promote(control, fact(store), "fact");
    assert.equal(observer.query({ projectId: "p" }).length, 2);
  });

  run("all four PROJECT_STATE targets resolve ownership; contract-free completion cannot be accepted FACT", ({ store, control }) => {
    store.seedMilestone(createMilestone({ id: "ms", projectId: "p", name: "Milestone" }));
    store.seedGoal(createGoal({ id: "g", projectId: "p", milestoneId: "ms", title: "Goal" }));
    for (const [targetType, id] of [["PROJECT", "p"], ["MILESTONE", "ms"], ["GOAL", "g"], ["TASK", "t"]]) {
      const source = ref(store, "PROJECT_STATE", id, { targetType });
      assert.equal(resolveMemorySource(store, source).validity, "CURRENT");
      const input = inferred(store, { type: "FACT", sourceRefs: [source] });
      promote(control, input, id);
    }
    const task = store.getTask("t"); store.putRecord("task", "t", { ...task, projectId: "other" });
    assert.equal(control.query({ projectId: "p", includeInferred: true }).some((r) => r.id === "t"), false);
  });

  run("accepted Goal/Milestone/Project reuse their own contract and live aggregate snapshot proof", ({ store, control }) => {
    for (const [targetType, id] of [["GOAL", "g"], ["MILESTONE", "ms"], ["PROJECT", "p"]]) {
      store.seedAcceptance(createAcceptance({ id: `a-${id}`, targetType, targetId: id }));
    }
    store.seedMilestone(createMilestone({ id: "ms", projectId: "p", name: "Milestone", acceptanceId: "a-ms", acceptanceVersion: 1 }));
    store.seedGoal(createGoal({ id: "g", projectId: "p", milestoneId: "ms", title: "Goal", acceptanceId: "a-g", acceptanceVersion: 1 }));
    store.updateTask("t", store.getTask("t").version, { goalId: "g" });
    store.updateProject("p", 1, { acceptanceId: "a-p", acceptanceVersion: 1 });
    for (const [targetType, id] of [["GOAL", "g"], ["MILESTONE", "ms"], ["PROJECT", "p"]]) {
      const collection = targetType.toLowerCase();
      const evidence = store.ensureAggregateEvidence(collection, id);
      const verification = createVerification({ id: `v-${id}`, targetType, targetId: id, acceptanceId: `a-${id}`, acceptanceVersion: 1, evidenceIds: [evidence.id], verdict: "PASS", revision: evidence.revision });
      store.recordVerification(verification);
      const target = store.getRecord(collection, id);
      const method = { GOAL: "acceptGoal", MILESTONE: "completeMilestone", PROJECT: "acceptProject" }[targetType];
      store[method](id, target.version, { verificationId: verification.id });
      store.putRecord("evidence", evidence.id, { ...evidence, status: "VERIFIED" });
      const input = acceptedFact(store, { sourceRefs: [ref(store, "PROJECT_STATE", id, { targetType, acceptanceId: `a-${id}`, acceptanceVersion: 1, verificationId: verification.id })] });
      promote(control, input, `memory-${id}`);
    }
    assert.equal(control.query({ projectId: "p" }).length, 3);
    // Child metadata is included in the existing aggregate snapshot hash.
    store.updateTask("t", store.getTask("t").version, { title: "changed child revision" });
    assert.equal(control.query({ projectId: "p" }).some((r) => r.id === "memory-g"), false);
  });

  run("known external invalidity and source status downgrade reconcile, unlike unavailable observations", ({ store, control }) => {
    promote(control, fact(store));
    const invalid = boundary(store, { observeReality: () => ({ status: "INVALID", reason: "trusted observer proved required artifact missing", observationRef: "observation:missing", observedAt: new Date().toISOString() }) });
    assert.equal(invalid.query({ projectId: "p" }).length, 0);
    const stale = invalid.reconcile("m", 1); assert.equal(stale.staleness.kind, "SOURCE_INVALIDATION");
    assert.match(stale.staleness.observations[0].reason, /artifact missing/);
    // Returning valid support cannot resurrect the recorded STALE identity.
    assert.equal(control.query({ projectId: "p" }).length, 0);
    assert.equal(control.history({ id: "m" })[0].status, "STALE");
    promote(control, fact(store), "downgraded");
    store.putRecord("evidence", "e", { ...store.getEvidence("e"), status: "CANDIDATE" });
    assert.equal(control.query({ projectId: "p" }).length, 0);
    assert.equal(control.reconcile("downgraded", 1).status, "STALE");
  });

  run("external reality is re-observed at promotion, independently of stored attestation", ({ store }) => {
    let revision = "rev-1";
    const control = boundary(store, { observeReality: () => ({ status: "CURRENT", revision, observationRef: "live:artifact", observedAt: new Date().toISOString() }) });
    const input = fact(store); const attestation = control.validate(input, { judgement: judgement(input) });
    revision = "rev-2"; const before = store.allEvents();
    assert.throws(() => control.promote({ id: "m", candidate: input, attestation }, { commandId: "external-promote" }), /revision changed/);
    assert.deepEqual(store.allEvents(), before); assert.equal(store.getCommand("external-promote"), null);
  });
}
