/**
 * executors.mjs —— V0.3 P0-01 Worker Executor 抽象层
 *
 * Orchestrator 通过 Executor 与具体 Backend 解耦：
 *
 *   Orchestrator
 *     → resolveExecutor(agent.backend.type)
 *     → executor.execute(task, ctx)      // 统一 Result，不含 Backend 细节
 *     → ClaudeCodeExecutor               // spawn claude -p、超时、取消、结果标准化
 *
 * Executor Contract（对象约定）：
 *   execute(task, ctx) -> ExecutorResult      启动/管理/收集/标准化
 *   cancel(taskId) -> boolean                  取消（杀进程）
 *   getStatus(taskId) -> "running"|"done"|"cancelled"|"unknown"
 *   normalizeResult(raw, task) -> ExecutorResult
 *   normalizeError(err, task) -> {type,message,retryable}
 *
 * 统一 Result：
 *   { task_id, status:"completed|failed|cancelled", summary,
 *     modified_files[], observed_files[], tests[], issues[],
 *     error:{type,message,retryable}|null, backend, raw_backend }
 *
 * 统一 Error 类型：timeout | process_error | non_zero_exit | malformed_result
 *   | cancelled | backend_unavailable | execution_failed
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

// ── 常量（原 orchestrator 内的 worker 参数迁移至此） ─────────────────────────
const WORKER_CMD = process.env.DSH_ORCH_WORKER || "claude";
const WORKER_TOOLS = "Read,Glob,Grep,Write,Edit"; // 沙箱内可用集（Bash EPERM 挂死，禁用）
const DEFAULT_TASK_TIMEOUT_MS = 12 * 60 * 1000;
const RESULT_POLL_MS = 4000;

export const ERROR_TYPES = Object.freeze({
  TIMEOUT: "timeout",
  PROCESS_ERROR: "process_error",
  NON_ZERO_EXIT: "non_zero_exit",
  MALFORMED_RESULT: "malformed_result",
  CANCELLED: "cancelled",
  BACKEND_UNAVAILABLE: "backend_unavailable",
  EXECUTION_FAILED: "execution_failed",
});

export function normalizeError(err, taskId = "") {
  const e = err || {};
  const msg = e?.message || String(e) || "unknown";
  const low = msg.toLowerCase();
  // 按语义归一化（不依赖 Backend 错误字符串，此处仅兜底归类）
  if (e.type && Object.values(ERROR_TYPES).includes(e.type)) return { type: e.type, message: msg, retryable: e.retryable !== false };
  if (low.includes("timeout") || low.includes("timed out")) return { type: ERROR_TYPES.TIMEOUT, message: msg, retryable: true };
  if (low.includes("enoent") || low.includes("spawn")) return { type: ERROR_TYPES.BACKEND_UNAVAILABLE, message: msg, retryable: false };
  if (low.includes("cancelled") || low.includes("aborted")) return { type: ERROR_TYPES.CANCELLED, message: msg, retryable: false };
  return { type: ERROR_TYPES.EXECUTION_FAILED, message: msg, retryable: true };
}

function emptyResult(task) {
  return {
    task_id: task?.id || "?",
    status: "failed",
    summary: "",
    modified_files: [],
    observed_files: [],
    tests: [],
    issues: [],
    error: null,
    backend: task?.backendType || "unknown",
    raw_backend: null,
  };
}

/** 公共：Backend 原始结果 → 统一 Result（Claude 与 DSH 共用同一结果文件契约） */
function normalizeResult(raw, task) {
  const out = emptyResult(task);
  out.status = raw?.status === "completed" ? "completed" : "failed";
  out.summary = raw?.summary || (out.status === "completed" ? "完成" : "worker 报告失败");
  out.modified_files = Array.isArray(raw?.modified_files) ? raw.modified_files : [];
  out.observed_files = Array.isArray(raw?.observed_files) ? raw.observed_files : [];
  out.tests = Array.isArray(raw?.tests) ? raw.tests : [];
  out.issues = Array.isArray(raw?.issues) ? raw.issues : [];
  out.backend = task?.backendType || "unknown";
  out.raw_backend = raw;
  if (out.status === "failed") {
    out.error = { type: ERROR_TYPES.EXECUTION_FAILED, message: out.summary, retryable: true };
  }
  return out;
}

