#!/usr/bin/env node
/**
 * orchestrator.mjs —— V0.2 Autonomous Orchestration（Manager Loop 的真实实现，非 Prompt 约定）
 *
 * 用法:
 *   node orchestrator.mjs "<目标>" --workdir <项目目录> [--skip-plan] [--max-rounds N] [--dry-run]
 *
 * 职责（代码驱动）:
 *   plan       自动任务拆解：目标+项目 → 调 Manager LLM(claude -p) → 产出 tasks.json DAG
 *   scheduler  依赖解析 → pending/ready/blocked；stale running → requeue；并行识别（顺序执行+标注）
 *   matcher    capability matching：task.required_capability × registry 能力评分 × backend 可用性
 *   dispatch   Task Contract → spawn worker（当前后端：claude -p 外部进程）
 *   collect    轮询 .ai/results/<taskId>.json（超时）
 *   validate   执行 task.validate 命令验收
 *   retry      retry_count / failure_reason / MAX_RETRY / 换 worker
 *   limits     MAX_ROUNDS / MAX_WORKER_CALLS / 每任务超时 / DAG 环检测
 *   recover    重启时 running → pending（Manager 不存在时不留永久 running）
 *   report     写日志 + 最终汇总
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { resolveExecutor, stripBom } from "./executors.mjs";
import { assembleContext } from "./context.mjs";
import { generateStateSummary } from "./state-summary.mjs";
import { distill } from "./distiller.mjs";

// ── 常量与限制 ──────────────────────────────────────────────────────────────
const MAX_RETRY = 2;
const MAX_ROUNDS = 40;
const MAX_WORKER_CALLS = 60;
const RESULT_POLL_MS = 4000; // plan 轮询用（worker 超时已由 Executor 管理）
const WORKER_TOOLS = "Read,Glob,Grep,Write,Edit"; // 沙箱内可用集（Bash 会 EPERM 挂死，禁用）
const WORKER_CMD = process.env.DSH_ORCH_WORKER || "claude"; // 当前唯一自动后端

// ── 小工具 ──────────────────────────────────────────────────────────────────
function log(...a) { console.log("[orch]", ...a); }
function nowIso() { return new Date().toISOString().replace("T", " ").substring(0, 19); }

function readJson(p, fallback) {
  try { return JSON.parse(stripBom(fs.readFileSync(p, "utf-8"))); } catch { return fallback; }
}
function writeJsonAtomic(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, p);
}
function runCmd(cmd, cwd, timeoutMs = 120000) {
  // 沙箱修复：node spawn 的 stdio:"pipe" 会撞 EPERM（尤其 orchestrator 跑在 headless 会话沙箱内时）。
  // 改用 stdio:"inherit" + shell 重定向到临时文件：状态可取、输出可读、不触发管道捕获限制。
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const tmpOut = path.join(LOG_DIR, `_cmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.out`);
  const r = spawnSync(`${cmd} > "${tmpOut}" 2>&1`, { cwd, shell: true, stdio: "inherit", timeout: timeoutMs });
  let out = "";
  try { out = fs.readFileSync(tmpOut, "utf-8"); } catch { /* 无输出 */ }
  fs.rmSync(tmpOut, { force: true });
  return { code: r.status, out, err: out };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 参数 ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const goal = argv.find((a) => !a.startsWith("--")) || "";
const opt = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ROOT = opt("--workdir") || process.cwd();
const AI = path.join(ROOT, ".ai");
const TASKS_FILE = path.join(AI, "tasks.json");
const STATE_FILE = path.join(AI, "state.json");
const REGISTRY_FILE = path.join(AI, "agents", "registry.json");
const RESULTS_DIR = path.join(AI, "results");
const LOG_DIR = path.join(AI, "logs");
const SKIP_PLAN = argv.includes("--skip-plan");
const DRY_RUN = argv.includes("--dry-run");
const maxRounds = parseInt(opt("--max-rounds") || "40", 10);

if (!goal) { console.error("用法: node orchestrator.mjs \"<目标>\" --workdir <dir>"); process.exit(1); }

// ── 状态读取 / 恢复 ─────────────────────────────────────────────────────────
function load() {
  const tasks = readJson(TASKS_FILE, { version: 2, goal, tasks: [] });
  const state = readJson(STATE_FILE, { version: 1, phase: "planned", completed: [], failed: [] });
  const registry = readJson(REGISTRY_FILE, { agents: [] });
  // 恢复：stale running（Manager 重启后无人在跑）→ pending
  let recovered = 0;
  for (const t of tasks.tasks || []) {
    if (t.status === "running") { t.status = "pending"; t.failure_reason = "stale-running: requeued after orchestrator restart"; recovered++; }
  }
  if (recovered) log(`恢复 ${recovered} 个 stale running 任务 → pending`);
  return { tasks, state, registry };
}
function save(tasks, state) {
  writeJsonAtomic(TASKS_FILE, tasks);
  writeJsonAtomic(STATE_FILE, state);
}
function logEvent(msg) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(path.join(LOG_DIR, "orchestrator.log"), `[${nowIso()}] ${msg}\n`, "utf-8");
}

// ── 自动任务拆解（调 Manager LLM）────────────────────────────────────────────
function buildContext() {
  const parts = [];
  for (const f of ["project.md", "requirements.md", "architecture.md"]) {
    const p = path.join(AI, f);
    if (fs.existsSync(p)) parts.push(`--- ${f} ---\n${fs.readFileSync(p, "utf-8").slice(0, 3000)}`);
  }
  return parts.join("\n\n") || "(无项目文档)";
}

