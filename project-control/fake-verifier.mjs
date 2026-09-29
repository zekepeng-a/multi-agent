import { VerificationVerdict, createVerification } from "./domain.mjs";

export class FakeVerifier {
  constructor({ verdict = VerificationVerdict.PASS } = {}) {
    this.verdict = verdict;
    // Every verify() call must yield a NEW Verification identity. Verifications
    // are append-only facts and the store refuses to overwrite one, so
    // re-verifying the same evidence (the NEEDS_REVIEW recovery path) cannot
    // reuse the previous id. A per-instance counter is enough here; no id
    // service or persistence change is involved.
    this.sequence = 0;
  }

  verify({ acceptance, evidence, task }) {
    this.sequence += 1;
    return createVerification({
      id: `verification-${evidence.id}-${this.sequence}`,
      taskId: task.id,
      acceptanceId: acceptance.id,
      acceptanceVersion: acceptance.version,
      evidenceIds: [evidence.id],
      verdict: this.verdict,
      revision: evidence.revision,
    });
  }
}