/** 公共：spawn + 结果文件信令 + 超时/exit 检测（两个 Executor 共享的执行骨架） */
async function executeWithResultFile(task, ctx, { spawnFn, timeoutMs, pollMs = 4000, backendLabel }) {
  const workspace = ctx?.workspace || process.cwd();
  const resultsDir = ctx?.resultsDir || path.join(workspace, ".ai", "results");
  const resFile = path.join(resultsDir, `${task.id}.json`);
  const out = emptyResult(task);

  fs.mkdirSync(resultsDir, { recursive: true });
  fs.rmSync(resFile, { force: true });

  let child;
  try {
    child = spawnFn();
  } catch (e) {
    out.error = normalizeError(e, task.id);
    out.summary = `backend 启动失败: ${e.message}`;
    return out;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(resFile)) break;
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  const timedOut = !fs.existsSync(resFile) && child.exitCode === null;
  if (timedOut) {
    try { child.kill("SIGKILL"); } catch { /* 已退出 */ }
    out.status = "failed";
    out.error = { type: ERROR_TYPES.TIMEOUT, message: `${backendLabel} 超时(${timeoutMs / 60000}min)`, retryable: true };
    out.summary = out.error.message;
    return out;
  }
  if (!fs.existsSync(resFile)) {
    const code = child.exitCode;
    out.status = "failed";
    if (code !== 0 && code !== null) {
      out.error = { type: ERROR_TYPES.NON_ZERO_EXIT, message: `${backendLabel} 退出码 ${code}，无结果文件`, retryable: true };
    } else {
      out.error = { type: ERROR_TYPES.PROCESS_ERROR, message: `${backendLabel} 退出(code=${code})未产出结果文件`, retryable: true };
    }
    out.summary = out.error.message;
    return out;
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(resFile, "utf-8"));
  } catch (e) {
    // 竞态修复：结果文件刚出现但可能半写（worker 仍在写入）→ 短等重试 3 次（各 1s）再判 malformed
    let parsed = null;
    for (let i = 0; i < 3 && parsed === null; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try { parsed = JSON.parse(fs.readFileSync(resFile, "utf-8")); } catch { /* 仍半写 */ }
    }
    if (parsed === null) {
      out.status = "failed";
      out.error = { type: ERROR_TYPES.MALFORMED_RESULT, message: `结果文件非法 JSON: ${e.message}`, retryable: true };
      out.summary = out.error.message;
      return out;
    }
    raw = parsed;
  }
  return normalizeResult(raw, task);
}

// ── ClaudeCodeExecutor ──────────────────────────────────────────────────────
export class ClaudeCodeExecutor {
  constructor(options = {}) {
    this.cmd = options.cmd || WORKER_CMD;
    this.tools = options.tools || WORKER_TOOLS;
    this.timeoutMs = options.timeoutMs || DEFAULT_TASK_TIMEOUT_MS;
    this.maxTurns = options.maxTurns || 60;
    this._active = new Map(); // taskId -> child
  }

  /** 启动/管理/收集 Claude Code 执行，返回统一 Result（Backend 细节不泄漏给 Orchestrator） */
  async execute(task, ctx) {
    const taskId = task.id;
    const workspace = ctx?.workspace || process.cwd();
    const prompt = ctx?.contract || task.description || "执行任务";
    // Model Binding：模型来自 Agent Profile（人工指定），Executor 只负责传参
    const args = ["-p", prompt, "--max-turns", String(this.maxTurns), "--allowedTools", this.tools];
    if (ctx?.model) args.push("--model", ctx.model);

    const result = await executeWithResultFile(task, ctx, {
      timeoutMs: this.timeoutMs,
      backendLabel: "claude",
      spawnFn: () => {
        const child = spawn(this.cmd, args, { cwd: workspace, stdio: "ignore" });
        this._active.set(taskId, child);
        child.on("error", () => this._active.delete(taskId));
        return child;
      },
    });
    this._active.delete(taskId);
    return result;
  }

  /** 取消（杀进程）。Orchestrator 目前无取消入口，此接口供未来 Hook/审批使用 */
  cancel(taskId) {
    const child = this._active.get(taskId);
    if (!child) return false;
    try { child.kill("SIGKILL"); } catch { /* 已退出 */ }
    this._active.delete(taskId);
    return true;
  }

  getStatus(taskId) {
    if (!this._active.has(taskId)) return "unknown";
    const child = this._active.get(taskId);
    return child.exitCode === null ? "running" : "done";
  }
}

// ── DSHHeadlessExecutor（P0-02：DSH Agent 纳入统一 Executor） ───────────────
// 后端：node <dsh>/lib/bin.js --profile headless "任务"（真实 DSH Agent 会话，standard preset，DeepSeek 脑）
const DEFAULT_DSH_ENTRY = "C:\\Users\\ADMIN\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js";

export class DSHHeadlessExecutor {
  constructor(options = {}) {
    this.entry = options.entry || process.env.DSH_ORCH_DSH_ENTRY || DEFAULT_DSH_ENTRY;
    this.timeoutMs = options.timeoutMs || 15 * 60 * 1000; // headless 每次全新会话，给足时间
    this._active = new Map();
  }

