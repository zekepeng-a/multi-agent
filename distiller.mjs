/**
 * distiller.mjs —— V0.5-P0-01 Memory Distiller
 *
 * 原则：原始日志是真相（Source of Truth）；Memory 是派生的、可重建的产物。
 * 本模块从不修改 runs/messages/reviews/evaluations/consultations/results。
 * 可重复执行：稳定 ID（type + 来源 hash）去重，删除 memory/ 后重跑可完整重建。
 *
 * 用法：node distiller.mjs --workdir <项目目录> [--verbose]
 * 输出：.ai/memory/{decisions,knowledge,lessons,agents}/*.json
 *
 * Memory Entry Schema：
 * {
 *   id: "<type>-<hash8>",
 *   type: "decision" | "knowledge" | "lesson" | "agent_memory",
 *   title, content, created_at, updated_at,
 *   source: { kind, task_id?, run_id?, agent?, file? },   // provenance；无法追溯则 kind:"unknown"
 *   agent?, task_id?, run_id?, supersedes?, tags[], confidence?
 * }
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const MEMORY_TYPES = ["decision", "knowledge", "lesson", "agent_memory"];

function nowIso() {
  return new Date().toISOString().replace("T", " ").substring(0, 19);
}
function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fallback; }
}
function writeJsonAtomic(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, p);
}
const hash8 = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 8);
const stableId = (type, ref) => `${type}-${hash8(ref)}`;

function makeEntry(type, { title, content, source, agent = null, taskId = null, runId = null, supersedes = null, tags = [], confidence = null }) {
  const now = nowIso();
  const ref = JSON.stringify({ type, title, content: String(content).slice(0, 300), source, agent });
  return {
    id: stableId(type, ref),
    type,
    title,
    content,
    created_at: now,
    updated_at: now,
    source: source && source.kind ? source : { kind: "unknown", note: "无法追溯来源（显式标记）" },
    agent,
    task_id: taskId,
    run_id: runId,
    supersedes,
    tags,
    confidence,
  };
}

/** 读取目录下所有 .json 文件（返回解析后的数组 + 文件路径） */
function readJsonDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => { try { return { data: JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")), file: path.join(dir, f) }; } catch { return null; } })
    .filter(Boolean);
}

/** 已存在的 memory id 集合（去重依据） */
function existingIds(memoryDir) {
  const ids = new Set();
  for (const [t, dirName] of [["decision", "decisions"], ["knowledge", "knowledge"], ["lesson", "lessons"], ["agent_memory", "agents"]]) {
    const dir = path.join(memoryDir, dirName);
    for (const e of readJsonDir(dir)) if (e.data && e.data.id) ids.add(e.data.id);
  }
  return ids;
}

/**
 * 提炼规则（规则/模板驱动，非 LLM）：
 * 1. Review FAIL  → lesson（来源：.ai/reviews/*.json verdict=FAIL）
 * 2. Evaluation   → lesson（来源：.ai/evaluations/*.json suggested_action=replan 或 verdict=FAIL）
 * 3. Replan       → decision（来源：.ai/tasks.json replan 记录 / .ai/results/_replan.json）
 * 4. Consultation → knowledge（来源：.ai/consultations/*.md）+ decision（若含"建议/决策"语义可并）
 * 5. Agent 统计   → agent_memory（稳定统计：完成/失败任务数、参与角色；不记录模型临时输出）
 */
export async function distill({ workdir, verbose = false }) {
  const AI = path.join(workdir, ".ai");
  const memoryDir = path.join(AI, "memory");
  const entries = [];
  const log = (m) => { if (verbose) console.log("[distill]", m); };

  // 1) Reviews → lessons
  for (const { data: rv } of readJsonDir(path.join(AI, "reviews"))) {
    if (rv && rv.verdict === "FAIL") {
      entries.push(makeEntry("lesson", {
        title: `Review 否决：${rv.taskId || "?"}`,
        content: `Review FAIL：${String(rv.reason || "").slice(0, 500)}`,
        source: { kind: "review", task_id: rv.taskId || null, file: `.ai/reviews/${rv.taskId}.json` },
        taskId: rv.taskId || null,
        tags: ["review", "fail"],
      }));
    }
  }
  // 2) Evaluations → lessons
  for (const { data: ev } of readJsonDir(path.join(AI, "evaluations"))) {
    if (ev && (ev.suggested_action === "replan" || ev.verdict === "FAIL")) {
      entries.push(makeEntry("lesson", {
        title: `任务被评估为计划问题：${ev.taskId || "?"}`,
        content: `Evaluator ${ev.verdict || "FAIL"}，action=${ev.suggested_action}：${String(ev.reason || "").slice(0, 500)}`,
        source: { kind: "evaluation", task_id: ev.taskId || null, file: `.ai/evaluations/${ev.taskId}.json` },
        taskId: ev.taskId || null,
        tags: ["evaluation", "replan-signal"],
      }));
    }
  }
  // 3) Replan → decisions（从 tasks.json replan_count + 任务变更）
  const tasks = readJson(path.join(AI, "tasks.json"), { replan_count: 0, tasks: [] });
  if (tasks.replan_count) {
    const changed = (tasks.tasks || []).filter((t) => t.retry_count && t.status === "completed").map((t) => t.id);
    entries.push(makeEntry("decision", {
      title: `计划修订 #${tasks.replan_count}`,
      content: `Replan #${tasks.replan_count}：${changed.join(", ") || "相关任务"} 被修改后重新执行（局部重规划，保留已完成任务）`,
      source: { kind: "replan", file: ".ai/tasks.json" },
      tags: ["replan", "planning"],
      supersedes: tasks.replan_count > 1 ? `decision-${tasks.replan_count - 1}` : null,
    }));
  }
  // 4) Consultations → knowledge
  const consDir = path.join(AI, "consultations");
  if (fs.existsSync(consDir)) {
    for (const f of fs.readdirSync(consDir)) {
      if (!f.endsWith(".md")) continue;
      const text = fs.readFileSync(path.join(consDir, f), "utf-8").slice(0, 800);
      const role = f.split("-")[0] || "expert";
      entries.push(makeEntry("knowledge", {
        title: `专家意见（${role}）：${f.replace(/\.md$/, "")}`,
        content: text,
        source: { kind: "consultation", agent: role, file: `.ai/consultations/${f}` },
        agent: role,
        tags: ["consultation", role],
      }));
    }
  }
  // 5) Agent 稳定统计 → agent_memory（只记稳定统计，不记模型临时输出）
  const agentStats = {};
  for (const { data: run } of readJsonDir(path.join(AI, "runs"))) {
    if (!run || !run.agent) continue;
    agentStats[run.agent] = agentStats[run.agent] || { agent: run.agent, completed: 0, failed: 0, tasks: new Set() };
    const st = agentStats[run.agent];
    if (run.status === "completed" || run.phase === "done") st.completed++;
    else if (run.status === "failed") st.failed++;
    if (run.taskId) st.tasks.add(run.taskId);
  }
  for (const st of Object.values(agentStats)) {
    entries.push(makeEntry("agent_memory", {
      title: `Agent 统计：${st.agent}`,
      content: `完成 ${st.completed} 个 run，失败 ${st.failed} 个，涉及任务 ${st.tasks.size} 个（稳定统计；模型临时输出不进入 Agent Memory）`,
      source: { kind: "runs", agent: st.agent, file: ".ai/runs/" },
      agent: st.agent,
      tags: ["agent-stats"],
    }));
  }

  // ── P0-04-FIX：ID 归一化 + 聚合写入 ─────────────────────────────────────────
  // 确定性失败模式签名（同模式归一，无 LLM）
  const normalizePatternKey = (reason) => {
    const s = String(reason || "");
    const consts = (s.match(/[A-Z][A-Z0-9_]{2,}/g) || []).map((c) => c.replace(/_\d+$/, ""));
    if (consts.length) return consts.join("|");
    if (s.includes("review-fail")) return "review-fail";
    if (s.includes("验收未通过")) return "validation-fail";
    if (s.includes("timeout") || s.includes("超时")) return "timeout";
    if (s.includes("non_zero_exit") || s.includes("退出码")) return "non-zero-exit";
    return "unknown";
  };
  const normAgent = (a) => String(a || "unknown").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  for (const e of entries) {
    if (e.type === "lesson") {
      const pattern = normalizePatternKey(e.source?.kind === "review" ? `${e.source.kind}:${e.content}` : e.content);
      e.pattern = pattern;
      e.id = `lesson-${hash8(`${e.task_id || e.source?.task_id || "?"}:${pattern}`)}`; // 稳定失败模式 ID
    } else if (e.type === "agent_memory") {
      e.id = `agent_memory-${normAgent(e.agent)}`; // per-agent 稳定 ID
    }
  }

  // 写入：decision/knowledge 幂等跳过；lesson/agent_memory 同 ID upsert（更新不新增）
  const ids = existingIds(memoryDir);
  let added = 0, updated = 0, skipped = 0;
  for (const e of entries) {
    const dirName = e.type === "decision" ? "decisions" : e.type === "knowledge" ? "knowledge" : e.type === "lesson" ? "lessons" : "agents";
    const file = path.join(memoryDir, dirName, `${e.id}.json`);
    if (fs.existsSync(file)) {
      if (e.type === "lesson" || e.type === "agent_memory") {
        const old = readJson(file, null);
        if (old) {
          if (old.content === e.content) { skipped++; continue; } // 内容未变：跳过（保持幂等，不刷 updated_at）
          old.content = e.content; old.updated_at = nowIso();
          old.recent_sources = [...(old.recent_sources || []), e.source].slice(-5); // 保留 provenance 轨迹
          writeJsonAtomic(file, old);
          updated++;
          continue;
        }
      }
      skipped++;
      continue;
    }
    writeJsonAtomic(file, e);
    ids.add(e.id);
    added++;
  }
  log(`distill 完成：新增 ${added}，更新 ${updated}，跳过重复 ${skipped}（共 ${entries.length} 候选）`);
  return { added, updated, skipped, total: entries.length };
}

// CLI 入口
const argv = process.argv.slice(2);
const wi = argv.indexOf("--workdir");
const workdir = wi >= 0 ? argv[wi + 1] : process.cwd();
const verbose = argv.includes("--verbose");
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("distiller.mjs")) {
  distill({ workdir, verbose }).then((r) => { console.log(JSON.stringify(r)); }).catch((e) => { console.error("distill 失败:", e); process.exit(1); });
}