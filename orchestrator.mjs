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
import { fileURLToPath } from "node:url";
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

// 注：goal 缺失的校验在 main() 内执行（避免被 import 时（如单元测试）触发 process.exit）

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
/**
 * 阶段1（专家判断）输出的语义完成判据：对象且含 goal_understanding 或 expert_consultations。
 * 用于避免把「文件已稳定但内容仍为空对象」当作完成（Bug #7 同类问题）。
 */
export function semanticConsultationsComplete(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  if (Array.isArray(parsed.expert_consultations)) return true;
  return typeof parsed.goal_understanding === "string" && parsed.goal_understanding.trim().length > 0;
}

async function runPlannerStage(prompt, resFile, isComplete = null) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.rmSync(resFile, { force: true });
  const child = spawn(WORKER_CMD, ["-p", prompt, "--max-turns", "30", "--allowedTools", WORKER_TOOLS], { cwd: ROOT, stdio: "ignore" });
  child.on("error", (e) => logEvent(`planner: spawn 失败 ${e.message}`));
  const deadline = Date.now() + 7 * 60 * 1000; // 阶段2 含专家意见上下文，给足时间
  // Bug #4 修复：等待文件写完（大小稳定）再解析，避免读到半写内容而误判「未产出」
  // Bug #7 修复：叠加语义完成谓词——文件稳定 ≠ 内容完成（如 {tasks:[]} 之类的中间态需继续等待）
  // Bug #8 修复：陈旧非法 JSON 提前失败（区分于"仍在写入"，不再空等 deadline）；仅增加错误分类
  let staleInfo = null;
  const raw = await waitForStableJson(resFile, deadline, {
    ...(isComplete ? { isComplete } : {}),
    onStaleInvalid: (info) => { staleInfo = info; },
  });
  if (raw === null) {
    if (staleInfo) {
      // 文件已长期稳定但内容永久非法 → 提前放弃（旧行为：空等至 420s deadline）
      logEvent(`planner-output-invalid ${path.basename(resFile)} size=${staleInfo.size} invalidStable=${staleInfo.invalidStable} elapsed=${(staleInfo.elapsedMs / 1000).toFixed(1)}s`);
    } else if (Date.now() >= deadline) {
      logEvent(`planner-output-timeout ${path.basename(resFile)}（deadline 到期仍未获得可用输出）`);
    } else if (fs.existsSync(resFile)) {
      logEvent(`planner: ${path.basename(resFile)} 存在但无法解析（放弃）`);
    }
    return null;
  }
  if (Array.isArray(raw)) return raw; // 数组格式（如 replan 输出）
  return raw; // 对象格式（plan/consultations）
}

/**
 * 规范化验收命令（Bug #6 修复；确定性规则，不调用 LLM）。
 *
 * 背景：Planner 常在 `run:` 后附加自然语言说明，例如
 *   `node scripts/x.test.mjs（exit 0，佐证本任务未触碰任何代码）`
 * 整串执行会得到 `Cannot find module '...（exit'`，使实际已完成的任务验收必败。
 *
 * 规则（引号感知）：
 *  1) 仅在**引号外**识别说明起点：中文字符/全角标点、或「前有空白且非 shell 语法的 `(`」
 *  2) 从说明起点截断，保留其前的真实命令
 *  3) 引号内的中文/括号/参数一律保留（不破坏合法命令）
 *  4) 校验：空命令、引号不配对、剥离后仍含裸中文 → invalid（拒绝执行并给出结构化错误）
 *
 * @param {string} raw 原始验收条目（run: 之后的内容）
 * @returns {{valid:boolean, command:string, raw:string, stripped:string|null, code?:string, reason?:string}}
 */
