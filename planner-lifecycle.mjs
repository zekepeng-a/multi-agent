// planner-lifecycle.mjs —— Planner Artifact Lifecycle（R1）+ Artifact Identity（R3）
//
// 定位：**Planner 领域逻辑的唯一 owner**。通用文件等待由 ./file-wait.mjs 提供，本模块不再把领域
// 语义藏进通用工具的参数里。
//
// 生命周期（显式、单一入口）：
//     DRAFT(.tmp)  →  VALIDATED(领域校验通过)  →  FINALIZED(done 标记 / stability_fallback)
//       →  PUBLISHED(final + 身份注入)  →  ACCEPTED(Runtime 消费)
//   契约：FINALIZED ≠ ACCEPTED —— 只有发布成功、且身份校验一致的 artifact 才能成为 Runtime 输入。
//
// 身份（R3）：planId / parentPlanId / rootPlanId / planDigest，写入 final artifact、tasks.json.plan、
// _memory-attribution.json 与 runs/*.json，并由 verifyArtifactIdentity() 机械校验（不静默接受不一致）。
import fs from "node:fs";
import crypto from "node:crypto";
import { waitForStableJson, readJsonStrict, publishFile, sleep } from "./file-wait.mjs";

// ── 生命周期阶段 ─────────────────────────────────────────────────────────────
export const PLANNER_PHASE = Object.freeze({
  DRAFT: "DRAFT",
  VALIDATED: "VALIDATED",
  FINALIZED: "FINALIZED",
  PUBLISHED: "PUBLISHED",
  ACCEPTED: "ACCEPTED",
});

/** 产物形态（**显式传入**，不再靠 Array.isArray 猜测阶段） */
export const ARTIFACT_KIND = Object.freeze({
  STAGE1: "stage1",   // 专家判断：{ goal_understanding, expert_consultations }
  STAGE2: "stage2",   // 计划：{ plan, tasks }
  REPLAN: "replan",   // 局部重规划：数组 或 { tasks }
});

/** finalization 模式：marker 为正常路径，stability_fallback 为**降级**路径（不得混同） */
export const FINALIZATION_MODE = Object.freeze({ MARKER: "marker", STABILITY_FALLBACK: "stability_fallback" });

/** 身份字段（canonical 计算时需剔除） */
export const IDENTITY_KEYS = Object.freeze(["planId", "planDigest", "parentPlanId", "rootPlanId", "finalizationMode"]);

// ── 任务规范化（Bug #5：LLM 占位符/非法元素） ─────────────────────────────────
/**
 * 规范化 Planner/Replan 输出的任务数组。
 * 仅保留形如 {id: "<非空字符串>", ...} 的对象；其余记为 dropped。
 */
export function normalizePlannedTasks(parsed) {
  const raw = parsed && Array.isArray(parsed.tasks) ? parsed.tasks : (Array.isArray(parsed) ? parsed : []);
  const tasks = raw.filter((t) => t && typeof t === "object" && !Array.isArray(t) && typeof t.id === "string" && t.id.trim());
  return { tasks, dropped: raw.length - tasks.length, total: raw.length };
}

// ── 占位符检测（Bug #10：未填充骨架） ───────────────────────────────────────
const PLACEHOLDER_RE = /^(?:@[\w]{1,12}@|__[A-Za-z0-9_]{1,24}__|\{\{[\w\s-]{1,24}\}\}|<[A-Za-z0-9_\-\s]{1,24}>|\.\.\.|…)$/;
export const isPlaceholder = (v) => typeof v === "string" && PLACEHOLDER_RE.test(v.trim());

function scanPlaceholder(node, depth = 0) {
  if (depth > 6 || node == null) return false;
  if (typeof node === "string") return isPlaceholder(node);
  if (Array.isArray(node)) return node.some((x) => scanPlaceholder(x, depth + 1));
  if (typeof node === "object") return Object.values(node).some((x) => scanPlaceholder(x, depth + 1));
  return false;
}

