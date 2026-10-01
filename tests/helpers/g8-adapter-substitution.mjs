// G8 Slice 4 test-only trusted composition; injected DSH is not a live host. This is not a new Controller API,
// canonical Task->Command relation, permission token or restart protocol.
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { Controller } from "../../project-control/controller.mjs";
import { DshWorkflowRuntimeAdapter } from "../../project-control/dsh-workflow-runtime.mjs";
import { substitutionVerifier, observeSemanticFiles } from "./g8-substitution-verifier.mjs";
import { LocalProcessRuntimeAdapter } from "../../project-control/local-process-runtime.mjs";
import { WorkspaceManager, workspaceRevision } from "../../project-control/workspace-manager.mjs";
import { StaticPolicyEngine } from "../../project-control/policy-engine.mjs";
import { capsuleFingerprint } from "../../project-control/capsule-json.mjs";
import { CapsuleInputRefusedError } from "../../project-control/capsule-receipt.mjs";
import { createProject, createMilestone, createGoal, createTask, createAcceptance } from "../../project-control/domain.mjs";

export const inspectedFiles = ["PROJECT_BLUEPRINT.md", "package.json"];
const workspaceModule = new URL("../../project-control/workspace-manager.mjs", import.meta.url).href;
export const inspectionScript = `(async () => {
const fs = require('node:fs'), crypto = require('node:crypto');
const { workspaceRevision } = await import(${JSON.stringify(workspaceModule)});
const hashes = Object.fromEntries(['PROJECT_BLUEPRINT.md','package.json'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const ok = fs.readFileSync('PROJECT_BLUEPRINT.md','utf8').includes('Project Control OS') && JSON.parse(fs.readFileSync('package.json','utf8')).type === 'module';
console.log(JSON.stringify({ marker:'G8_SUBSTITUTION_V1', cwd:process.cwd(), hashes, ok:process.argv[1] === 'wrong' ? false : ok, workspaceRevision:workspaceRevision(process.cwd()) }));
if (process.argv[1] === 'fail') process.exitCode=7;
})().catch(e => { console.error(e); process.exitCode=7; });`;
export const workflowScript = `
const fs = await import('node:fs'), crypto = await import('node:crypto'), path = await import('node:path');
const { workspaceRevision } = await import(${JSON.stringify(workspaceModule)});
const hashes = Object.fromEntries(['PROJECT_BLUEPRINT.md','package.json'].map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(args.root, f))).digest('hex')]));
return { marker:'G8_SUBSTITUTION_V1', cwd:args.root, hashes, workspaceRevision:workspaceRevision(args.root),
ok:fs.readFileSync(path.join(args.root,'PROJECT_BLUEPRINT.md'),'utf8').includes('Project Control OS') && JSON.parse(fs.readFileSync(path.join(args.root,'package.json'),'utf8')).type === 'module' };
`;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => capsuleFingerprint(a) === capsuleFingerprint(b);
const demand = (condition, message) => { if (!condition) throw new Error(message); };

