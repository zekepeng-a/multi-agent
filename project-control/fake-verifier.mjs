import { VerificationVerdict, createVerification } from "./domain.mjs";

export class FakeVerifier {
  constructor({ verdict = VerificationVerdict.PASS } = {}) {
    this.verdict = verdict;
  }

  verify({ acceptance, evidence, task }) {
    return createVerification({
      id: `verification-${evidence.id}`,
      taskId: task.id,
      acceptanceId: acceptance.id,
      acceptanceVersion: acceptance.version,
      evidenceIds: [evidence.id],
      verdict: this.verdict,
      revision: evidence.revision,
    });
  }
}
