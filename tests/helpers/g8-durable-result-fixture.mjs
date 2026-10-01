import { Controller } from "../../project-control/controller.mjs";
import { createDogfoodSlice } from "./g8-dogfood-slice-1.mjs";
import { DurableLocalProcessRuntime } from "./g8-durable-local-process-runtime.mjs";
import { durableResultVerifier } from "./g8-durable-result-verifier.mjs";

export function durableLiveSlice({ store, root, isolationRoot, resultDirectory, reviewRequired = false, mode = "pass" }) {
  class ProviderRuntime extends DurableLocalProcessRuntime {
    constructor(options) { super({ ...options, resultDirectory }); }
  }
  return createDogfoodSlice({ store, root, isolationRoot, mode, runtimeClass: ProviderRuntime,
    verifierFactory: ({ verifierFacts }) => durableResultVerifier({ store, root, resultDirectory, reviewRequired, facts: verifierFacts }) });
}

export function freshResultController({ store, root, resultDirectory }) {
  const facts = [];
  class NoNewExecution extends DurableLocalProcessRuntime {
    constructor() { super({ resultDirectory }); this.startCalls = 0; }
    async start() { this.startCalls++; throw new Error("reverification must not execute Runtime"); }
  }
  const runtime = new NoNewExecution();
  const controller = new Controller({ store, runtime,
    verifier: durableResultVerifier({ store, root, resultDirectory, facts }) });
  return { controller, runtime, facts };
}