// ── 阶段专属领域校验（§8：显式 kind，不用隐式猜测） ──────────────────────────
/**
 * 校验 Planner 产物是否达到可 finalize 的完整度。
 * @param {"stage1"|"stage2"|"replan"} kind
 * @param {object|Array} parsed
 * @returns {{ok:boolean, errors:Array<{code:string,detail?:string}>}}
 */
export function validatePlannerArtifact(kind, parsed) {
  const errors = [];
  if (!Object.values(ARTIFACT_KIND).includes(kind)) return { ok: false, errors: [{ code: "unknown_kind", detail: String(kind) }] };
  if (!parsed) return { ok: false, errors: [{ code: "empty_output" }] };

  if (kind === ARTIFACT_KIND.STAGE1) {
    if (typeof parsed !== "object" || Array.isArray(parsed)) errors.push({ code: "stage1_not_object" });
    else if (!(Array.isArray(parsed.expert_consultations) || (typeof parsed.goal_understanding === "string" && parsed.goal_understanding.trim()))) {
      errors.push({ code: "stage1_incomplete", detail: "需要 goal_understanding 或 expert_consultations" });
    }
    return { ok: errors.length === 0, errors };
  }

  // stage2 / replan：任务形态
  const root = Array.isArray(parsed) ? { tasks: parsed } : parsed;
  if (typeof root !== "object") errors.push({ code: "not_object_or_array" });
  const norm = normalizePlannedTasks(root);
  if (norm.tasks.length === 0) errors.push({ code: "no_valid_tasks", detail: `raw=${norm.total} dropped=${norm.dropped}` });
  if (kind === ARTIFACT_KIND.STAGE2) {
    if (root.plan !== undefined && (typeof root.plan !== "object" || Array.isArray(root.plan))) errors.push({ code: "plan_not_object" });
    const plan = root.plan || {};
    if (plan.architecture_decisions !== undefined && !Array.isArray(plan.architecture_decisions)) errors.push({ code: "decisions_not_array" });
    if (plan.memory_refs !== undefined && !Array.isArray(plan.memory_refs)) errors.push({ code: "memory_refs_not_array" });
  }
  for (const t of norm.tasks) {
    if (isPlaceholder(t.id) || isPlaceholder(String(t.title || ""))) { errors.push({ code: "placeholder_task_field", detail: String(t.id).slice(0, 40) }); break; }
  }
  // 只扫描「plan 全部字段 + normalize 后的合法任务」（tasks 里会被丢弃的非法元素不属"骨架未填"）
  if (scanPlaceholder({ plan: (root.plan && typeof root.plan === "object") ? root.plan : {}, tasks: norm.tasks })) {
    errors.push({ code: "placeholder_content", detail: "存在未填充的占位符" });
  }
  return { ok: errors.length === 0, errors };
}

// ── 兼容性谓词（既有测试与调用方的契约保持不变） ─────────────────────────────
/** 语义非空（Bug #7）：tasks 存在 + 非空 + normalize 后有合法任务 */
export function semanticPlannerOutputComplete(parsed) {
  if (!parsed) return false;
  const raw = Array.isArray(parsed) ? parsed : parsed.tasks;
  if (!Array.isArray(raw) || raw.length === 0) return false;
  return normalizePlannedTasks(parsed).tasks.length > 0;
}

/** 形状完整（Bug #10）：语义非空 + 无占位符 + 类型正确 */
export function plannerOutputShapeComplete(parsed) {
  if (!parsed) return false;
  const root = Array.isArray(parsed) ? { tasks: parsed } : parsed;
  const kind = Array.isArray(parsed) || Array.isArray(root.tasks) ? ARTIFACT_KIND.STAGE2 : ARTIFACT_KIND.STAGE1;
  return validatePlannerArtifact(Array.isArray(parsed) ? ARTIFACT_KIND.REPLAN : kind, root).ok;
}