export function normalizeRunCommand(raw) {
  const original = String(raw == null ? "" : raw);
  const text = original.trim();
  if (text === "") return { valid: false, command: "", raw: original, stripped: null, code: "empty_command", reason: "验收命令为空" };

  // 引号感知扫描：返回引号外文本（用于判定与校验）、引号是否配对、说明起点
  const scan = (s, findCut) => {
    let inSingle = false, inDouble = false, inBacktick = false;
    let outside = "";
    let cutAt = -1;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      const prev = i > 0 ? s[i - 1] : "";
      if (ch === "\\" && !inSingle) { i++; outside += " "; continue; } // 转义：跳过下一字符
      if (ch === "'" && !inDouble && !inBacktick) { inSingle = !inSingle; continue; }
      if (ch === '"' && !inSingle && !inBacktick) { inDouble = !inDouble; continue; }
      if (ch === "`" && !inSingle) { inBacktick = !inBacktick; continue; }
      if (inSingle || inDouble || inBacktick) { outside += " "; continue; } // 引号内一律保留（不参与判定）
      if (findCut && cutAt < 0) {
        const isCjk = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch);
        const isHalfParenWithSpace = ch === "(" && /\s/.test(prev);
        if (isCjk || isHalfParenWithSpace) cutAt = i;
      }
      outside += ch;
    }
    return { outside, unbalanced: inSingle || inDouble || inBacktick, cutAt };
  };

  const first = scan(text, true);
  let command = text;
  let stripped = null;
  if (first.cutAt >= 0) {
    stripped = text.slice(first.cutAt).trim();
    command = text.slice(0, first.cutAt).trim().replace(/[;,、]+$/, "").trim();
  }

  const second = scan(command, false); // 截断后重新扫描（校验只看引号外）
  if (second.unbalanced) return { valid: false, command, raw: original, stripped, code: "unbalanced_quotes", reason: "命令引号不配对" };
  if (command === "") return { valid: false, command: "", raw: original, stripped, code: "empty_after_strip", reason: "剥离说明文字后命令为空" };
  // 引号外仍含自然语言（中文/全角）→ 拒绝执行（引号内的中文是合法参数，不在此列）
  if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(second.outside)) {
    return { valid: false, command, raw: original, stripped, code: "non_command_text", reason: "命令中仍含自然语言文本" };
  }
  return { valid: true, command, raw: original, stripped };
}

/**
 * 分类 Reviewer 执行结果（V0.5.3：区分「进程/基础设施失败」与「真实 verdict FAIL」）。
 * 安全语义不变：任何非 verdict 结果都不得 PASS。
 * @returns {{kind:"verdict"|"process_failure"|"timeout"|"invalid_verdict", verdict?:object, code:string, reason:string, detail:string}}
 */
export function classifyReviewOutcome({ exitCode = null, timedOut = false, raw = null, resFileExists = false, stderrTail = "" } = {}) {
  const valid = raw && (raw.verdict === "PASS" || raw.verdict === "FAIL");
  if (valid) return { kind: "verdict", verdict: raw, code: "ok", reason: "有效 verdict", detail: "" };
  if (resFileExists && raw && !valid) return { kind: "invalid_verdict", code: "invalid_verdict", reason: "Reviewer 产出的 verdict 非法（既非 PASS 也非 FAIL）", detail: String(raw.verdict || raw).slice(0, 200) };
  if (timedOut) return { kind: "timeout", code: "review_timeout", reason: "Reviewer 超时未产出 verdict", detail: "" };
  if (exitCode === null) return { kind: "process_failure", code: "review_process_nofile", reason: "Reviewer 进程未产出结果文件且未正常退出", detail: String(stderrTail).slice(-300) };
  return { kind: "process_failure", code: "review_process_exit", reason: `Reviewer 进程异常退出（exit ${exitCode}）且无结果文件`, detail: String(stderrTail).slice(-300) };
}

/**
 * 严格解析 JSON 文件（剥离 BOM；失败时尝试从文本中提取 JSON 对象/数组）。
 * @returns {object|Array|null} 解析结果，失败返回 null
 */
export function readJsonStrict(file) {
  try {
    const text = stripBom(fs.readFileSync(file, "utf-8"));
    try { return JSON.parse(text); } catch { /* 尝试提取 */ }
    const extracted = extractJson(text);
    // extractJson 无匹配时返回 "{}"（长度 2）——此类兜底不是真实内容，视为解析失败
    if (extracted && extracted.length > 2) {
      try { return JSON.parse(extracted); } catch { /* 仍失败 */ }
    }
    return null;
  } catch { return null; }
}