// ── V0.4-A：专家咨询（真实 executor 调用，意见进入 Planning Context） ─────────
async function consultExpert(consult, registry, ctx) {
  const req = consult.required_capability || { architect: "architecture", analyst: "analysis", researcher: "research" }[consult.role] || "analysis";
  const pick = pickWorker({ required_capability: req }, registry);
  const slug = `${consult.role || "expert"}-${String(consult.topic || "t").slice(0, 12).replace(/[^\w\u4e00-\u9fa5-]/g, "")}`;
  const outFile = path.join(ROOT, ".ai", "consultations", `${slug}.md`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  if (!pick) { logEvent(`consult ${consult.role} 无可用 worker，跳过`); return `[${consult.role} 专家不可用（无可用 backend）]`; }
  const task = { id: `CONSULT-${slug}`, backendType: (pick.worker.backend && pick.worker.backend.type) || "claude-code" };
  const contract = `你是 ${consult.role} 专家（${pick.worker.name}）。主题：${consult.topic || goal}\n需要你给出专业意见的原因：${consult.reason || "为后续规划提供依据"}\n\n用 Write 工具把意见写入 ${outFile}（Markdown，结构化：结论/理由/建议/风险）。不要修改其他文件。`;
  log(`📞 专家咨询: ${consult.role}（${pick.worker.name}）→ ${consult.topic || goal}`);
  logEvent(`consult ${consult.role} -> ${pick.worker.id} @ ${nowIso()}`);
  try {
    const executor = resolveExecutor(task.backendType);
    const res = await executor.execute(task, { workspace: ROOT, resultsDir: RESULTS_DIR, contract, model: pick.worker.model || null });
    // 降级：结果协议失败但意见文件已产出 → 仍采信（意见真实进入 Planning Context）
    if (fs.existsSync(outFile)) {
      const txt = fs.readFileSync(outFile, "utf-8").slice(0, 4000);
      log(`  ✅ ${consult.role} 意见已入 Planning Context（${txt.length} 字符${res.status === "completed" ? "" : `，result=${res.status} 降级采信`}）`);
      logEvent(`consult-done ${consult.role} status=${res.status}`);
      return txt;
    }
    logEvent(`consult ${consult.role} 失败: ${res.error ? res.error.type : "?"}`);
    return `[${consult.role} 咨询失败：${res.error ? res.error.message : "未产出意见"}]`;
  } catch (e) {
    logEvent(`consult ${consult.role} 异常: ${e.message}`);
    return `[${consult.role} 咨询异常：${e.message}]`;
  }
}

// ── V0.4-A：两阶段 Planner ───────────────────────────────────────────────────
async function runPlannerStage(prompt, resFile) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.rmSync(resFile, { force: true });
  const child = spawn(WORKER_CMD, ["-p", prompt, "--max-turns", "30", "--allowedTools", WORKER_TOOLS], { cwd: ROOT, stdio: "ignore" });
  child.on("error", (e) => logEvent(`planner: spawn 失败 ${e.message}`));
  const deadline = Date.now() + 7 * 60 * 1000; // 阶段2 含专家意见上下文，给足时间
  while (Date.now() < deadline) {
    if (fs.existsSync(resFile)) break;
    await sleep(RESULT_POLL_MS);
  }
  if (!fs.existsSync(resFile)) return null;
  try {
    const raw = readJson(resFile, null);
    if (raw === null) return null;
    if (Array.isArray(raw)) return raw; // 数组格式（如 replan 输出）
    if (raw.tasks || raw.expert_consultations || raw.plan) return raw; // 对象格式
    return JSON.parse(extractJson(stripBom(fs.readFileSync(resFile, "utf-8"))));
  } catch { return null; }
}

async function plan(tasks, state, registry) {
  if (tasks.tasks && tasks.tasks.length > 0) { log("tasks.json 已有任务，跳过拆解"); return tasks; }
  log("自动规划：阶段1 判断是否需要专家咨询…");

  const ctxText = buildContext();
  const stage1File = path.join(RESULTS_DIR, "_plan1.json");
  const s1 = await runPlannerStage(
    `你是 Multi-Agent 系统的 Manager。目标：${goal}\n项目目录：${ROOT}\n项目上下文：\n${ctxText}\n\n判断该目标是否需要专家意见。用 Write 工具把结果 JSON 写入 ${stage1File}（只含 JSON 对象，无 markdown）：\n{"goal_understanding":"…","expert_consultations":[{"role":"architect|analyst|researcher","topic":"…","reason":"…","required_capability":"architecture|analysis|research"}]}\n规则：仅当任务确实需要（复杂架构→architect、复杂算法→analyst、外部资料→researcher）才列；不需要则为空数组。`,
    stage1File
  );
  const consultations = (s1 && Array.isArray(s1.expert_consultations)) ? s1.expert_consultations : [];

  // 真实咨询专家（Codex/DSH 等经现有 Executor 执行）
  const consultTexts = [];
  for (const c of consultations) {
    const txt = await consultExpert(c, registry, {});
    consultTexts.push(`## ${c.role} 专家意见（${c.topic}）\n${txt}`);
  }
  if (consultations.length) log(`专家咨询完成：${consultations.length} 项意见注入 Planning Context`);

  // 阶段2：综合专家意见生成完整 Plan + DAG
  log("自动规划：阶段2 综合生成 Plan 与任务 DAG…");
  const stage2File = path.join(RESULTS_DIR, "_plan2.json");

  // ── V0.5-P0-03：Planner Context（Project State Summary + Relevant Memory，Budget 内） ──
  let plannerCtxText = "（无 Project Memory）";
  let plannerSummaryText = "（无 state.summary）";
  try {
    const memCtx = assembleContext({
      workdir: ROOT,
      currentTask: { id: "GOAL", title: goal, description: goal, required_capability: "analysis" },
      budgetChars: PLANNER_CONTEXT_BUDGET,
      topK: 12,
    });
    plannerCtxText = [
      `[RELEVANT DECISIONS]`,
      memCtx.sections.decisions || "（无）",
      `[RELEVANT LESSONS]`,
      memCtx.sections.lessons || "（无）",
      `[RELEVANT KNOWLEDGE]`,
      memCtx.sections.knowledge || "（无）",
      `[RELEVANT AGENT MEMORY]`,
      memCtx.sections.agentMemory || "（无）",
    ].join("\n");
    logEvent(`planner-context memory=${memCtx.selected.length} chars=${memCtx.usedChars}/${memCtx.budgetChars} truncated=${memCtx.truncated}`);
  } catch (e) { logEvent(`planner-context 组装失败: ${e.message}`); }
  try {
    plannerSummaryText = generateStateSummary({ workdir: ROOT, write: false });
    generateStateSummary({ workdir: ROOT, write: true }); // 落盘供新会话快速恢复
    logEvent("state-summary 已生成");
  } catch (e) { logEvent(`state-summary 失败: ${e.message}`); }

  const s2 = await runPlannerStage(
    `你是 Multi-Agent 系统的 Manager。目标：${goal}\n项目目录：${ROOT}\n项目上下文：\n${ctxText}\n\n专家意见（已咨询，直接采信）：\n${consultTexts.join("\n\n") || "（无专家咨询）"}\n\n[CURRENT TASK]\n${goal}\n\n[PROJECT STATE SUMMARY]\n${plannerSummaryText}\n\n[RELEVANT MEMORY（来自 Project Memory，括号内为来源 provenance；仅参考，不强制引用）]\n${plannerCtxText}\n\n综合生成结构化 Plan 与任务 DAG。用 Write 工具把结果 JSON 写入 ${stage2File}（只含 JSON 对象，无 markdown）：\n{"plan":{"goal":"…","assumptions":["…"],"expert_consultations":["…"],"risks":["…"],"architecture_decisions":[{"decision":"…","rationale":"…","alternatives":["…"]}]},"tasks":[{"id":"TASK-001","title":"…","description":"…","required_capability":"analysis|coding|review|research|architecture","dependencies":["TASK-00X"],"acceptance_criteria":["…"],"expected_output":"…","relevant_files":["…"],"constraints":["…"],"requires_review":true}]}\n规则：1) id 递增；2) 依赖只能是已出现的任务 id，保证无环；3) 分析/架构任务在前，编码依赖它们，测试/审查依赖编码；4) 任务粒度适合单个 worker 独立完成；5) 验收标准必须可执行："run: node test.js"（exit 0）或 "file: src/x.js"（存在）；file: 只允许静态产物，禁止把运行时生成的数据文件（todos.json/*.db/日志）作为 file: 验收，这类用 run:；6) requires_review 为布尔值，必须显式给出：涉及核心数据读写/持久化、对外 API、安全或权限、多模块集成关键路径、不可逆改动的任务设 true（worker 自报 completed 后仍由独立 Reviewer 核验）；纯内部、低风险、可由验收命令完全覆盖的简单任务设 false；7) plan.architecture_decisions 显式记录本规划中做出的关键架构/设计取舍（如数据模型与状态存储方式、复用现有模块还是新建、接口形态、扩展点选择），每条含 decision/rationale/alternatives；这些决策会沉淀为长期 Memory 供后续会话复用，没有关键取舍时给空数组。`,
    stage2File
  );

  let parsed = s2;
  if (!parsed || !Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
    // 回退：用简单规则生成一个最小 DAG（保证可闭环）
    logEvent("plan: 阶段2 失败，使用回退 DAG");
    parsed = {
      plan: { goal, assumptions: [], expert_consultations: consultations.map((c) => `${c.role}:${c.topic}`), risks: [] },
      tasks: [
        { id: "TASK-001", title: "分析需求与项目", description: `分析目标：${goal}`, required_capability: "analysis", dependencies: [], acceptance_criteria: ["file: .ai/proposals/analysis.md"], expected_output: "分析文档", relevant_files: [".ai/"], constraints: [] },
        { id: "TASK-002", title: "实现编码", description: `按分析结果实现：${goal}`, required_capability: "coding", dependencies: ["TASK-001"], acceptance_criteria: ["file: server.js"], expected_output: "实现文件（server.js）", relevant_files: [], constraints: [] },
        { id: "TASK-003", title: "测试验证", description: "创建并运行测试", required_capability: "review", dependencies: ["TASK-002"], acceptance_criteria: ["run: node test.js"], expected_output: "test.js 且全部通过", relevant_files: [], constraints: [], requires_review: true },
      ],
    };
  }
  const now = nowIso();
  for (const t of parsed.tasks) {
    t.status = "pending";
    t.retry_count = 0;
    t.failure_reason = null;
    t.result = null;
    t.requires_review = t.requires_review === true; // 规范化为布尔（Planner 漏给则默认不审查）
    t.created_at = now;
    t.started_at = null;
    t.completed_at = null;
  }
  tasks.tasks = parsed.tasks;
  tasks.version = 2;
  tasks.goal = goal;
  tasks.plan = parsed.plan || { goal, assumptions: [], expert_consultations: consultations.map((c) => `${c.role}:${c.topic}`), risks: [] };
  state.phase = "planned";
  save(tasks, state);
  log(`Plan 完成：${tasks.tasks.length} 个任务（专家咨询 ${consultations.length} 项）`);
  logEvent(`plan: ${tasks.tasks.length} tasks, consultations=${consultations.length}`);
  return tasks;
}

