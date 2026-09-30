// Durable Project Decision G7.2 contract.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Collection } from "../../project-control/store.mjs";
import { MemoryStore } from "../../project-control/memory-store.mjs";
import {
  SqliteStore,
  isSqliteAvailable,
  SQLITE_REQUIREMENT,
} from "../../project-control/sqlite-store.mjs";
import {
  ConflictError,
  DecisionAuthorityType,
  DecisionSourceType,
  DecisionStatus,
  InvariantError,
  createProject,
} from "../../project-control/domain.mjs";

const BACKENDS = [
  { name: "MemoryStore", skip: false, make() { return new MemoryStore(); } },
  {
    name: "SqliteStore",
    skip: isSqliteAvailable() ? false : `node:sqlite is unavailable: ${SQLITE_REQUIREMENT}`,
    make(t) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-decision-"));
      const store = new SqliteStore(path.join(dir, "project-control.db"));
      t.after(() => {
        try { store.close(); } catch {}
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      });
      return store;
    },
  },
];

function seed(store) {
  store.seedProject(createProject({ id: "project-1", name: "Decision project" }));
}

function humanDecision(over = {}) {
  return {
    id: "decision-1",
    projectId: "project-1",
    title: "Choose release direction",
    rationale: "The human selected the conservative release path.",
    alternatives: [
      { description: "Ship experimental path", rejectedReason: "Too much release risk" },
    ],
    decidedBy: { type: DecisionAuthorityType.HUMAN, actorId: "human-1" },
    sourceRefs: [{ type: DecisionSourceType.HUMAN_INSTRUCTION, id: "instruction-1" }],
    ...over,
  };
}

function controlDecision(over = {}) {
  return {
    id: "decision-control-1",
    projectId: "project-1",
    title: "Derived control route",
    rationale: "Current accepted project state requires the bounded route.",
    alternatives: [],
    decidedBy: { type: DecisionAuthorityType.CONTROL_PLANE, actorId: "controller-1" },
    sourceRefs: [{ type: DecisionSourceType.PROJECT_STATE, id: "project-1", revision: "v1" }],
    ...over,
  };
}