/**
 * 等待文件写完并解析为 JSON（修复 Bug #4：planner 产物半写竞态）。
 * 完成判据：文件大小连续 stableSamples 次采样不变 **且** 解析成功。
 * deadline 到期后做最后一次尝试（文件已完整但仍未达稳定判据时）。
 *
 * V0.5.4（Bug #7）：通用能力保持不变；新增可选 `isComplete(parsed)` 语义完成谓词——
 * 仅当「大小稳定 + JSON 可解析 + 语义完整」三者同时满足才返回。
 * 调用方可借此表达「文件稳定 ≠ 内容完成」（例如 Planner 输出需 tasks 非空）。
 * 谓词永不满足时，deadline 到期返回最后一次可解析的结果（由调用方决定是否降级）。
 *
 * V0.5.5（Bug #8）：新增「陈旧非法 JSON」判定——区分「仍在写的半写」与「已停止变化但内容永久非法」：
 *  - 文件大小**发生变化** ⇒ 视为仍在写入：重置非法计数（完整保留 Bug #4 半写保护）
 *  - 大小稳定且解析失败 ⇒ 累计 invalidStable；达到 invalidStableSamples 仍非法
 *    ⇒ 判定 `stale_invalid_json`，**提前返回 null**（不再空等 deadline），并通过 onStaleInvalid
 *    回调报告原因（错误分类；不改变调用方既有的失败/降级语义，不引入新重试）
 *  - 「合法但语义未完成（Bug #7）」仍继续等待，与陈旧非法互不影响
 *
 * @param {string} file
 * @param {number} deadline epoch ms
 * @param {object} [opts]
 * @param {number} [opts.pollMs=500]
 * @param {number} [opts.stableSamples=3]          大小连续不变次数（"稳定"判据）
 * @param {number} [opts.invalidStableSamples=10]  "稳定但非法"连续次数上限（stale 判据）
 * @param {Function|null} [opts.isComplete]        语义完成谓词（Bug #7）
 * @param {Function|null} [opts.onStaleInvalid]    陈旧非法回调 (info) => void
 */
export async function waitForStableJson(file, deadline, { pollMs = 500, stableSamples = 3, invalidStableSamples = parseInt(process.env.DSH_ORCH_PLANNER_INVALID_STABLE_SAMPLES || "10", 10), isComplete = null, onStaleInvalid = null } = {}) {
  const startedAt = Date.now();
  let lastSize = -1;
  let stable = 0;
  let lastParsed = null;
  let invalidStable = 0; // "大小稳定但不可解析"累计次数（文件一变化即清零 ⇒ 半写不会被误判）
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) {
      let size = 0;
      try { size = fs.statSync(file).size; } catch { size = 0; }
      if (size > 0) {
        if (size === lastSize) stable++; else { stable = 0; lastSize = size; invalidStable = 0; }
        if (stable >= stableSamples) {
          const parsed = readJsonStrict(file);
          if (parsed !== null) {
            invalidStable = 0;
            lastParsed = parsed;
            if (typeof isComplete !== "function" || isComplete(parsed)) return parsed;
          } else {
            // 大小稳定但不可解析：先按 Bug #4 继续等待；若长期稳定不变 ⇒ 陈旧非法（Bug #8）提前放弃
            invalidStable++;
            if (invalidStable >= invalidStableSamples) {
              if (typeof onStaleInvalid === "function") {
                onStaleInvalid({ reason: "stale_invalid_json", file, size, invalidStable, elapsedMs: Date.now() - startedAt });
              }
              return null;
            }
          }
          stable = 0; // 大小稳定但（不可解析 或 语义未完成）：继续等待
        }
      }
    }
    await sleep(pollMs);
  }
  return lastParsed !== null ? lastParsed : (fs.existsSync(file) ? readJsonStrict(file) : null);
}

/**
 * Planner 输出的「语义完成」判据（V0.5.4 / Bug #7）。
 * 只有同时满足下列条件才算 Planner 输出完成，可被接受：
 *  1) 顶层为对象（或为任务数组，兼容 replan 的数组形态）
 *  2) `tasks` 字段存在且为数组
 *  3) `tasks.length > 0`
 *  4) 经既有 normalizePlannedTasks 过滤后仍存在合法任务（id 为非空字符串的对象）
 * 用于区分「文件已稳定但内容是 {tasks:[]} 之类的中间态」与「真正写完」。
 */
export function semanticPlannerOutputComplete(parsed) {
  if (!parsed) return false;
  const raw = Array.isArray(parsed) ? parsed : parsed.tasks;
  if (!Array.isArray(raw) || raw.length === 0) return false;
  return normalizePlannedTasks(Array.isArray(parsed) ? { tasks: parsed } : parsed).tasks.length > 0;
}