// ── V0.4-A：Plan Precheck（7 项；失败→结构化错误不执行，架构预留 Replanning） ──
function precheckPlan(tasks, registry) {
  const errors = [];
  const all = tasks.tasks || [];
  const ids = new Set(all.map((t) => t.id));

  // 1. 依赖不可满足（引用了不存在的任务）
  for (const t of all) for (const d of t.dependencies || []) if (!ids.has(d)) errors.push({ code: "dep_missing", taskId: t.id, message: `依赖 ${d} 不存在` });
  // 2. 循环依赖
  const visit = (id, stack) => {
    if (stack.has(id)) return true;
    for (const t of all) if (t.id === id) for (const d of t.dependencies || []) if (visit(d, new Set([...stack, id]))) return true;
    return false;
  };
  for (const t of all) if (visit(t.id, new Set())) { errors.push({ code: "dep_cycle", taskId: t.id, message: "存在循环依赖" }); break; }
  // 3/4/5. agent 存在 / executor 可用 / 能力满足
  for (const t of all) {
    if (t.assigned_agent && !(registry.agents || []).some((a) => a.id === t.assigned_agent)) errors.push({ code: "agent_missing", taskId: t.id, message: `指定 agent ${t.assigned_agent} 不在 registry` });
    const pick = pickWorker(t, registry);
    if (!pick) errors.push({ code: "capability_unsatisfied", taskId: t.id, message: `capability "${t.required_capability || "coding"}" 无可用 worker` });
    else {
      const bt = (pick.worker.backend && pick.worker.backend.type) || "claude-code";
      try { resolveExecutor(bt); } catch { errors.push({ code: "executor_unavailable", taskId: t.id, message: `backend ${bt} 无 executor` }); }
    }
  }
  // 6. 文件冲突（同一批次内可能并行的任务间）
  const readySet = [];
  for (const t of all) if ((t.dependencies || []).length === 0) readySet.push(t);
  for (let i = 0; i < readySet.length; i++) for (let j = i + 1; j < readySet.length; j++) if (hasFileConflict(readySet[i], readySet[j])) errors.push({ code: "file_conflict", taskId: `${readySet[i].id}/${readySet[j].id}`, message: "无依赖任务间存在文件冲突" });
  // 7. 输入契约（依赖任务的 expected_output 形如路径时，下游应能消费——仅检查依赖存在，弱契约）
  for (const t of all) for (const d of t.dependencies || []) { const dep = all.find((x) => x.id === d); if (dep && !dep.expected_output) errors.push({ code: "input_missing", taskId: t.id, message: `依赖 ${d} 未声明 expected_output（下游无法验证输入）` }); }

  return { ok: errors.length === 0, errors };
}

// ── V0.5-P0-04：Memory / State 生命周期自动刷新（最小 Hook，失败隔离） ─────────
/**
 * 批次结束后调用：最终任务状态已确定（含 Review FAIL→Replan→最终结果）→ Distill → State Summary。
 * 幂等（distill 稳定 ID 去重）；任一步骤失败只记录，不影响任务状态与原始层。
 */