export function createSubstitutionSlice({ store, root, isolationRoot, kind, mode = "pass", receiptFault = false, launchFault = null }) {
  root = path.resolve(root);
  const fixtureTag = kind;
  const parent = { id: "test-parent", liveHandle() {} };
  const engine = injectedWorkflowEngine({ root, mode });
  let sequence = 0;
  const idFactory = prefix => `${fixtureTag}-${prefix}-${++sequence}`;
  store.seedProject(createProject({ id: "g8-project", name: "Human: inspect repository without writes" }));
  store.seedMilestone(createMilestone({ id: "g8-milestone", projectId: "g8-project", name: "Repository inspection" }));
  store.seedGoal(createGoal({ id: "g8-goal", projectId: "g8-project", milestoneId: "g8-milestone", title: "Prove repository identity and file bytes" }));
  const manager = new WorkspaceManager({ store, isolationRoot });
  const workspace = manager.createShared({ id: "g8-workspace", projectId: "g8-project", root, access: "READ_ONLY", writeScopes: [] });
  const expectedHashes = Object.fromEntries(inspectedFiles.map(file => [file, digest(manager.readFile(workspace.id, file))]));
  const processSpec = { command: process.execPath, args: ["-e", inspectionScript, mode], cwd: root };
  store.seedAcceptance(createAcceptance({ id: "g8-contract", targetId: "g8-task", criteria: [{ id: "inspection-v1", required: true,
    expectedMarker: "G8_SUBSTITUTION_V1", expectedHashes, workspaceId: workspace.id, workspaceRevision: workspace.currentRevision,
    semanticsVersion: "1" }] }));
  store.seedTask(createTask({ id: "g8-task", projectId: "g8-project", goalId: "g8-goal", title: "Read and hash Blueprint and package metadata", acceptanceId: "g8-contract", acceptanceVersion: 1 }));
  const initialTask = store.getTask("g8-task");
  const workflowSpec = { script: workflowScript, meta: { name: "inspection", description: "Read-only project inspection" }, args: { root, mode }, maxTotalAgents: 1 };
  const launchIntent = kind === "local" ? { process: processSpec } : { dshWorkflow: workflowSpec };
  const parameters = { task: initialTask, acceptanceId: "g8-contract", acceptanceVersion: 1,
    workspaceId: workspace.id, workspaceRevision: workspace.currentRevision, launchIntent };
  const policyEngine = new StaticPolicyEngine({ version: "g8-read-only-v1", rules: [{ id: "human-inspection", effect: "REQUIRE_APPROVAL",
    subjectId: "human-dogfood", targetType: "PROJECT", action: "inspect.repository", capability: "repository.read", scope: "task:g8-task", riskLevel: "LOW" }] });
  const results = new Map();
  const verifierFacts = [];
  let activeCommandId = null;
  let activeCommand = null;
  let local;

  // Re-check the stored concrete action; AUTHORIZED alone is not a permanent
  // permission. Project target keeps its real revision through Task bookkeeping.
  function authorization(binding = null) {
    const command = store.getControlCommand(activeCommandId);
    demand(command.status === "AUTHORIZED", "Command is not AUTHORIZED");
    demand(command.projectId === initialTask.projectId && command.targetType === "PROJECT" && command.targetId === initialTask.projectId, "wrong project/target");
    demand(command.targetVersion === store.getProject(initialTask.projectId).version, "stale authorization target");
    demand(command.action === "inspect.repository" && command.capability === "repository.read" && command.scope === "task:g8-task" && same(command.parameters, parameters), "wrong concrete action/parameters");
    if (activeCommand) demand(same(command, activeCommand), "authorized Command changed");
    const task = store.getTask(initialTask.id);
    // Only the existing READY -> IN_PROGRESS bookkeeping is admitted. This is
    // a bounded synchronous invocation, not authorization of arbitrary updates.
    const expected = binding ? { ...initialTask, status: "IN_PROGRESS", currentRunId: binding.runId,
      version: initialTask.version + 1, updatedAt: task.updatedAt } : initialTask;
    demand(same(task, expected), "stale Task/action binding");
    if (binding) demand(binding.projectId === task.projectId && binding.taskId === task.id, "wrong execution binding");
    const target = store.getControlCommandTarget(command.id);
    const currentPolicy = policyEngine.evaluate({ command, target, context: {} });
    const policy = store.getPolicyDecision(command.authorization.policyDecisionId);
    demand(policy.commandId === command.id && policy.commandVersion === command.version - 1 && policy.targetVersion === command.targetVersion &&
      policy.policyVersion === currentPolicy.policyVersion && policy.effect === currentPolicy.effect && policy.effect === "REQUIRE_APPROVAL", "stale policy authorization");
    const approvalRequest = { approvalId: command.authorization.approvalId, targetType: command.targetType, targetId: command.targetId,
      targetVersion: command.targetVersion, action: command.action, capability: command.capability, scope: command.scope, commandId: command.id };
    store.assertApprovalUsable(approvalRequest);
    const ws = store.getWorkspace(workspace.id);
    demand(ws.projectId === task.projectId && ws.access === "READ_ONLY" && ws.status === "ACTIVE" && ws.writeScopes.length === 0 &&
      path.resolve(ws.rootRef) === root && ws.currentRevision === parameters.workspaceRevision, "Workspace binding mismatch");
    return { command, policy, approvalRequest, ws };
  }

  const Base = kind === "local" ? LocalProcessRuntimeAdapter : DshWorkflowRuntimeAdapter;
  class ObservedRuntime extends Base {
    constructor() { super(kind === "local" ? { defaultCwd: root } : { workflowEngine: engine }); this.startCalls = 0; this.inputs = []; }
    async start(input) {
      // Last trusted guard before the real adapter, no await/OS effect yet.
      try {
        authorization(input.capsuleBinding);
        const config = input.launchConfig;
        if (kind === "local") demand(same(config, launchIntent), "process launch binding mismatch");
        else {
          demand(config.dshWorkflow?.parent === parent, "parent launch binding mismatch");
          const { parent: ignored, ...serial } = config.dshWorkflow;
          demand(same({ dshWorkflow: serial }, launchIntent), "workflow script/meta launch binding mismatch");
        }
        demand(workspaceRevision(root) === parameters.workspaceRevision, "Workspace reality drift");
      } catch (error) { throw new CapsuleInputRefusedError(error.message); }
      this.startCalls += 1;
      this.inputs.push({ contextCapsule: structuredClone(input.contextCapsule), capsuleBinding: structuredClone(input.capsuleBinding) });
      const started = await super.start(input);
      if (kind === "local") {
        const child = this.executions.get(started.runtimeRef.externalId).child;
        const deadline = setTimeout(() => child.kill("SIGKILL"), 5000);
        child.once("close", () => clearTimeout(deadline));
      }
      if (receiptFault) started.capsuleReceipt.payloadHash = "wrong";
      return started;
    }
    async collectResult(ref) {
      const result = await super.collectResult(ref);
      results.set(result.resultRef, structuredClone(result));
      return result;
    }
  }
  local = new ObservedRuntime();
  const verifier = substitutionVerifier({ store, root, results, facts: verifierFacts });
  const observedAt = () => new Date().toISOString();
  const controller = new Controller({ store, runtime: local, verifier, policyEngine, idFactory,
    capsuleBoundary: { controlActorId: "trusted-g8-slice-4", workspaceId: workspace.id,
      profile: { id: "g8-read-only", version: "1", assemblerVersion: "1", maxBytes: 100000 },
      observeWorkspace: ws => ({ status: "CURRENT", revision: workspaceRevision(ws.rootRef), observationRef: "filesystem:sha256-tree", observedAt: observedAt() }),
      policyContext: binding => {
        const { command, policy, approvalRequest } = authorization(binding);
        return { id: "g8-policy", version: policyEngine.version, status: "CURRENT", binding,
          restrictions: ["READ_ONLY repository inspection only", "No writes, deployment or external Effect", `Command:${command.id}`],
          provenance: { commandId: command.id, commandVersion: command.version, parametersFingerprint: capsuleFingerprint(command.parameters), configuredBy: "human-dogfood" },
          policyDecisionIds: [policy.id], approvalRequests: [approvalRequest], observationRef: "trusted-command-recheck", observedAt: observedAt() };
      },
      runtimeContext: binding => ({ id: "g8-substitution-input", version: "1", status: "CURRENT", binding, adapterId: local.adapterId,
        restrictions: ["Pinned READ_ONLY inspection launch only", "No OS sandbox guarantee"], provenance: { configuredBy: "trusted-g8-slice-4" }, observationRef: "launch-profile:v1", observedAt: observedAt() }),
      verifyRequiredIntegrity: (_sources, binding) => { authorization(binding); return { complete: true, consistent: true, observationRef: "trusted-g8-slice-1:fixed-profile", reason: "Exact action, pinned contract, read-only workspace, Policy/Approval and Node inspection checked" }; },
    }, runtimeLaunchConfigFactory: ({ task, run, attempt }) => {
      authorization({ projectId: task.projectId, taskId: task.id, runId: run.id, attemptId: attempt.id });
      const config = kind === "local" ? structuredClone(launchIntent) : { dshWorkflow: { ...structuredClone(workflowSpec), parent } };
      if (launchFault === "process") config.process.args = ["-e", "process.exit(0)"];
      if (launchFault === "script") config.dshWorkflow.script = "other-action";
      if (launchFault === "meta") config.dshWorkflow.meta.name = "other";
      if (launchFault === "parent") config.dshWorkflow.parent = { id: "other-parent" };
      return config;
    } });
  const command = controller.createCommand({ id: `${fixtureTag}-command`, targetType: "PROJECT", targetId: "g8-project", action: "inspect.repository",
    capability: "repository.read", scope: "task:g8-task", riskLevel: "LOW", requestedBy: "human-dogfood", parameters,
    idempotencyKey: "g8:read-only:task:contract-v1" }, { mutationId: "g8:create-command" });
  activeCommandId = command.id;

  return { store, manager, controller, runtime: local, command, workspace, processSpec, parameters, results, verifierFacts, engine, parent, launchIntent,
    approve() {
      const pending = store.requestApproval({ id: `${fixtureTag}-approval`, targetType: command.targetType, targetId: command.targetId, action: command.action,
        capability: command.capability, scope: command.scope, riskLevel: command.riskLevel, requestedBy: command.requestedBy, commandId: command.id });
      return store.decideApproval(pending.id, pending.version, { decision: "APPROVE", decidedBy: "human-dogfood" });
    },
    authorize(approvalId = `${fixtureTag}-approval`) { return controller.authorizeCommand(command.id, store.getControlCommand(command.id).version, { approvalId }); },
    async execute(commandId = command.id) {
      demand(commandId === command.id, "wrong Command selection");
      // Current terminal/uncertain execution is never another permission to
      // start. This slice does not perform recovery, re-verification or retry.
      if (store.getTask(initialTask.id).currentRunId) return { action: "NOOP", reason: "slice-already-invoked" };
      authorization();
      activeCommand = store.getControlCommand(commandId);
      const outcome = await controller.reconcileTask(initialTask.id);
      if (outcome.action === "ACCEPT") await controller.reconcileProject(initialTask.projectId);
      return outcome;
    },
  };
}