/**
 * 规范化 Planner/Replan 输出的任务数组（修复 Bug #5：LLM 占位符字符串导致崩溃）。
 * 仅保留形如 {id: "<非空字符串>", ...} 的对象；其余记为 dropped。
 */
export function normalizePlannedTasks(parsed) {
  const raw = parsed && Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const tasks = raw.filter((t) => t && typeof t === "object" && !Array.isArray(t) && typeof t.id === "string" && t.id.trim().length > 0);
  return { tasks, dropped: raw.length - tasks.length, total: raw.length };
}

async function plan(tasks, state, registry) {
  if (tasks.tasks && tasks.tasks.length > 0) { log("tasks.json 已有任务，跳过拆解"); return tasks; }
  log("自动规划：阶段1 判断是否需要专家咨询…");

  const ctxText = buildContext();
  const stage1File = path.join(RESULTS_DIR, "_plan1.json");
  const s1 = await runPlannerStage(
    `你是 Multi-Agent 系统的 Manager。目标：${goal}\n项目目录：${ROOT}\n项目上下文：\n${ctxText}\n\n判断该目标是否需要专家意见。用 Write 工具把结果 JSON 写入 ${stage1File}（只含 JSON 对象，无 markdown）：\n{"goal_understanding":"…","expert_consultations":[{"role":"architect|analyst|researcher","topic":"…","reason":"…","required_capability":"architecture|analysis|research"}]}\n规则：仅当任务确实需要（复杂架构→architect、复杂算法→analyst、外部资料→researcher）才列；不需要则为空数组。`,
    stage1File,
    semanticConsultationsComplete
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
    stage2File,
    semanticPlannerOutputComplete
  );

  let parsed = s2;
  // Bug #5 修复：Planner 输出可能含占位符字符串（如 "__TASK007__"）或非对象元素——
  // 先离线校验与过滤，任何异常都不得让 orchestrator 崩溃（崩溃前必须能回退 DAG）。
  try {
    if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.tasks)) {
      const norm = normalizePlannedTasks(parsed);
      if (norm.dropped > 0) logEvent(`plan: 丢弃 ${norm.dropped}/${norm.total} 个非法任务元素（LLM 占位符/格式错误）`);
      parsed = { ...parsed, tasks: norm.tasks };
    } else if (Array.isArray(parsed)) {
      const norm = normalizePlannedTasks({ tasks: parsed });
      if (norm.dropped > 0) logEvent(`plan: 丢弃 ${norm.dropped}/${norm.total} 个非法任务元素（LLM 占位符/格式错误）`);
      parsed = { tasks: norm.tasks };
    }
  } catch (e) {
    logEvent(`plan: 任务规范化异常（回退 DAG）: ${e.message}`);
    parsed = null;
  }
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
  if (checks.length === 0) return { pass: true, detail: "无验收命令，默认通过", checks: [] };
  const pass = [];
  const structured = []; // V0.5.6（Bug #9）：结构化验收证据，供 Review Gate 复用（不重跑命令）
  for (const c of checks) {
    // 支持形如 `run: node test.js` / `file: src/x.js` / 普通文本说明
    let ok;
    if (c.startsWith("run:")) {
      // Bug #6 修复：先规范化（剥离自然语言说明），非法命令拒绝执行（结构化错误）；原始文本保留在 detail 便于审计
      const norm = normalizeRunCommand(c.slice(4));
      if (!norm.valid) {
        pass.push({ c, ok: false, ev: `拒绝执行[${norm.code}]: ${norm.reason}（原始: ${norm.raw.slice(0, 80)}）` });
        structured.push({ kind: "run", raw: c, command: null, exitCode: null, stdout: "", stderr: "", status: "REJECTED", reason: `${norm.code}: ${norm.reason}` });
        logEvent(`validation-reject ${task.id} ${norm.code}: ${norm.raw.slice(0, 120)}`);
        continue;
      }
      const r = runCmd(norm.command, ROOT);
      ok = r.code === 0;
      const cleaned = norm.stripped ? `（已剥离说明: ${norm.stripped.slice(0, 60)}）` : "";
      pass.push({ c, ok, ev: ok ? `exit 0${cleaned}` : `exit ${r.code}: ${r.err.slice(0, 200)}${cleaned}` });
      structured.push({
        kind: "run",
        raw: c,
        command: norm.command,
        strippedNote: norm.stripped || null,
        exitCode: typeof r.code === "number" ? r.code : null,
        stdout: String(r.out || ""),
        stderr: String(r.err || ""),
        status: ok ? "PASS" : "FAIL",
      });
    }
    else if (c.startsWith("file:")) {
      ok = fs.existsSync(path.join(ROOT, c.slice(5).trim()));
      pass.push({ c, ok, ev: ok ? "存在" : "缺失" });
      structured.push({ kind: "file", raw: c, path: c.slice(5).trim(), status: ok ? "PASS" : "FAIL", detail: ok ? "文件存在" : "文件缺失" });
    }
    else {
      pass.push({ c, ok: true, ev: "人工核对项（自动通过）" });
      structured.push({ kind: "manual", raw: c, status: "MANUAL", detail: "人工核对项（自动通过）" });
    }
  }
  return { pass: pass.every((p) => p.ok), detail: pass.map((p) => `${p.ok ? "✓" : "✗"} ${p.c} ${p.ev}`).join("; "), checks: structured };
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