/** 阶段1 完整性（goal_understanding 或 expert_consultations） */
export function semanticConsultationsComplete(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  if (Array.isArray(parsed.expert_consultations)) return true;
  return typeof parsed.goal_understanding === "string" && parsed.goal_understanding.trim().length > 0;
}

// ── R3：Plan Identity ───────────────────────────────────────────────────────
/**
 * 生成 planId：**不依赖 task.id**，由"形态 + 计划序号 + 随机 nonce"构成，保证
 * 「同一 Plan 相同、新 Plan/Replan 不同」。
 * @param {{kind:string, seq:number, nonce?:string}} opts
 */
export function buildPlanId({ kind, seq, nonce } = {}) {
  const n = (nonce || crypto.randomBytes(3).toString("hex")).slice(0, 6);
  const k = String(kind || "plan").replace(/[^a-z0-9]/gi, "");
  return `plan-${k}-${String(Number(seq) || 1).padStart(3, "0")}-${n}`;
}

/** 递归键排序，保证 canonical 序列化与字段顺序无关（§16） */
function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeysDeep(v[k]);
    return out;
  }
  return v;
}

/**
 * 规范化 Planner artifact 的**语义内容**（剔除身份/模式等非语义字段）。
 * digest 只表示"这份 Plan 本身的内容"（§15）。
 */
export function canonicalizePlannerArtifact(artifact) {
  const a = (artifact && typeof artifact === "object" && !Array.isArray(artifact)) ? artifact : {};
  const { plan, tasks, planDigest, ...rest } = a;   // planDigest 为非语义字段，剔除
  const cleanPlan = (plan && typeof plan === "object" && !Array.isArray(plan)) ? { ...plan } : {};
  for (const k of IDENTITY_KEYS) delete cleanPlan[k];
  const norm = normalizePlannedTasks(a);
  return JSON.stringify({
    rest: sortKeysDeep(rest),                                  // stage1 的 goal_understanding / expert_consultations 等
    plan: sortKeysDeep(cleanPlan),
    tasks: sortKeysDeep(norm.tasks),
  });
}

/** 内容指纹（确定性：同内容同 digest；§16 不引入外部依赖） */
export function computePlanDigest(artifact) {
  const h = crypto.createHash("sha256").update(canonicalizePlannerArtifact(artifact), "utf-8").digest("hex");
  return `sha256:${h.slice(0, 32)}`;
}

/**
 * 注入身份到 artifact（final 发布前调用）。identity 写入 `plan.*`，
 * 与 tasks.json.plan 同源，不复制计划数据到其它文件（§18）。
 */
export function attachPlanIdentity(artifact, { planId, parentPlanId = null, rootPlanId = null, finalizationMode = FINALIZATION_MODE.MARKER, acceptedAt = null } = {}) {
  const out = Array.isArray(artifact) ? { tasks: artifact } : { ...(artifact || {}) };
  const plan = (out.plan && typeof out.plan === "object" && !Array.isArray(out.plan)) ? { ...out.plan } : {};
  plan.planId = planId;
  plan.parentPlanId = parentPlanId || null;
  plan.rootPlanId = rootPlanId || planId;
  plan.finalizationMode = finalizationMode;
  if (acceptedAt) plan.acceptedAt = acceptedAt;
  out.plan = plan;
  out.planDigest = computePlanDigest(out);
  plan.planDigest = out.planDigest;
  return out;
}

/** 从 artifact 提取身份（缺失即 null） */
export function planIdentityOf(artifact) {
  const a = artifact || {};
  const plan = (a.plan && typeof a.plan === "object") ? a.plan : {};
  return {
    planId: plan.planId || null,
    parentPlanId: plan.parentPlanId || null,
    rootPlanId: plan.rootPlanId || null,
    planDigest: plan.planDigest || a.planDigest || null,
    finalizationMode: plan.finalizationMode || null,
  };
}

