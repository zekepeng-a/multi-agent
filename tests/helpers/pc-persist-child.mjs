// Cross-process persistence probe used by tests/integration/persistence.test.mjs.
//
// It is deliberately NOT a *.test.mjs file: it is a plain script the test runner
// spawns as a separate OS process, so a genuine process exit happens between
// "write" and "read". That is what proves the state is durable rather than
// cached inside one long-lived store object.
//
// usage: node pc-persist-child.mjs write <dbfile>
//        node pc-persist-child.mjs read  <dbfile> <json ids from the write phase>

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PC = path.join(HERE, "..", "..", "project-control");
const load = (name) => import(pathToFileURL(path.join(PC, name)).href);

const { SqliteStore } = await load("sqlite-store.mjs");
const { Controller } = await load("controller.mjs");
const { FakeRuntime } = await load("fake-runtime.mjs");
const { FakeVerifier } = await load("fake-verifier.mjs");
const { createAcceptance, createTask, createVerification, VerificationVerdict } = await load("domain.mjs");

const [mode, file, idsJson] = process.argv.slice(2);
if (!mode || !file) {
  console.error("usage: node pc-persist-child.mjs <write|read> <dbfile> [idsJson]");
  process.exit(2);
}

function controllerFor(store) {
  let n = 0;
  return new Controller({
    store,
    runtime: new FakeRuntime({ mode: "success" }),
    verifier: new FakeVerifier({}),
    idFactory: (prefix) => `child-${prefix}-${++n}`,
  });
}

const store = new SqliteStore(file);
let payload;

try {
  if (mode === "write") {
    store.seedAcceptance(createAcceptance({
      id: "acceptance-1",
      targetId: "task-1",
      criteria: [{ id: "build", type: "BUILD", required: true }],
    }));
    store.seedTask(createTask({
      id: "task-1", title: "process-restart task", acceptanceId: "acceptance-1", acceptanceVersion: 1,
    }));

    const result = await controllerFor(store).reconcileTask("task-1");

    // revise the contract AFTER the task exists, then pin a second task to v2
    store.reviseAcceptance("acceptance-1", { criteria: [{ id: "lint", type: "LINT", required: true }] });
    store.seedTask(createTask({
      id: "task-2", title: "pinned to v2", acceptanceId: "acceptance-1", acceptanceVersion: 2,
    }));

    payload = {
      action: result.action,
      taskStatus: store.getTask("task-1").status,
      acceptanceVersion: store.getTask("task-1").acceptanceVersion,
      acceptanceV1: store.getAcceptance("acceptance-1", 1).status,
      acceptanceV2: store.getAcceptance("acceptance-1", 2).status,
      task2AcceptanceVersion: store.getTask("task-2").acceptanceVersion,
      eventCount: store.getEvents().length,
      ids: {
        runId: result.run.id,
        attemptId: result.attempt.id,
        evidenceId: result.evidence.id,
        verificationId: result.verification.id,
      },
    };
  } else if (mode === "read") {
    const ids = JSON.parse(idsJson ?? "{}");
    const evidence = store.getEvidence(ids.evidenceId);
    payload = {
      taskStatus: store.getTask("task-1").status,
      acceptanceVersion: store.getTask("task-1").acceptanceVersion,
      acceptanceV1: store.getAcceptance("acceptance-1", 1).status,
      acceptanceV2: store.getAcceptance("acceptance-1", 2).status,
      task2AcceptanceVersion: store.getTask("task-2").acceptanceVersion,
      runStatus: store.getRun(ids.runId).status,
      attemptStatus: store.getAttempt(ids.attemptId).status,
      evidenceRunId: evidence.runId,
      evidenceAttemptId: evidence.attemptId,
      verificationTaskId: store.getVerification(ids.verificationId).taskId,
      eventCount: store.getEvents().length,
      // re-prove the whole lineage from durable rows only
      reproof: store.recordVerification(createVerification({
        id: "child-verification-reproof",
        taskId: "task-1",
        acceptanceId: "acceptance-1",
        acceptanceVersion: 1,
        evidenceIds: [evidence.id],
        verdict: VerificationVerdict.PASS,
        revision: evidence.revision,
      })).verdict,
    };
  } else {
    throw new Error(`unknown mode: ${mode}`);
  }
} finally {
  store.close();
}

console.log("RESULT " + JSON.stringify(payload));