/**
 * 中间截断（保留首尾最有价值信息）。
 * @returns {string}
 */
export function truncateMiddle(text, max) {
  const s = String(text == null ? "" : text);
  if (s.length <= max) return s;
  const head = Math.ceil(max * 0.65);
  const tail = Math.max(0, max - head);
  const cut = s.length - (head + tail);
  return `${s.slice(0, head)}\n…[truncated ${cut} chars]…\n${tail > 0 ? s.slice(-tail) : ""}`;
}

/**
 * 把 validateTask() 的结构化结果格式化为注入 Reviewer 的客观证据块（V0.5.6 / Bug #9）。
 *
 * 语义边界（重要）：
 *  - 本块只陈述**调度器实际执行得到的事实**（command / exit_code / stdout / stderr / status）；
 *  - 它**不构成通过结论**，不得替代 Review Gate；Reviewer 必须结合产出物与 Review 规则独立判断；
 *  - 与 Worker 自述（可能包含"未执行/失败"等描述）**并列呈现**，冲突由 Reviewer 自行裁定。
 *
 * 截断策略（确定性，无需新日志系统）：
 *  - stdout：首 65% + 尾 35%，上限 maxStdout（默认 600 字符）
 *  - stderr：同上，上限 maxStderr（默认 400 字符）
 *  - 整块上限 maxTotal（默认 2400 字符，超出则整体中间截断）
 */
export function formatValidationEvidence(validation, { maxTotal = 2400, maxStdout = 600, maxStderr = 400 } = {}) {
  if (!validation || !Array.isArray(validation.checks) || validation.checks.length === 0) return "";
  const total = validation.checks.length;
  const okCount = validation.checks.filter((c) => c.status === "PASS").length;
  const lines = [`[VALIDATION EVIDENCE（调度器实际执行结果，客观事实；与 Worker 自述独立）]`];
  lines.push(`validation_status: ${validation.pass ? "PASS" : "FAIL"}（${okCount}/${total} 项通过）`);
  lines.push(`note: 本证据不构成通过结论；请结合产出物与 Review 规则独立判断。`);
  validation.checks.forEach((c, i) => {
    lines.push("");
    lines.push(`--- 验收项 ${i + 1}/${total} ---`);
    lines.push(`criterion: ${String(c.raw || "").slice(0, 200)}`);
    if (c.kind === "run") {
      lines.push(`command: ${c.command || "(未执行：命令被拒绝)"}`);
      lines.push(`exit_code: ${c.exitCode === null ? "n/a" : c.exitCode}`);
      lines.push(`status: ${c.status}`);
      if (c.reason) lines.push(`reject_reason: ${c.reason}`);
      if (c.strippedNote) lines.push(`note: 已从原命令剥离说明文字「${String(c.strippedNote).slice(0, 80)}」`);
      if (c.stdout) lines.push(`stdout:\n${truncateMiddle(c.stdout, maxStdout)}`);
      if (c.stderr) lines.push(`stderr:\n${truncateMiddle(c.stderr, maxStderr)}`);
    } else {
      lines.push(`status: ${c.status}`);
      if (c.detail) lines.push(`detail: ${c.detail}`);
    }
  });
  return truncateMiddle(lines.join("\n"), maxTotal);
}

/**
 * 构造 Review Gate 的 Reviewer prompt（V0.5.6 / Bug #9：把调度器验收证据交给 Reviewer）。
 * 同时保留 Worker 原始报告（task.result）——两组信息并列，冲突由 Reviewer 裁定。
 */