/**
 * 机械校验跨 artifact 的身份一致性（§19/§20/§22）。
 * @param {{published?:object, accepted?:object, attribution?:object, tasksPlan?:object, runs?:Array}} sources
 * @returns {{ok:boolean, status:string, errors:Array<{code:string,where:string,detail:string}>}}
 */
export function verifyArtifactIdentity(sources = {}) {
  const { published, accepted, attribution, tasksPlan, runs } = sources;
  const errors = [];
  const pub = published ? planIdentityOf(published) : null;
  const acc = accepted ? planIdentityOf(accepted) : null;
  const att = attribution ? { planId: attribution.planId || null, planDigest: attribution.planDigest || null } : null;
  const tsk = tasksPlan ? { planId: tasksPlan.planId || null, planDigest: tasksPlan.planDigest || null } : null;

  if (pub && acc) {
    if (pub.planId !== acc.planId) errors.push({ code: "identity_mismatch", where: "I-PLAN-1 accepted.planId != published.planId", detail: `${acc.planId} != ${pub.planId}` });
    if (pub.planDigest !== acc.planDigest) errors.push({ code: "identity_mismatch", where: "I-PLAN-2 accepted.planDigest != published.planDigest", detail: `${acc.planDigest} != ${pub.planDigest}` });
  }
  if (acc && tsk) {
    if (acc.planId !== tsk.planId) errors.push({ code: "identity_mismatch", where: "I-PLAN-3 tasks.json.plan.planId != accepted.planId", detail: `${tsk.planId} != ${acc.planId}` });
    if (acc.planDigest !== tsk.planDigest) errors.push({ code: "identity_mismatch", where: "I-PLAN-3b tasks.json.plan.planDigest != accepted.planDigest", detail: `${tsk.planDigest} != ${acc.planDigest}` });
  }
  if (acc && att) {
    if (acc.planId !== att.planId) errors.push({ code: "identity_mismatch", where: "I-PLAN-4 attribution.planId != accepted.planId", detail: `${att.planId} != ${acc.planId}` });
    if (acc.planDigest !== att.planDigest) errors.push({ code: "identity_mismatch", where: "I-PLAN-4b attribution.planDigest != accepted.planDigest", detail: `${att.planDigest} != ${acc.planDigest}` });
  }
  if (acc && Array.isArray(runs)) {
    for (const r of runs) {
      if (r && r.planId !== undefined && r.planId !== null && r.planId !== acc.planId) {
        errors.push({ code: "identity_mismatch", where: "I-PLAN-5 run.planId != owning planId", detail: `${r.runId || "?"}: ${r.planId} != ${acc.planId}` });
      }
    }
  }
  return { ok: errors.length === 0, status: errors.length === 0 ? "IDENTITY CONSISTENT" : "identity_mismatch", errors };
}

// ── R1：单一 finalize 入口 ───────────────────────────────────────────────────
/**
 * 等待并定稿 Planner 产物（**唯一入口**：stage1 / stage2 / replan 全部经由本函数）。
 *
 * 阶段 A：等 .tmp 稳定 + **领域校验通过**（validatePlannerArtifact(kind)）⇒ VALIDATED
 * 阶段 B：等 .done ⇒ FINALIZED(marker)；未出现但 .tmp 稳定约 8s ⇒ FINALIZED(stability_fallback，降级)
 * 出口均**重读 .tmp**，避免返回阶段 A 的旧内容。
 *
 * @returns {{ok:boolean, phase:string, parsed?:object|Array, finalizationMode?:string, reason?:string, meta:object}}
 */
