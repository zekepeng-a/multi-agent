import { AcceptanceTargetType, VerificationVerdict, createVerification } from "./domain.mjs";

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

  /**
   * A verdict is about the TARGET of the evidence, and the evidence states what
   * it is about. A task-level verification therefore names the task, and an
   * aggregate (Goal / Milestone) verification names the aggregate and carries no
   * task at all — the store re-proves both shapes against the live records.
   */
  verify({ acceptance, evidence, task = null, target = null }) {
    this.sequence += 1;
    const targetType = evidence.targetType ?? AcceptanceTargetType.TASK;
    const taskId = targetType === AcceptanceTargetType.TASK ? (task?.id ?? target?.id) : null;
    return createVerification({
      id: `verification-${evidence.id}-${this.sequence}`,
      targetType,
      targetId: evidence.targetId ?? taskId,
      taskId,
      acceptanceId: acceptance.id,
      acceptanceVersion: acceptance.version,
      evidenceIds: [evidence.id],
      verdict: this.verdict,
      revision: evidence.revision,
    });
  }
}
