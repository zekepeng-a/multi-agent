// G8 slice-specific trusted composition. This is not a new Controller API,
// canonical Task->Command relation, permission token or restart protocol.
import path from "node:path";
import { createHash } from "node:crypto";
import { Controller } from "../../project-control/controller.mjs";
import { LocalProcessRuntimeAdapter } from "../../project-control/local-process-runtime.mjs";
import { WorkspaceManager, workspaceRevision } from "../../project-control/workspace-manager.mjs";
import { StaticPolicyEngine } from "../../project-control/policy-engine.mjs";
import { capsuleFingerprint } from "../../project-control/capsule-json.mjs";
import { CapsuleInputRefusedError } from "../../project-control/capsule-receipt.mjs";
import { createProject, createMilestone, createGoal, createTask, createAcceptance, createVerification } from "../../project-control/domain.mjs";

export const inspectedFiles = ["PROJECT_BLUEPRINT.md", "package.json"];
export const inspectionScript = `
const fs = require('node:fs'), crypto = require('node:crypto');
const files = ['PROJECT_BLUEPRINT.md', 'package.json'];
const hashes = Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
const ok = fs.readFileSync(files[0], 'utf8').includes('Project Control OS') && JSON.parse(fs.readFileSync(files[1], 'utf8')).type === 'module';
console.log(JSON.stringify({ marker: 'G8_READ_ONLY_INSPECTION_V1', cwd: process.cwd(), hashes, ok }));
if (!ok || process.argv[1] === 'fail') process.exitCode = 7;
`;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => capsuleFingerprint(a) === capsuleFingerprint(b);
const demand = (condition, message) => { if (!condition) throw new Error(message); };