export function buildReviewPrompt(task, validation, resFile) {
  const files = ((task.result && task.result.modified_files) || []).join(", ") || "(无文件变更)";
  const rules = (task.review_rules || []).join("; ") || "检查产出是否符合任务要求与验收标准，是否存在明显缺陷";
  const workerSummary = task.result && task.result.summary ? String(task.result.summary).slice(0, 800) : "(无)";
  const workerTests = ((task.result && task.result.tests) || []).map((t) => `${t.name || "?"}=${t.result || "?"}`).join(", ") || "(无)";
  const workerIssues = ((task.result && task.result.issues) || []).map((x) => String(x).slice(0, 200)).join("; ") || "(无)";
  const evidence = formatValidationEvidence(validation);
  return `你是 Review Gate（独立 Reviewer）。对任务 ${task.id} 的产出做严格审查。\n任务：${task.title}\n约束/验收：${(task.constraints || []).join("; ")}${(task.acceptance_criteria || []).join(" | ")}\n改动文件：${files}\nReview 规则（必须逐条检查）：${rules}\n\n[WORKER REPORT（Worker 自述，可能有误或受限；仅供参考）]\nsummary: ${workerSummary}\ntests: ${workerTests}\nissues: ${workerIssues}\n${evidence ? `\n${evidence}\n` : "\n[VALIDATION EVIDENCE]\n（本任务无已执行的验收命令，无法提供客观执行证据）\n"}\n判断要求：基于「产出物 + WORKER REPORT + VALIDATION EVIDENCE + Review 规则」独立判断；当 Worker 自述与调度器执行证据冲突时，以可复核的事实为准并在 reason 中说明。用 Read 工具读取改动文件核验。用 Write 工具把 verdict JSON 写入 ${resFile}（只含 JSON 对象，无 markdown）：{"verdict":"PASS|FAIL","reason":"…","checks":[{"name":"…","pass":true|false}]}`;
}

/** Review Gate：独立 Reviewer 对任务产出给结构化 verdict（PASS/FAIL） */
async function reviewTask(task, ctx, validation = null) {
  const resFile = path.join(RESULTS_DIR, `_review-${task.id}.json`);
  const prompt = buildReviewPrompt(task, validation, resFile);
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  // V0.5.3：Reviewer 稳定性——超时可配（默认 8 分钟，原 3 分钟对复杂评审不足）、有限重试、捕获诊断信息
  const reviewTimeoutMs = parseInt(process.env.DSH_ORCH_REVIEW_TIMEOUT_MS || String(8 * 60 * 1000), 10);
  const MAX_REVIEW_ATTEMPTS = parseInt(process.env.DSH_ORCH_REVIEW_ATTEMPTS || "2", 10);
  let outcome = null;
  for (let attempt = 1; attempt <= MAX_REVIEW_ATTEMPTS; attempt++) {
    fs.rmSync(resFile, { force: true });
    let exitCode = null;
    let exited = false;
    let stderrTail = "";
    // 原实现用 stdio:"ignore" 丢弃退出码与 stderr，导致无法区分「进程失败/超时/非法 verdict」
    const child = spawn(WORKER_CMD, ["-p", prompt, "--max-turns", "20", "--allowedTools", "Read,Glob,Grep,Write"], { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] });
    child.stderr.on("data", (d) => { stderrTail = (stderrTail + d.toString()).slice(-2000); });
    child.on("error", (e) => { stderrTail += ` [spawn error] ${e.message}`; exited = true; if (exitCode === null) exitCode = -1; });
    child.on("exit", (code) => { exitCode = code; exited = true; });
    const deadline = Date.now() + reviewTimeoutMs;
    let timedOut = false;
    while (Date.now() < deadline) {
      if (fs.existsSync(resFile)) break;
      if (exited && typeof exitCode === "number" && exitCode !== 0) break; // 异常退出：立即判定，不空等至超时
      await sleep(Math.min(RESULT_POLL_MS, 2000));
    }
    if (!fs.existsSync(resFile) && Date.now() >= deadline) timedOut = true;
    const resFileExists = fs.existsSync(resFile);
    const raw = resFileExists ? readJson(resFile, null) : null;
    outcome = classifyReviewOutcome({ exitCode, timedOut, raw, resFileExists, stderrTail });
    if (outcome.kind === "verdict") break;
    if (attempt < MAX_REVIEW_ATTEMPTS) {
      logEvent(`review-retry ${task.id} attempt=${attempt} code=${outcome.code}${outcome.detail ? ` detail=${String(outcome.detail).slice(0, 160)}` : ""}`);
    }
    try { child.kill("SIGKILL"); } catch { /* 已退出 */ }
  }
  fs.mkdirSync(REVIEWS_DIR(), { recursive: true });
  const base = { taskId: task.id, reviewedAt: nowIso(), reviewKind: outcome.kind, reviewCode: outcome.code };
  if (outcome.kind === "verdict") {
    writeJsonAtomic(path.join(REVIEWS_DIR(), `${task.id}.json`), { ...base, ...outcome.verdict });
    return { ...outcome.verdict, kind: "verdict", code: "ok", detail: "" };
  }
  // 非 verdict：结构化错误落盘。安全语义不变——绝不允许 PASS。
  const reason = `Reviewer 不可用（${outcome.code}）: ${outcome.reason}`;
  writeJsonAtomic(path.join(REVIEWS_DIR(), `${task.id}.json`), { ...base, verdict: "FAIL", reason, detail: outcome.detail || "" });
  return { verdict: "FAIL", reason, kind: outcome.kind, code: outcome.code, detail: outcome.detail || "" };
}