async function refreshMemoryAndState() {
  try {
    const r = await distill({ workdir: ROOT });
    if (r.added > 0) log(`🧠 自动 Distill：新增 ${r.added} 条 Memory（跳过 ${r.skipped}）`);
    logEvent(`auto-distill added=${r.added} skipped=${r.skipped}`);
  } catch (e) {
    logEvent(`auto-distill 失败（不影响任务，可后补）: ${e.message}`);
  }
  try {
    generateStateSummary({ workdir: ROOT, write: true });
    logEvent("auto-state-summary 刷新");
  } catch (e) {
    logEvent(`auto-state-summary 失败（不影响任务，可后补）: ${e.message}`);
  }
}

function extractJson(s) {
  const m = s.match(/\{[\s\S]*\}/);
  return m ? m[0] : "{}";
}

// ── 调度：依赖解析 ───────────────────────────────────────────────────────────
function computeStatus(t, all) {
  if (["completed", "failed", "cancelled"].includes(t.status)) return t.status;
  const deps = (t.dependencies || []).map((id) => all.find((x) => x.id === id)).filter(Boolean);
  const depFailed = deps.some((d) => d.status === "failed" || d.status === "cancelled");
  const depsDone = deps.every((d) => d.status === "completed");
  if (depFailed) return "blocked";
  if (t.status === "running") return "running";
  if (t.status === "failed") return "failed"; // 已到 retry 上限的保持 failed
  if (!depsDone) return "pending"; // 依赖未齐
  return "ready";
}

// ── Capability Matching ──────────────────────────────────────────────────────
function pickWorker(task, registry) {
  const req = task.required_capability || "coding";
  let best = null;
  for (const agent of registry.agents || []) {
    if (agent.id === "manager") continue;
    const backend = agent.backend || {};
    if (!backend.enabled) continue;                    // 后端不可自动执行 → 跳过
    if (agent.status && agent.status !== "ready") continue;
    const score = (agent.capabilities && agent.capabilities[req]) || 0;
    if (!best || score > best.score) best = { agent, score };
  }
  if (!best) return null;
  return { worker: best.agent, matched: true, score: best.score, req };
}

// registry 无可用 worker 时的默认兜底（保证闭环不崩）
const DEFAULT_WORKER = { id: "claude-code", name: "Claude Code (fallback)", backend: { type: "claude-code", enabled: true } };

// ── Task Contract 构建 ───────────────────────────────────────────────────────
function buildContract(task, ctx) {
  return [
    `你是 Multi-Agent 系统的工作 Worker（${task.assigned_agent || "unknown"}）。执行任务 ${task.id}。`,
    ``,
    `## 任务契约`,
    `- Goal: ${task.title}`,
    `- Description: ${task.description}`,
    `- Context: ${ctx}`,
    `- Relevant Files: ${(task.relevant_files || []).join(", ") || "（由你判断）"}`,
    `- Dependencies 已完成: ${(task.dependencies || []).join(", ") || "无"}`,
    `- Constraints: ${(task.constraints || []).join("; ") || "不引入第三方依赖除非明确要求；不改 .ai/ 下状态文件"}`,
    `- Acceptance Criteria:`,
    ...(task.acceptance_criteria || []).map((a) => `  1. ${a}`),
    `- Expected Output: ${task.expected_output || "完成实现并自测"}`,
    ``,
    `## 完成要求`,
    `1. 认真执行任务，自主使用你的工具（文件读写/编辑/分析）。`,
    `2. **不要尝试运行任何命令（node / npm / curl 等）**——你的环境不允许执行命令，验收命令由调度器统一执行；若你无法执行命令，不影响任务完成判定。`,
    `3. 完成后写结果文件 ${path.join(RESULTS_DIR, task.id + ".json")}（UTF-8 JSON，不要 markdown 代码块），结构：`,
    `   {"status":"completed|failed","summary":"…","modified_files":["…"],"tests":[{"name":"…","result":"pass|fail","evidence":"…"}],"issues":[{"severity":"high|medium|low","detail":"…"}],"recommendations":["…"]}`,
    `4. status=failed 时 summary 里写清 failure_reason。`,
    `5. 不要修改 .ai/tasks.json / .ai/state.json / registry.json（调度器负责）。`,
    `6. 只做本任务契约要求的工作。`,
    ``,
    `## Agent 通信（可选，V0.4-C）`,
    `- 你可以在 .ai/messages/ 目录下收到其他 agent 发来的消息（若有，已列在「收到的消息」）。`,
    `- 如确需给其他 agent（如 reviewer/coder）留言或请求信息，用 Write 工具写消息文件 .ai/messages/<任意id>.json，格式：{"from_agent_id":"${task.assigned_agent || "worker"}","to_agent_id":"<目标 agent 或 reviewer>","to_task_id":"<目标任务 id，可选>","subject":"…","body":"…","channel":"direct"}。消息会由 Manager 记录并转发。`,
    `- 不要因通信阻塞任务：消息是异步的，若无人回复，正常完成任务即可。`,
  ].join("\n");
}

// ── 派发 / 收集 ─────────────────────────────────────────────────────────────
// ── Worker 派发/收集：全部经由 Executor 层（V0.3 P0-01 解耦） ────────────────
// Orchestrator 不再直接 spawn claude；具体 Backend 细节在 executors.mjs 中。
async function dispatchAndCollect(task, contract) {
  task.status = "running";
  task.started_at = nowIso();
  log(`派发 ${task.id} → ${task.assigned_agent}（backend=${task.backendType || "claude-code"} via executor）`);
  logEvent(`dispatch ${task.id} -> ${task.assigned_agent} @ ${nowIso()}`);

  if (DRY_RUN) { await sleep(2000); return { ok: false, reason: "dry-run" }; }

  // Executor 解析：registry.backend.type → Factory → 具体 Executor；model 一并传入（Model Binding）
  const executor = resolveExecutor(task.backendType);
  const result = await executor.execute(
    { id: task.id, backendType: task.backendType || "claude-code" },
    { workspace: ROOT, resultsDir: RESULTS_DIR, contract, model: task.model || null }
  );

  // 统一 Result 判定（Executor 已把 Backend 错误归一化）
  const ok = result.status === "completed";
  return {
    ok,
    result,
    reason: ok ? null : (result.error ? `${result.error.type}: ${result.error.message}` : "executor 失败"),
    retryable: ok ? null : (result.error ? result.error.retryable : true),
  };
}