export async function finalizePlannerOutput({
  tmpFile,
  doneFile,
  kind,
  deadline,
  pollMs = 500,
  stableSamples = 3,
  invalidStableSamples = parseInt(process.env.DSH_ORCH_PLANNER_INVALID_STABLE_SAMPLES || "10", 10),
  markerWaitMs = parseInt(process.env.DSH_ORCH_PLANNER_MARKER_WAIT_MS || "45000", 10),
  onStaleInvalid = null,
} = {}) {
  const startedAt = Date.now();
  const domainOk = (p) => validatePlannerArtifact(kind, p).ok;

  // 阶段 A：DRAFT → VALIDATED
  let staleInfo = null;
  let parsed = await waitForStableJson(tmpFile, deadline, {
    pollMs, stableSamples, invalidStableSamples,
    isComplete: domainOk,
    onStaleInvalid: (info) => { staleInfo = info; if (typeof onStaleInvalid === "function") onStaleInvalid(info); },
  });
  if (parsed === null || !domainOk(parsed)) {
    return { ok: false, phase: PLANNER_PHASE.DRAFT, reason: staleInfo ? "stale_invalid_json" : "timeout", meta: { elapsedMs: Date.now() - startedAt, staleInfo, kind } };
  }
  const phaseAfterA = PLANNER_PHASE.VALIDATED;

  // 阶段 B：VALIDATED → FINALIZED（每个出口重读）
  const reread = () => { const fresh = readJsonStrict(tmpFile); return fresh && domainOk(fresh) ? fresh : null; };
  const markerDeadline = Math.min(deadline, Date.now() + markerWaitMs);
  let lastSize = -1;
  let unchanged = 0;
  const unchangedNeeded = Math.max(2, Math.ceil(8000 / pollMs));
  const done = (mode, extra = {}) => ({ ok: true, phase: PLANNER_PHASE.FINALIZED, parsed: reread() || parsed, finalizationMode: mode, meta: { elapsedMs: Date.now() - startedAt, kind, ...extra } });

  while (Date.now() < markerDeadline) {
    if (fs.existsSync(doneFile)) {
      if (reread()) return done(FINALIZATION_MODE.MARKER);
    }
    let size = -1;
    try { size = fs.statSync(tmpFile).size; } catch { size = -1; }
    if (size === lastSize) unchanged++; else { unchanged = 0; lastSize = size; }
    if (unchanged >= unchangedNeeded && reread()) {
      return done(FINALIZATION_MODE.STABILITY_FALLBACK, { note: "done 标记未出现，按稳定回退发布（降级路径）" });
    }
    await sleep(pollMs);
  }
  if (reread()) return done(FINALIZATION_MODE.STABILITY_FALLBACK, { note: "done 标记等待超时，按稳定回退发布（降级路径）" });
  return { ok: false, phase: phaseAfterA, reason: "not_finalized", meta: { elapsedMs: Date.now() - startedAt, kind } };
}

/**
 * 发布 Planner artifact（R1）：注入身份 → 原子写入 final ⇒ PUBLISHED。
 * @returns {{ok:boolean, planId:string, planDigest:string, publishMode:string, artifact:object}}
 */
export function publishPlannerArtifact(tmpFile, finalFile, { planId, parentPlanId = null, rootPlanId = null, finalizationMode = FINALIZATION_MODE.MARKER } = {}) {
  const raw = readJsonStrict(tmpFile);
  if (!raw) return { ok: false, reason: "tmp_unreadable" };
  const artifact = attachPlanIdentity(raw, { planId, parentPlanId, rootPlanId, finalizationMode, acceptedAt: new Date().toISOString().replace("T", " ").slice(0, 19) });
  fs.writeFileSync(finalFile, JSON.stringify(artifact, null, 2), "utf-8");
  try { fs.rmSync(tmpFile, { force: true }); } catch { /* 已消失 */ }
  return { ok: true, planId: artifact.plan.planId, planDigest: artifact.plan.planDigest, publishMode: "write", artifact };
}

/** 兼容导出（保留 V0.5.8 的命名与语义） */
export function publishPlannerOutput(tmpFile, finalFile) {
  return publishFile(tmpFile, finalFile);
}