export function createDogfoodSlice({ store, root, isolationRoot, mode = "pass", expectedMarker = "G8_READ_ONLY_INSPECTION_V1",
  runtimeClass = LocalProcessRuntimeAdapter, verifierFactory = null }) {
  root = path.resolve(root);
  let sequence = 0;
  const idFactory = prefix => `g8-${prefix}-${++sequence}`;
  store.seedProject(createProject({ id: "g8-project", name: "Human: inspect repository without writes" }));
  store.seedMilestone(createMilestone({ id: "g8-milestone", projectId: "g8-project", name: "Repository inspection" }));
  store.seedGoal(createGoal({ id: "g8-goal", projectId: "g8-project", milestoneId: "g8-milestone", title: "Prove repository identity and file bytes" }));
  const manager = new WorkspaceManager({ store, isolationRoot });
  const workspace = manager.createShared({ id: "g8-workspace", projectId: "g8-project", root, access: "READ_ONLY", writeScopes: [] });
  const expectedHashes = Object.fromEntries(inspectedFiles.map(file => [file, digest(manager.readFile(workspace.id, file))]));
  const processSpec = { command: process.execPath, args: ["-e", inspectionScript, mode], cwd: root };
  store.seedAcceptance(createAcceptance({ id: "g8-contract", targetId: "g8-task", criteria: [{ id: "inspection-v1", required: true,
    expectedMarker, expectedHashes, workspaceId: workspace.id, workspaceRevision: workspace.currentRevision,
    processFingerprint: capsuleFingerprint(processSpec) }] }));
  store.seedTask(createTask({ id: "g8-task", projectId: "g8-project", goalId: "g8-goal", title: "Read and hash Blueprint and package metadata", acceptanceId: "g8-contract", acceptanceVersion: 1 }));
  const initialTask = store.getTask("g8-task");
  const parameters = { task: initialTask, acceptanceId: "g8-contract", acceptanceVersion: 1,
    workspaceId: workspace.id, workspaceRevision: workspace.currentRevision, process: processSpec };
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

  class ObservedLocalProcess extends runtimeClass {
    constructor() { super({ defaultCwd: root }); this.startCalls = 0; this.inputs = []; }
    async start(input) {
      // Last trusted guard before the real adapter, no await/OS effect yet.
      try {
        authorization(input.capsuleBinding);
        demand(same(input.launchConfig, { process: processSpec }), "launch config mismatch");
        demand(workspaceRevision(root) === parameters.workspaceRevision, "Workspace reality drift");
      } catch (error) { throw new CapsuleInputRefusedError(error.message); }
      this.startCalls += 1;
      this.inputs.push(structuredClone(input));
      return super.start(input);
    }
    async collectResult(ref) {
      const result = await super.collectResult(ref);
      if (!verifierFactory) results.set(result.resultRef, structuredClone(result));
      return result;
    }
  }
  local = new ObservedLocalProcess();
  let verifier = { verify({ acceptance, evidence, task }) {
    const result = results.get(evidence.contentRef);
    const criterion = acceptance.criteria[0];
    const attempt = store.getAttempt(evidence.attemptId);
    const capsule = store.getRecord("context_capsule", attempt.capsuleDelivery.capsuleId);
    const receipt = attempt.capsuleDelivery.observations.find(observation => observation.status === "RECEIVED")?.receipt;
    let output = null;
    try { output = JSON.parse(result?.details.stdout.trim()); } catch {}
    const hash = result && digest(result.details.stdout + "\0" + result.details.stderr + "\0" + String(result.details.exitCode));
    const checks = {
      exit: result?.details.exitCode === 0 && result?.outcome === "COMPLETED" && result?.details.stderr === "",
      output: output?.marker === criterion.expectedMarker && output?.ok === true && output?.cwd === root && same(output?.hashes ?? {}, criterion.expectedHashes),
      revision: result?.revision === evidence.revision && evidence.revision === hash && workspaceRevision(root) === criterion.workspaceRevision,
      lineage: evidence.taskId === task.id && evidence.acceptanceId === task.acceptanceId && evidence.acceptanceVersion === task.acceptanceVersion &&
        result?.runtimeRef.externalId === attempt.runtimeRef.externalId && capsule?.attemptId === attempt.id && capsule?.taskId === task.id && attempt.capsuleDelivery.status === "RECEIVED",
      input: capsule?.payloadHash === receipt?.payloadHash &&
        capsuleFingerprint(local.inputs[0]?.launchConfig.process) === criterion.processFingerprint,
    };
    const verdict = Object.values(checks).every(Boolean) ? "PASS" : "FAIL";
    verifierFacts.push({ evidenceId: evidence.id, checks, verdict });
    return createVerification({ id: idFactory("verification"), taskId: task.id, acceptanceId: acceptance.id, acceptanceVersion: acceptance.version,
      evidenceIds: [evidence.id], revision: evidence.revision, verdict });
  } };
  if (verifierFactory) verifier = verifierFactory({ store, root, verifierFacts });
  const observedAt = () => new Date().toISOString();
  const controller = new Controller({ store, runtime: local, verifier, policyEngine, idFactory,
    capsuleBoundary: { controlActorId: "trusted-g8-slice-1", workspaceId: workspace.id,
      profile: { id: "g8-read-only", version: "1", assemblerVersion: "1", maxBytes: 100000 },
      observeWorkspace: ws => ({ status: "CURRENT", revision: workspaceRevision(ws.rootRef), observationRef: "filesystem:sha256-tree", observedAt: observedAt() }),
      policyContext: binding => {
        const { command, policy, approvalRequest } = authorization(binding);
        return { id: "g8-policy", version: policyEngine.version, status: "CURRENT", binding,
          restrictions: ["READ_ONLY repository inspection only", "No writes, deployment or external Effect", `Command:${command.id}`],
          provenance: { commandId: command.id, commandVersion: command.version, parametersFingerprint: capsuleFingerprint(command.parameters), configuredBy: "human-dogfood" },
          policyDecisionIds: [policy.id], approvalRequests: [approvalRequest], observationRef: "trusted-command-recheck", observedAt: observedAt() };
      },
      runtimeContext: binding => ({ id: "g8-local-input", version: "1", status: "CURRENT", binding, adapterId: local.adapterId,
        restrictions: ["Pinned Node read-only inspection process only", "No OS sandbox guarantee"], provenance: { configuredBy: "trusted-g8-slice-1" }, observationRef: "launch-profile:v1", observedAt: observedAt() }),
      verifyRequiredIntegrity: (_sources, binding) => { authorization(binding); return { complete: true, consistent: true, observationRef: "trusted-g8-slice-1:fixed-profile", reason: "Exact action, pinned contract, read-only workspace, Policy/Approval and Node inspection checked" }; },
    }, runtimeLaunchConfigFactory: ({ task, run, attempt }) => {
      authorization({ projectId: task.projectId, taskId: task.id, runId: run.id, attemptId: attempt.id });
      return { process: structuredClone(processSpec) };
    } });
  const command = controller.createCommand({ id: "g8-command", targetType: "PROJECT", targetId: "g8-project", action: "inspect.repository",
    capability: "repository.read", scope: "task:g8-task", riskLevel: "LOW", requestedBy: "human-dogfood", parameters,
    idempotencyKey: "g8:read-only:task:contract-v1" }, { mutationId: "g8:create-command" });
  activeCommandId = command.id;

  return { store, manager, controller, runtime: local, command, workspace, processSpec, parameters, results, verifierFacts,
    approve() {
      const pending = store.requestApproval({ id: "g8-approval", targetType: command.targetType, targetId: command.targetId, action: command.action,
        capability: command.capability, scope: command.scope, riskLevel: command.riskLevel, requestedBy: command.requestedBy, commandId: command.id });
      return store.decideApproval(pending.id, pending.version, { decision: "APPROVE", decidedBy: "human-dogfood" });
    },
    authorize(approvalId = "g8-approval") { return controller.authorizeCommand(command.id, store.getControlCommand(command.id).version, { approvalId }); },
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