// ── 验收 ─────────────────────────────────────────────────────────────────────
function validateTask(task) {
  const checks = task.acceptance_criteria || [];
  if (checks.length === 0) return { pass: true, detail: "无验收命令，默认通过" };
  const pass = [];
  for (const c of checks) {
    // 支持形如 `run: node test.js` / `file: src/x.js` / 普通文本说明
    let ok;
    if (c.startsWith("run:")) { const r = runCmd(c.slice(4).trim(), ROOT); ok = r.code === 0; pass.push({ c, ok, ev: ok ? `exit 0` : `exit ${r.code}: ${r.err.slice(0, 200)}` }); }
    else if (c.startsWith("file:")) { ok = fs.existsSync(path.join(ROOT, c.slice(5).trim())); pass.push({ c, ok, ev: ok ? "存在" : "缺失" }); }
    else { pass.push({ c, ok: true, ev: "人工核对项（自动通过）" }); }
  }
  return { pass: pass.every((p) => p.ok), detail: pass.map((p) => `${p.ok ? "✓" : "✗"} ${p.c} ${p.ev}`).join("; ") };
}

// ── P0-04：并行执行 ─────────────────────────────────────────────────────────
const MAX_PARALLEL = parseInt(process.env.DSH_ORCH_MAX_PARALLEL || "3", 10); // 并发上限
const PLANNER_CONTEXT_BUDGET = 6000; // V0.5-P0-03：Planner Memory Context 预算（字符估算）
let workerCalls = 0; // 模块级：runTask 并行批次共享（单线程自增无竞态）

/** 任务涉及的路径集合（relevant_files + 形如路径的 expected_output） */
function taskFiles(t) {
  const set = new Set();
  const norm = (p) => String(p || "").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase().trim();
  for (const f of t.relevant_files || []) if (f && f !== "…" && f !== "...") set.add(norm(f));
  const eo = t.expected_output;
  if (eo && /\.\w{1,8}$/.test(String(eo).trim())) set.add(norm(eo));
  return set;
}
/** 文件冲突检测：两任务涉及同一路径 → 不可并行（串行化） */
function hasFileConflict(a, b) {
  const fa = taskFiles(a), fb = taskFiles(b);
  for (const f of fa) if (fb.has(f)) return true;
  return false;
}

// ── V0.4-C：Agent Communication / Run Observability / Scope / Review Gate ────
const MSG_DIR = () => path.join(AI, "messages");
const RUNS_DIR = () => path.join(AI, "runs");
const REVIEWS_DIR = () => path.join(AI, "reviews");

/** 注入发给当前任务/agent 的待处理消息（ORCH 模式：JSON 文件 + dispatch 时注入） */
function injectIncomingMessages(task) {
  const dir = MSG_DIR();
  if (!fs.existsSync(dir)) return "";
  const toMe = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const m = JSON.parse(stripBom(fs.readFileSync(path.join(dir, f), "utf-8")));
      if (m.status && m.status !== "pending") continue;
      const match = (m.channel === "broadcast") || (m.to_task_id && m.to_task_id === task.id) || (m.to_agent_id && m.to_agent_id === task.assigned_agent) || (m.to_agent_id === "any");
      if (match) {
        toMe.push(`- [${m.from_agent_id || "?"}] ${m.subject || "消息"}: ${String(m.body || "").slice(0, 500)}`);
        m.status = "delivered"; m.delivered_at = nowIso();
        writeJsonAtomic(path.join(dir, f), m);
      }
    } catch { /* 忽略坏消息 */ }
  }
  return toMe.length ? `\n## 收到的消息\n${toMe.join("\n")}` : "";
}

/** 收集 worker 发出的新消息（关联任务） */
function collectWorkerMessages(task) {
  const dir = MSG_DIR();
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const m = JSON.parse(stripBom(fs.readFileSync(path.join(dir, f), "utf-8")));
      if (m.status && m.status !== "pending") continue;
      if (m.from_agent_id === task.assigned_agent) {
        m.status = "delivered"; m.delivered_at = nowIso(); m.sourceTaskId = task.id;
        writeJsonAtomic(path.join(dir, f), m);
        found.push(m);
      }
    } catch { /* 忽略 */ }
  }
  return found;
}

/** Run 记录（JSON + append-only JSONL，ORCH 模式） */
function recordRun(task, phase, extra = {}) {
  const runsDir = RUNS_DIR();
  fs.mkdirSync(runsDir, { recursive: true });
  const runId = `${task.id}-${Date.now()}`;
  const run = {
    runId,
    taskId: task.id,
    agent: task.assigned_agent,
    backend: task.backendType,
    model: task.model,
    phase,
    start: task.started_at,
    end: nowIso(),
    status: task.status,
    failure_reason: task.failure_reason || null,
    result: task.result ? { summary: String(task.result.summary || "").slice(0, 300), files: task.result.modified_files || [], tests: (task.result.tests || []).length } : null,
    filesChanged: (task.result && task.result.modified_files) || [],
    outOfScope: extra.outOfScope || [],
    messages: extra.messages || [],
    review: extra.review || null,
    parentTask: task.parentTask || null,
  };
  writeJsonAtomic(path.join(runsDir, `${runId}.json`), run);
  try { fs.appendFileSync(path.join(runsDir, "runs.jsonl"), JSON.stringify(run) + "\n", "utf-8"); } catch { /* 忽略 */ }
  return runId;
}

/** Scope/Change Tracking：实际修改超出任务声明的 scope → warning（不破坏并行） */
function scopeViolations(task) {
  const scope = new Set([
    ...(task.relevant_files || []),
    ...(task.expected_output && /\.\w{1,8}$/.test(String(task.expected_output)) ? [task.expected_output] : []),
  ]);
  if (scope.size === 0) return [];
  const norm = (p) => String(p || "").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  const scoped = new Set([...scope].map(norm));
  return ((task.result && task.result.modified_files) || []).filter((m) => {
    const nm = norm(m);
    return !scoped.has(nm) && ![...scoped].some((s) => nm.startsWith(s + "/") || s.startsWith(nm + "/"));
  });
}