// Faithful public WorkflowRun seam. It observes real files; no host/model runs.
function injectedWorkflowEngine({ root, mode }) {
  const engine = { calls: [], disposed: 0, cancelled: 0, start(request) {
    engine.calls.push(request);
    let resolve;
    const result = new Promise(r => { resolve = r; });
    let done = false;
    const settle = value => { if (!done) { done = true; resolve(value); } };
    const live = { id: "workflow-" + randomUUID(), result,
      cancel() { engine.cancelled++; settle({ stopReason: "cancelled", value: null, agentsStarted: 0 }); },
      async dispose() { engine.disposed++; } };
    queueMicrotask(() => {
      if (mode === "cancel") return; // Wait for production Adapter.cancel().
      try {
        if (request.script !== workflowScript || request.args.root !== root) throw new Error("unexpected workflow request");
        const value = observeSemanticFiles(request.args.root);
        if (mode === "wrong") value.ok = false;
        settle({ stopReason: mode === "fail" ? "error" : "completed", value: mode === "fail" ? null : value, error: mode === "fail" ? "workflow failed" : undefined, agentsStarted: 1 });
      } catch (error) { settle({ stopReason: "error", value: null, error: error.message, agentsStarted: 0 }); }
    });
    return live;
  } };
  return engine;
}
