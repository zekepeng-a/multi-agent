import { AttemptStatus, RunStatus, now } from "./domain.mjs";

export class FakeRuntime {
  constructor({ mode = "success", revision = "fake-revision-1" } = {}) {
    this.mode = mode;
    this.revision = revision;
    this.started = [];
  }

  async start({ run, attempt }) {
    this.started.push({ runId: run.id, attemptId: attempt.id });
    if (this.mode === "lost") {
      return { status: AttemptStatus.LOST, resultRef: null, revision: this.revision };
    }
    if (this.mode === "fail") {
      return { status: AttemptStatus.FAILED, resultRef: "artifact://fake/failure", revision: this.revision };
    }
    return {
      status: AttemptStatus.COMPLETED,
      resultRef: "artifact://fake/success",
      revision: this.revision,
      completedAt: now(),
    };
  }
}