/** Review Gate：独立 Reviewer 对任务产出给结构化 verdict（PASS/FAIL） */
async function reviewTask(task, ctx) {
  const resFile = path.join(RESULTS_DIR, `_review-${task.id}.json`);
  const files = ((task.result && task.result.modified_files) || []).join(", ") || "(无文件变更)";
  const rules = (task.review_rules || []).join("; ") || "检查产出是否符合任务要求与验收标准，是否存在明显缺陷";
  const prompt = `你是 Review Gate（独立 Reviewer）。对任务 ${task.id} 的产出做严格审查。\n任务：${task.title}\n约束/验收：${(task.constraints || []).join("; ")}${(task.acceptance_criteria || []).join(" | ")}\n改动文件：${files}\nReview 规则（必须逐条检查）：${rules}\n用 Read 工具读取改动文件核验。用 Write 工具把 verdict JSON 写入 ${resFile}（只含 JSON 对象，无 markdown）：{"verdict":"PASS|FAIL","reason":"…","checks":[{"name":"…","pass":true|false}]}`;
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.rmSync(resFile, { force: true });
  const child = spawn(WORKER_CMD, ["-p", prompt, "--max-turns", "20", "--allowedTools", "Read,Glob,Grep,Write"], { cwd: ROOT, stdio: "ignore" });
  child.on("error", () => {});
  const deadline = Date.now() + 3 * 60 * 1000;
  while (Date.now() < deadline) {
    if (fs.existsSync(resFile)) break;
    await sleep(RESULT_POLL_MS);
  }
  let verdict = null;
  if (fs.existsSync(resFile)) {
    try {
      const r = readJson(resFile, null);
      if (r && (r.verdict === "PASS" || r.verdict === "FAIL")) verdict = r; // 仅接受有效 verdict
    } catch { /* 解析失败视为无 verdict */ }
  }
  if (!verdict) verdict = { verdict: "FAIL", reason: "Reviewer 未产出有效 verdict（保守判定 FAIL，不默认通过）" }; // P0-04-FIX
  fs.mkdirSync(REVIEWS_DIR(), { recursive: true });
  writeJsonAtomic(path.join(REVIEWS_DIR(), `${task.id}.json`), { taskId: task.id, ...verdict, reviewedAt: nowIso() });
  return verdict;
}

// ── V0.4-B：Evaluator（失败分类） + Replanning（局部重规划） ─────────────────
const MAX_REPLAN = 2;
let replanCount = 0;

/** 失败分类：临时执行失败（retry）vs 计划问题（replan）。综合全部失败历史。 */
function evaluateFailure(task, registry) {
  const history = (task.failure_history || []).concat(task.failure_reason || "").join(" ").toLowerCase();
  let suggested = "retry";
  if (history.includes("backend_unavailable")) {
    suggested = "replan"; // backend 不可用 = 计划/路由问题
  } else if ((history.includes("验收未通过") && (task.retry_count || 0) >= MAX_RETRY) || (history.includes("review-fail") && (task.retry_count || 0) >= 1)) {
    suggested = "replan"; // 验收矛盾（重试耗尽）/ Review 否决（重试 1 次后）→ 计划问题
  } else if (history.includes("timeout") || history.includes("超时") || history.includes("non_zero_exit") || history.includes("process_error") || history.includes("malformed") || history.includes("退出码")) {
    suggested = "retry"; // worker 执行层问题 → 重试
  }
  const evaluation = {
    taskId: task.id,
    verdict: suggested === "replan" ? "FAIL" : "RETRY",
    reason: task.failure_reason,
    affected_tasks: [task.id, ...(task.dependencies || [])],
    suggested_action: suggested,
    retry_count: task.retry_count,
    evaluatedAt: nowIso(),
  };
  fs.mkdirSync(path.join(AI, "evaluations"), { recursive: true });
  writeJsonAtomic(path.join(AI, "evaluations", `${task.id}.json`), evaluation);
  log(`🔍 Evaluator ${task.id}: verdict=${evaluation.verdict} action=${suggested}（${task.failure_reason}）`);
  logEvent(`evaluate ${task.id} -> ${suggested}`);
  return evaluation;
}

/** 局部重规划：Manager LLM 修改失败相关任务，生成新 DAG（保留已完成任务）。 */
async function doReplan(task, tasks, state, registry) {
  const resFile = path.join(RESULTS_DIR, "_replan.json");
  const allJson = JSON.stringify(
    tasks.tasks.map((t) => ({ id: t.id, title: t.title, required_capability: t.required_capability, dependencies: t.dependencies, acceptance_criteria: t.acceptance_criteria, expected_output: t.expected_output, status: t.status, failure_reason: t.failure_reason || null })),
    null, 1
  );
  const prompt = `你是 Multi-Agent 系统的 Manager。目标：${goal}。任务 ${task.id} 失败且重试耗尽，失败原因：${task.failure_reason}。\n当前任务集：\n${allJson.slice(0, 8000)}\n\n请进行**局部重规划**：只修改失败任务及其直接影响的任务，使计划可执行（修正矛盾/不可行的验收标准、拆分任务、更换 required_capability、调整依赖）。已完成任务保持原样。\n用 Write 工具把完整的新任务数组 JSON 写入 ${resFile}（只含 JSON 数组，无 markdown）：\n[{"id":"TASK-XX","title":"…","description":"…","required_capability":"…","dependencies":[],"acceptance_criteria":["run: node test.js"],"expected_output":"…","relevant_files":[],"constraints":[],"requires_review":false}]\n规则：1) 失败的 ${task.id} 必须被修改为可执行版本（绝不能保留原验收）；2) 已完成任务保留原 id 与字段；3) 新增任务用新 id；4) 保证无环；5) requires_review 为布尔：涉及核心数据/对外 API/集成关键路径的任务设 true，其余 false。`;
  let s2 = await runPlannerStage(prompt, resFile);
  if (s2 && !Array.isArray(s2) && Array.isArray(s2.tasks)) s2 = s2.tasks; // 兼容 {tasks:[...]} 包装
  if (s2 && Array.isArray(s2) && s2.length > 0) {
    const now = nowIso();
    const oldById = new Map(tasks.tasks.map((t) => [t.id, t]));
    const merged = [];
    for (const t of s2) {
      const old = oldById.get(t.id);
      const nt = { ...t };
      nt.requires_review = nt.requires_review === true; // 规范化为布尔（replan 新任务同样支持 Review Gate）
      if (old && old.status === "completed") {
        nt.status = "completed"; nt.completed_at = old.completed_at; nt.result = old.result; nt.retry_count = 0;
      } else if (old) {
        nt.status = "pending"; nt.retry_count = 0; nt.failure_reason = null; nt.result = null;
      } else {
        nt.status = "pending"; nt.retry_count = 0; nt.failure_reason = null; nt.result = null;
      }
      nt.created_at = old ? old.created_at : now;
      nt.started_at = null;
      nt.completed_at = old && old.status === "completed" ? old.completed_at : null;
      merged.push(nt);
    }
    tasks.tasks = merged;
    tasks.replan_count = (tasks.replan_count || 0) + 1;
    state.phase = "replanned";
    save(tasks, state);
    log(`🔁 Replan 完成：任务集 ${merged.length} 个（replan #${tasks.replan_count}），${task.id} 已修改`);
    logEvent(`replan #${tasks.replan_count}: ${task.id} modified -> ${merged.length} tasks`);
    return true;
  }
  log(`⛔ Replan 失败（LLM 未产出新 DAG）`);
  logEvent(`replan-fail ${task.id}`);
  return false;
}