  async execute(task, ctx) {
    const taskId = task.id;
    const workspace = ctx?.workspace || process.cwd();
    const prompt = `${ctx?.contract || task.description || "执行任务"}\n\n完成后用 Write 工具把结果 JSON 写入 ${path.join(ctx?.resultsDir || path.join(workspace, ".ai", "results"), taskId + ".json")}（结构：{"status":"completed|failed","summary":"…","modified_files":[],"tests":[],"issues":[],"recommendations":[]}，不要 markdown 代码块）。不要修改 .ai/tasks.json 与 .ai/state.json（调度器负责）。`;

    const result = await executeWithResultFile(task, ctx, {
      timeoutMs: this.timeoutMs,
      backendLabel: "dsh-headless",
      spawnFn: () => {
        const child = spawn(process.execPath, [this.entry, "--profile", "headless", prompt], { cwd: workspace, stdio: "ignore" });
        this._active.set(taskId, child);
        child.on("error", () => this._active.delete(taskId));
        return child;
      },
    });
    this._active.delete(taskId);
    return result;
  }

  cancel(taskId) {
    const child = this._active.get(taskId);
    if (!child) return false;
    try { child.kill("SIGKILL"); } catch { /* 已退出 */ }
    this._active.delete(taskId);
    return true;
  }

  getStatus(taskId) {
    if (!this._active.has(taskId)) return "unknown";
    const child = this._active.get(taskId);
    return child.exitCode === null ? "running" : "done";
  }
}

// ── CodexExecutor（P0-03：Codex CLI 接入统一 Executor；沙箱认证受限，见验收报告） ──
// 后端：codex exec <prompt> --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox [-m <model>]
const CODEX_CMD = process.env.DSH_ORCH_CODEX || "codex";

export class CodexExecutor {
  constructor(options = {}) {
    this.cmd = options.cmd || CODEX_CMD;
    this.timeoutMs = options.timeoutMs || 15 * 60 * 1000;
    this._active = new Map();
  }

  async execute(task, ctx) {
    const taskId = task.id;
    const workspace = ctx?.workspace || process.cwd();
    const prompt = `${ctx?.contract || task.description || "执行任务"}\n\n完成后用 Write 工具把结果 JSON 写入 ${path.join(ctx?.resultsDir || path.join(workspace, ".ai", "results"), taskId + ".json")}（结构：{"status":"completed|failed","summary":"…","modified_files":[],"tests":[],"issues":[],"recommendations":[]}，不要 markdown 代码块）。不要修改 .ai/tasks.json 与 .ai/state.json（调度器负责）。`;

    const result = await executeWithResultFile(task, ctx, {
      timeoutMs: this.timeoutMs,
      backendLabel: "codex",
      spawnFn: () => {
        const args = ["exec", prompt, "--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox"];
        if (ctx?.model) args.push("-m", ctx.model); // Model Binding：来自 Agent Profile（人工指定）
        const child = spawn(this.cmd, args, { cwd: workspace, stdio: "ignore" });
        this._active.set(taskId, child);
        child.on("error", () => this._active.delete(taskId));
        return child;
      },
    });
    this._active.delete(taskId);
    return result;
  }

  cancel(taskId) {
    const child = this._active.get(taskId);
    if (!child) return false;
    try { child.kill("SIGKILL"); } catch { /* 已退出 */ }
    this._active.delete(taskId);
    return true;
  }

  getStatus(taskId) {
    if (!this._active.has(taskId)) return "unknown";
    const child = this._active.get(taskId);
    return child.exitCode === null ? "running" : "done";
  }
}

// ── Executor Factory / Resolver ─────────────────────────────────────────────
const REGISTRY = new Map([
  ["claude-code", () => new ClaudeCodeExecutor()],
  ["claude-p", () => new ClaudeCodeExecutor()], // 兼容旧 backend.type
  ["dsh-headless", () => new DSHHeadlessExecutor()], // P0-02：DSH Agent（node dsh lib/bin.js --profile headless）
  ["codex", () => new CodexExecutor()], // P0-03：Codex CLI（沙箱认证受限，见验收报告）
]);

export function registerExecutor(type, factory) {
  REGISTRY.set(type, factory);
}

export function resolveExecutor(backendType, fallbackType = "claude-code") {
  const key = backendType || fallbackType;
  const factory = REGISTRY.get(key) || REGISTRY.get(fallbackType);
  if (!factory) throw new Error(`no executor for backend type: ${key}`);
  return factory();
}

// ── 未来 Executor 占位（不实现，仅声明可扩展点） ─────────────────────────────
export const FUTURE_EXECUTORS = [
  { type: "dsh-subagent", note: "orchestrator 外部进程无 DSH subagent API（仅会话内可用）" },
  { type: "doubao", note: "GUI 无 headless 接口" },
  { type: "opencode", note: "已逐出" },
];