for (const backend of BACKENDS) {
  const label = (name) => `${backend.name}: ${name}`;

  test(label("runtime/model authority cannot create a Decision and provenance is mandatory"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seed(store);

    assert.throws(
      () => store.createProjectDecision(humanDecision({
        decidedBy: { type: "MODEL", actorId: "gpt" },
      })),
      /HUMAN or CONTROL_PLANE/,
    );
    assert.throws(
      () => store.createProjectDecision(humanDecision({ sourceRefs: [] })),
      /non-empty sourceRefs/,
    );
    assert.throws(
      () => store.createProjectDecision(humanDecision({
        sourceRefs: [{ type: DecisionSourceType.EXTERNAL_REFERENCE, id: "chat-summary" }],
      })),
      /HUMAN_INSTRUCTION provenance/,
    );
    assert.equal(store.allRecords(Collection.DECISION).length, 0);
  });

  test(label("CONTROL_PLANE Decision requires authoritative provenance"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seed(store);

    assert.throws(
      () => store.createProjectDecision(controlDecision({
        sourceRefs: [{ type: DecisionSourceType.EXTERNAL_REFERENCE, id: "model-proposal-1" }],
      })),
      /authoritative control\/evidence provenance/,
    );

    const created = store.createProjectDecision(controlDecision());
    assert.equal(created.status, DecisionStatus.ACTIVE);
    assert.equal(created.decidedBy.type, DecisionAuthorityType.CONTROL_PLANE);
  });

  test(label("HUMAN Decision cannot be superseded or revoked by CONTROL_PLANE"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seed(store);
    const original = store.createProjectDecision(humanDecision());

    assert.throws(
      () => store.supersedeDecision(original.id, original.version, controlDecision({ id: "decision-2" })),
      (error) => error instanceof InvariantError && /cannot supersede a HUMAN Decision/.test(error.message),
    );
    assert.throws(
      () => store.revokeDecision(original.id, original.version, {
        revokedBy: { type: DecisionAuthorityType.CONTROL_PLANE, actorId: "controller-1" },
        reason: "derived reconsideration",
      }),
      (error) => error instanceof InvariantError && /cannot revoke a HUMAN Decision/.test(error.message),
    );
    assert.equal(store.getDecision(original.id).status, DecisionStatus.ACTIVE);
  });

  test(label("supersession creates new identity and preserves old meaning/lineage"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seed(store);
    const original = store.createProjectDecision(humanDecision(), { commandId: "create-d1" });

    const replacementInput = humanDecision({
      id: "decision-2",
      title: "Choose revised release direction",
      rationale: "The human selected a staged release after new evidence.",
      sourceRefs: [{ type: DecisionSourceType.HUMAN_INSTRUCTION, id: "instruction-2" }],
    });
    const replacement = store.supersedeDecision(original.id, original.version, replacementInput, {
      commandId: "supersede-d1",
    });

    assert.equal(replacement.id, "decision-2");
    assert.equal(replacement.status, DecisionStatus.ACTIVE);
    assert.equal(replacement.supersedesDecisionId, original.id);

    const historical = store.getDecision(original.id);
    assert.equal(historical.status, DecisionStatus.SUPERSEDED);
    assert.equal(historical.supersededByDecisionId, replacement.id);
    assert.equal(historical.title, "Choose release direction");
    assert.equal(historical.rationale, "The human selected the conservative release path.");
    assert.equal(historical.version, 2);

    assert.deepEqual(store.getActiveDecisionsForProject("project-1").map((d) => d.id), ["decision-2"]);
    assert.equal(store.getEvents().filter((e) => e.type === "decision.created").length, 2);
    assert.equal(store.getEvents().filter((e) => e.type === "decision.superseded").length, 1);

    const replay = store.supersedeDecision(original.id, original.version, replacementInput, {
      commandId: "supersede-d1",
    });
    assert.equal(replay.id, replacement.id);
    assert.equal(store.getEvents().filter((e) => e.type === "decision.superseded").length, 1);
  });

  test(label("HUMAN may supersede CONTROL_PLANE and CONTROL_PLANE may replace its own derived Decision"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seed(store);

    const control = store.createProjectDecision(controlDecision());
    const controlReplacement = store.supersedeDecision(control.id, control.version, controlDecision({
      id: "decision-control-2",
      title: "Updated derived control route",
      rationale: "The authoritative project state changed.",
      sourceRefs: [{ type: DecisionSourceType.PROJECT_STATE, id: "project-1", revision: "v2" }],
    }));
    assert.equal(controlReplacement.status, DecisionStatus.ACTIVE);

    const humanReplacement = store.supersedeDecision(
      controlReplacement.id,
      controlReplacement.version,
      humanDecision({
        id: "decision-human-final",
        title: "Human overrides derived route",
        rationale: "The human selected a different product direction.",
        sourceRefs: [{ type: DecisionSourceType.HUMAN_INSTRUCTION, id: "instruction-final" }],
      }),
    );
    assert.equal(humanReplacement.decidedBy.type, DecisionAuthorityType.HUMAN);
    assert.deepEqual(store.getActiveDecisionsForProject("project-1").map((d) => d.id), ["decision-human-final"]);
  });

  test(label("revocation is attributable, reasoned and terminal"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seed(store);
    const decision = store.createProjectDecision(humanDecision());

    const revoked = store.revokeDecision(decision.id, decision.version, {
      revokedBy: { type: DecisionAuthorityType.HUMAN, actorId: "human-1" },
      reason: "Direction withdrawn",
    }, { commandId: "revoke-d1" });

    assert.equal(revoked.status, DecisionStatus.REVOKED);
    assert.equal(revoked.revocation.revokedBy.actorId, "human-1");
    assert.equal(revoked.revocation.reason, "Direction withdrawn");
    assert.deepEqual(store.getActiveDecisionsForProject("project-1"), []);

    assert.throws(
      () => store.revokeDecision(decision.id, revoked.version, {
        revokedBy: { type: DecisionAuthorityType.HUMAN, actorId: "human-1" },
        reason: "again",
      }),
      /cannot be revoked/,
    );
    assert.throws(
      () => store.supersedeDecision(decision.id, revoked.version, humanDecision({ id: "decision-2" })),
      /cannot be superseded/,
    );

    const replay = store.revokeDecision(decision.id, decision.version, {
      revokedBy: { type: DecisionAuthorityType.HUMAN, actorId: "human-1" },
      reason: "Direction withdrawn",
    }, { commandId: "revoke-d1" });
    assert.equal(replay.status, DecisionStatus.REVOKED);
    assert.equal(store.getEvents().filter((e) => e.type === "decision.revoked").length, 1);
  });

  test(label("stale lifecycle version conflicts and no generic meaning-update API exists"), { skip: backend.skip }, (t) => {
    const store = backend.make(t);
    seed(store);
    const decision = store.createProjectDecision(humanDecision());
    assert.equal(typeof store.updateDecision, "undefined");

    const revoked = store.revokeDecision(decision.id, 1, {
      revokedBy: { type: DecisionAuthorityType.HUMAN, actorId: "human-1" },
      reason: "withdrawn",
    });
    assert.equal(revoked.version, 2);

    assert.throws(
      () => store.revokeDecision(decision.id, 1, {
        revokedBy: { type: DecisionAuthorityType.HUMAN, actorId: "human-1" },
        reason: "stale",
      }),
      (error) => error instanceof ConflictError || /cannot be revoked/.test(error.message),
    );
  });
}

test("SQLite restart preserves Decision lineage, status and provenance", {
  skip: isSqliteAvailable() ? false : `node:sqlite is unavailable: ${SQLITE_REQUIREMENT}`,
}, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pc-decision-restart-"));
  const file = path.join(dir, "project-control.db");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

  let store = new SqliteStore(file);
  seed(store);
  const original = store.createProjectDecision(humanDecision());
  store.supersedeDecision(original.id, original.version, humanDecision({
    id: "decision-2",
    title: "Replacement",
    rationale: "Updated human direction.",
    sourceRefs: [{ type: DecisionSourceType.HUMAN_INSTRUCTION, id: "instruction-2" }],
  }));
  store.close();

  store = new SqliteStore(file);
  const old = store.getDecision("decision-1");
  const current = store.getDecision("decision-2");
  assert.equal(old.status, DecisionStatus.SUPERSEDED);
  assert.equal(old.supersededByDecisionId, current.id);
  assert.equal(current.status, DecisionStatus.ACTIVE);
  assert.equal(current.supersedesDecisionId, old.id);
  assert.deepEqual(current.sourceRefs, [{ type: DecisionSourceType.HUMAN_INSTRUCTION, id: "instruction-2" }]);
  assert.deepEqual(store.getActiveDecisionsForProject("project-1").map((d) => d.id), ["decision-2"]);
  store.close();
});