// ── V0.4-B：Evaluator（失败分类） + Replanning（局部重规划） ─────────────────
const MAX_REPLAN = 2;
let replanCount = 0;

/** 失败分类：临时执行失败（retry）vs 计划问题（replan）。综合全部失败历史。 */
export function evaluateFailure(task, registry) {
  const history = (task.failure_history || []).concat(task.failure_reason || "").join(" ").toLowerCase();
  let suggested = "retry";
  if (history.includes("review-unavailable")) {
    suggested = "retry"; // V0.5.3：Reviewer 基础设施失败（进程/超时/非法 verdict）→ 重试，绝不判为计划问题（避免 replan 循环）
  } else if (history.includes("backend_unavailable")) {
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
  let s2 = await runPlannerStage(prompt, resFile, semanticPlannerOutputComplete);
  if (s2 && !Array.isArray(s2) && Array.isArray(s2.tasks)) s2 = s2.tasks; // 兼容 {tasks:[...]} 包装
  // Bug #5 修复：replan 输出同样过滤非法元素（占位符/非对象），异常不得崩溃
  if (Array.isArray(s2)) {
    const norm = normalizePlannedTasks({ tasks: s2 });
    if (norm.dropped > 0) logEvent(`replan: 丢弃 ${norm.dropped}/${norm.total} 个非法任务元素（LLM 占位符/格式错误）`);
    s2 = norm.tasks;
  }
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
        const rv = await reviewTask(task, ctx, v); // V0.5.6（Bug #9）：把调度器已执行的验收证据交给 Reviewer（复用，不重跑）
        recordRun(task, "review", { review: rv, validation: { pass: v.pass, checks: v.checks }, messages, outOfScope: scopeViolations(task) });
        if (rv.kind && rv.kind !== "verdict") {
          // V0.5.3：Reviewer 基础设施失败（进程/超时/非法 verdict）。安全语义不变（绝不允许 PASS），
          // 但不用 `review-fail:` 前缀，避免被 Evaluator 判为「计划问题」而进入无意义的 retry→replan 循环。
          task.status = "failed";
          task.failure_reason = `review-unavailable: ${rv.code} ${rv.reason}`;
          task.failure_history = [...(task.failure_history || []), task.failure_reason];
          log(`⚠️ ${task.id} Review 不可用（${rv.kind}/${rv.code}）：${rv.reason}`);
          logEvent(`review-unavailable ${task.id} ${rv.kind} ${rv.code}`);
        } else if (rv.verdict === "FAIL") {
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
  if (!goal) { console.error('用法: node orchestrator.mjs "<目标>" --workdir <dir>'); process.exit(1); }
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

// 入口守卫：直接执行 `node orchestrator.mjs ...` 时运行 main()；
// 被 import（单元测试、其他模块）时不自动运行。用 argv[1] 与模块真实路径比较（比 endsWith 可靠）。
const isDirectRun = (() => {
  if (!process.argv[1]) return false;
  try { return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
})();
if (isDirectRun) {
  main().catch((e) => { console.error("orchestrator 崩溃:", e); logEvent(`crash ${e.stack}`); process.exit(1); });
}