/** 单个任务的完整流程（pick → dispatch → validate → retry/evaluate/replan）；并行批次内并发调用 */
async function runTask(task, registry, ctx, tasksRef, stateRef) {
  if (task.retry_count === undefined) task.retry_count = 0; // 手写/外部 tasks.json 可能缺字段
  // Capability matching
  let pick = pickWorker(task, registry);
  if (!pick) {
    log(`⚠️ registry 无可用 worker，回退默认 ${DEFAULT_WORKER.id}（task=${task.id} req=${task.required_capability}）`);
    logEvent(`fallback-worker ${task.id} -> ${DEFAULT_WORKER.id}`);
    pick = { worker: DEFAULT_WORKER, matched: false, score: 0 };
  }
  if (workerCalls >= MAX_WORKER_CALLS) { task.status = "failed"; task.failure_reason = "worker call limit"; log(`❌ ${task.id} 超过 worker 调用上限`); return; }
  workerCalls++;
  task.assigned_agent = pick.worker.id;
  // Registry → Backend 类型（Executor Factory 的输入；Manager/Scheduler 不硬编码具体命令）
  task.backendType = (pick.worker.backend && pick.worker.backend.type) || "claude-code";
  // Model Binding：模型来自 Agent Profile（人工指定），Executor 只负责传参，改模型不改代码
  task.model = pick.worker.model || null;
  log(`选择 worker: ${pick.worker.id}（score ${pick.score} for ${pick.req}，backend=${task.backendType}${task.model ? `，model=${task.model}` : ""}）`);

  const contract = buildContract(task, ctx) + injectIncomingMessages(task); // V0.4-C：注入收到的 Agent 消息
  const res = await dispatchAndCollect(task, contract);
  const messages = collectWorkerMessages(task); // V0.4-C：收集 worker 发出的消息

  if (res.ok) {
    task.result = res.result;
    // 验收
    const v = validateTask(task);
    if (v.pass) {
      // V0.4-C：Review Gate —— 执行成功且命令验收通过后，仍需独立 Review（todo→running→review→done）
      if (task.requires_review) {
        const rv = await reviewTask(task, ctx);
        recordRun(task, "review", { review: rv, messages, outOfScope: scopeViolations(task) });
        if (rv.verdict === "FAIL") {
          task.status = "failed";
          task.failure_reason = `review-fail: ${rv.reason}`;
          task.failure_history = [...(task.failure_history || []), task.failure_reason];
          log(`🔴 ${task.id} Review FAIL：${rv.reason}`);
          logEvent(`review-fail ${task.id}: ${String(rv.reason).slice(0, 200)}`);
        } else {
          task.status = "completed";
          task.completed_at = nowIso();
          log(`✅ ${task.id} 完成（Review PASS）`);
          logEvent(`review-pass ${task.id}`);
        }
      } else {
        task.status = "completed";
        task.completed_at = nowIso();
        log(`✅ ${task.id} 完成（验收通过）`);
        logEvent(`complete ${task.id} ${v.detail.slice(0, 300)}`);
      }
      // V0.4-C：Scope/Change Tracking
      const oos = scopeViolations(task);
      if (oos.length) { log(`⚠️ ${task.id} 修改超出声明 Scope：${oos.join(", ")}`); logEvent(`scope-violation ${task.id}: ${oos.join(",")}`); }
      recordRun(task, "done", { messages, outOfScope: oos });
    } else {
      task.status = "failed";
      task.failure_reason = `验收未通过: ${v.detail}`;
      task.failure_history = [...(task.failure_history || []), task.failure_reason];
      recordRun(task, "failed", { messages, outOfScope: scopeViolations(task) });
      log(`❌ ${task.id} 验收未通过`);
    }
  } else {
    task.status = "failed";
    task.failure_reason = res.reason;
    task.failure_history = [...(task.failure_history || []), task.failure_reason];
    recordRun(task, "failed", { messages, outOfScope: [] });
    log(`❌ ${task.id} 失败: ${res.reason}`);
    if (res.result) task.result = res.result;
  }

  // Retry / Evaluate / Replan
  if (task.status === "failed" && task.retry_count < MAX_RETRY) {
    task.retry_count++;
    task.status = "pending"; // 依赖仍满足，下轮 ready
    log(`↻ ${task.id} 重试 ${task.retry_count}/${MAX_RETRY}（reason: ${task.failure_reason}）`);
    logEvent(`retry ${task.id} ${task.retry_count}/${MAX_RETRY} ${task.failure_reason}`);
  } else if (task.status === "failed") {
    // V0.4-B：Evaluator 判定「临时失败 or 计划问题」
    const ev = evaluateFailure(task, registry);
    if (ev.suggested_action === "replan" && replanCount < MAX_REPLAN) {
      replanCount++;
      log(`🔁 触发 Replanning（#${replanCount}/${MAX_REPLAN}）…`);
      const ok = await doReplan(task, tasksRef, stateRef, registry);
      if (!ok) {
        log(`⛔ ${task.id} Replan 失败，定案 failed`);
        logEvent(`failed-final ${task.id}`);
      }
    } else {
      // 临时失败或 replan 已用尽：尝试换 worker（同能力其他可用后端），否则定案
      const alt = pickWorker({ ...task, required_capability: task.required_capability }, registry);
      if (alt && alt.worker.id !== task.assigned_agent) {
        log(`⇄ ${task.id} 尝试更换 worker → ${alt.worker.id}`);
        task.retry_count++;
        task.status = "pending";
        logEvent(`switch-worker ${task.id} -> ${alt.worker.id}`);
      } else {
        log(`⛔ ${task.id} 达重试上限${ev.suggested_action === "replan" ? "且 Replan 已用尽" : "（临时失败）"}，定案 failed`);
        logEvent(`failed-final ${task.id}`);
      }
    }
  }
}

