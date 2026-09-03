/**
 * state-summary.mjs —— V0.5-P0-03 Project State Summary 生成器
 *
 * 生成 .ai/state.summary.md：当前项目状态的可读摘要（派生数据）。
 * 原始数据（tasks/runs/reviews/evaluations/memory/project.md）是 Source of Truth，
 * 本模块只读它们，从不修改；summary 可删除重建（幂等生成）。
 *
 * 用法：node state-summary.mjs --workdir <dir>  或  编程调用 generateStateSummary({workdir})
 */
import fs from "node:fs";
import path from "node:path";

function nowIso() {
  return new Date().toISOString().replace("T", " ").substring(0, 19);
}
function readJson(p, fb) {
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch { return fb; }
}
function readMemory(memoryDir, sub) {
  const dir = path.join(memoryDir, sub);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")); } catch { return null; }
  }).filter(Boolean);
}

/**
 * 生成 Project State Summary。
 * @param {object} opts
 * @param {string} opts.workdir 项目目录
 * @param {boolean} [opts.write] 是否写入 .ai/state.summary.md（默认 true）
 * @returns {string} Markdown 内容
 */
export function generateStateSummary({ workdir, write = true }) {
  const AI = path.join(workdir, ".ai");
  const memoryDir = path.join(AI, "memory");
  const tasks = readJson(path.join(AI, "tasks.json"), { goal: "", tasks: [], replan_count: 0 });
  const state = readJson(path.join(AI, "state.json"), { phase: "unknown" });
  const project = fs.existsSync(path.join(AI, "project.md")) ? fs.readFileSync(path.join(AI, "project.md"), "utf-8").slice(0, 500) : "";
  const decisions = readMemory(memoryDir, "decisions");
  const lessons = readMemory(memoryDir, "lessons");
  const all = tasks.tasks || [];
  const completed = all.filter((t) => t.status === "completed").map((t) => t.id);
  const active = all.filter((t) => ["pending", "running", "ready"].includes(t.status)).map((t) => `${t.id}(${t.status})`);
  const failed = all.filter((t) => t.status === "failed" || t.status === "blocked").map((t) => `${t.id}: ${t.failure_reason || t.status}`);
  const readyNext = all
    .filter((t) => ["pending", "ready"].includes(t.status))
    .filter((t) => (t.dependencies || []).every((d) => { const x = all.find((y) => y.id === d); return !x || x.status === "completed"; }))
    .map((t) => t.id);
  const md = [
    `# Project State Summary`,
    `> 派生数据：由 tasks/runs/reviews/evaluations/memory 生成，可删除后重建。生成时间 ${nowIso()}`,
    `## Project Goal`,
    project.split("\n")[0] || tasks.goal || "(无)",
    `## Current Status`,
    `phase=${state.phase}; 任务 ${completed.length}/${all.length} 完成${tasks.replan_count ? `; replan #${tasks.replan_count}` : ""}`,
    `## Completed Tasks`,
    completed.join(", ") || "(无)",
    `## Active Tasks`,
    active.join(", ") || "(无)",
    `## Important Decisions`,
    decisions.slice(-5).map((d) => `- ${d.title}`).join("\n") || "(无)",
    `## Known Problems`,
    failed.join("; ") || "(无)",
    `## Recent Lessons`,
    lessons.slice(-5).map((l) => `- ${l.title}: ${String(l.content).slice(0, 120)}`).join("\n") || "(无)",
    `## Current Agent / Task 状态`,
    all.filter((t) => t.assigned_agent).map((t) => `- ${t.id} → ${t.assigned_agent} [${t.status}]`).join("\n") || "(无)",
    `## Next Recommended Actions`,
    readyNext.join(", ") || "(无)",
  ].join("\n\n");
  if (write) fs.writeFileSync(path.join(AI, "state.summary.md"), md, "utf-8");
  return md;
}

const argv = process.argv.slice(2);
const wi = argv.indexOf("--workdir");
const workdir = wi >= 0 ? argv[wi + 1] : process.cwd();
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("state-summary.mjs")) {
  try { const md = generateStateSummary({ workdir }); console.log(`state.summary.md 已生成（${md.length} 字符）→ ${path.join(workdir, ".ai", "state.summary.md")}`); }
  catch (e) { console.error("生成失败:", e.message); process.exit(1); }
}