// ── Manager Loop ─────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(AI, { recursive: true });
  log(`orchestrator 启动  goal=${goal}  root=${ROOT}`);
  logEvent(`start goal=${goal}`);

  let { tasks, state, registry } = load();
  tasks = await plan(tasks, state, registry);
  let all = tasks.tasks;

  // ── V0.4-A：Plan Precheck（失败→结构化错误不执行；架构预留 Replanning） ──
  const pre = precheckPlan(tasks, registry);
  if (!pre.ok) {
    log("❌ Plan Precheck 失败，拒绝执行：");
    for (const e of pre.errors) log(`  [${e.code}] ${e.taskId}: ${e.message}`);
    writeJsonAtomic(path.join(AI, "precheck.json"), { ok: false, errors: pre.errors, checkedAt: nowIso() });
    logEvent(`precheck-fail ${pre.errors.map((e) => e.code).join(",")}`);
    state.phase = "precheck-failed";
    state.precheckErrors = pre.errors;
    save(tasks, state);
    log("（架构预留 Replanning 接入点：后续版本 Manager 将据 precheck.json 修改 Plan 后重试）");
    process.exit(3);
  }
  log(`✅ Plan Precheck 通过（${all.length} 任务）`);
  logEvent(`precheck-pass ${all.length} tasks`);

  // DAG 环检测（precheck 已含，保留为双保险）
  const seen = new Set();
  const visit = (id, stack) => {
    if (stack.has(id)) { logEvent(`DAG 环检测失败: ${id}`); return false; }
    if (seen.has(id)) return true;
    seen.add(id);
    const t = all.find((x) => x.id === id);
    if (!t) return true;
    return (t.dependencies || []).every((d) => visit(d, new Set([...stack, id])));
  };
  const acyclic = all.every((t) => visit(t.id, new Set()));
  if (!acyclic) { log("❌ DAG 存在环，中止"); logEvent("DAG cycle abort"); process.exit(2); }

  let rounds = 0;
  const ctx = buildContext();

  while (rounds < Math.min(maxRounds, MAX_ROUNDS)) {
    rounds++;
    // 计算各任务状态（写回）
    for (const t of all) t.status = computeStatus(t, all);
    const ready = all.filter((t) => t.status === "ready");
    const blocked = all.filter((t) => t.status === "blocked");
    const running = all.filter((t) => t.status === "running");
    const done = all.filter((t) => t.status === "completed").length;

    if (ready.length === 0) {
      if (running.length) { log(`等待 running 任务（不应出现，stale 已恢复）`); break; }
      if (blocked.length) { log(`存在 blocked 任务：${blocked.map((t) => t.id + ":" + t.failure_reason).join("; ")}`); }
      const allDone = all.every((t) => ["completed", "failed", "cancelled"].includes(t.status));
      if (allDone || blocked.length) break;
      log(`无 ready 任务（pending=${all.filter((t) => t.status === "pending").length} blocked=${blocked.length}），退出循环`);
      break;
    }

    if (ready.length > 1) log(`检测到 ${ready.length} 个可并行任务（${ready.map((t) => t.id).join(",")}）`);

    // ── P0-04：构建无文件冲突的并行批次（冲突任务串行化，留到下轮） ──
    const batch = [];
    for (const t of ready) {
      if (batch.length >= MAX_PARALLEL) break;
      if (batch.some((b) => hasFileConflict(b, t))) {
        log(`⚠️ ${t.id} 与批次内 ${batch.map((b) => b.id).join("/")} 文件冲突，串行化（下轮执行）`);
        logEvent(`conflict-serial ${t.id} vs ${batch.map((b) => b.id).join("/")}`);
        continue;
      }
      batch.push(t);
    }
    log(`▶ 并行批次: ${batch.map((t) => t.id).join(" + ")}（并发 ${batch.length}/${MAX_PARALLEL}）`);
    logEvent(`batch-start ${batch.map((t) => t.id).join("+")}`);

    // 真并行：批次内各任务独立 executor 进程并发执行，结果各自收集（统一 Result）
    await Promise.all(batch.map((task) => runTask(task, registry, ctx, tasks, state)));
    all = tasks.tasks; // Replan 可能替换任务数组，刷新引用
    logEvent(`batch-end ${batch.map((t) => t.id).join("+")}`);
    // 先落盘（tasks/state 最新，phase 先更新），再刷新 Memory + State Summary（幂等，失败隔离；顺序保证 Distiller 读到最终状态）
    state.phase = done === all.length ? "done" : "running";
    save(tasks, state);
    await refreshMemoryAndState();
  }

  // 最终汇总
  const summary = all.map((t) => `${t.id}:${t.status}${t.retry_count ? `(retry${t.retry_count})` : ""}`).join(" ");
  log(`=== 最终: ${summary} ===`);
  logEvent(`finish rounds=${rounds} calls=${workerCalls} ${summary}`);
  state.phase = all.every((t) => t.status === "completed") ? "done" : "partial";
  state.lastRunAt = nowIso();
  save(tasks, state);
  await refreshMemoryAndState(); // V0.5-P0-04：最终态（phase=done）落盘后再刷新一次，summary 反映最终状态
  // V0.4-C：基于 Run 记录生成验收报告（无需翻日志/文件）
  try {
    const runsDir = RUNS_DIR();
    const lines = [];
    if (fs.existsSync(path.join(runsDir, "runs.jsonl"))) {
      for (const l of fs.readFileSync(path.join(runsDir, "runs.jsonl"), "utf-8").split("\n")) {
        if (!l.trim()) continue;
        try { const r = JSON.parse(l); lines.push(`- **${r.taskId}** [${r.status}] agent=${r.agent} backend=${r.backend} files=${(r.filesChanged || []).join(",") || "无"}${r.review ? ` review=${r.review.verdict}` : ""}${r.outOfScope.length ? ` ⚠️超Scope:${r.outOfScope.join(",")}` : ""}`); } catch { /* 忽略 */ }
      }
    }
    const msgs = (() => { const d = MSG_DIR(); if (!fs.existsSync(d)) return "（无消息）"; const ms = fs.readdirSync(d).filter((f) => f.endsWith(".json")); return ms.length ? ms.map((f) => { try { const m = JSON.parse(stripBom(fs.readFileSync(path.join(d, f), "utf-8"))); return `- [${m.from_agent_id}→${m.to_agent_id || m.to_task_id || "any"}] ${m.subject}: ${String(m.body || "").slice(0, 120)}`; } catch { return ""; } }).filter(Boolean).join("\n") : "（无消息）"; })();
    const report = `# 执行验收报告（${nowIso()}）\n\n## 目标\n${goal}\n\n## Run 记录\n${lines.join("\n") || "（无）"}\n\n## Agent 消息\n${msgs}\n\n## 任务终态\n${summary}\n`;
    writeJsonAtomic(path.join(AI, "report.md"), report);
    log(`验收报告已生成 → ${path.join(AI, "report.md")}`);
  } catch (e) { logEvent(`report 生成失败: ${e.message}`); }
  log(`状态已保存 → ${TASKS_FILE}`);
}

main().catch((e) => { console.error("orchestrator 崩溃:", e); logEvent(`crash ${e.stack}`); process.exit(1); });