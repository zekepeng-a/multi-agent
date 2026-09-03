/**
 * context.mjs —— V0.5-P0-02 Context Assembly + Token Budget
 *
 * 只读组装：从 Retriever 结果 + Project State 组装「与当前任务相关的」Context，
 * 在 Token Budget 内按优先级选择；不修改任何 Memory / Run / Review / Task。
 *
 * Memory Priority（在 budget 内）：
 *   1. Current Task / Current State（永不裁剪）
 *   2. Relevant Decision / Lesson（高优先；与当前任务高度相关的旧 Lesson 优先于普通 Knowledge）
 *   3. Relevant Knowledge
 *   4. Agent Memory
 */
import fs from "node:fs";
import path from "node:path";
import { retrieve, estimateChars } from "./retriever.mjs";

const TYPE_PRIORITY = { decision: 3, lesson: 3, knowledge: 2, agent_memory: 1 };
const PER_ENTRY_OVERHEAD = 80; // 标题+来源 overhead（字符估算）

/** 读取 Project State（.ai/project.md / requirements.md / architecture.md / state.json 摘要） */
function loadProjectState(workdir) {
  const AI = path.join(workdir, ".ai");
  const out = { project: "", requirements: "", architecture: "", state: "" };
  for (const [k, f] of [["project", "project.md"], ["requirements", "requirements.md"], ["architecture", "architecture.md"]]) {
    const p = path.join(AI, f);
    if (fs.existsSync(p)) out[k] = fs.readFileSync(p, "utf-8").slice(0, 1500);
  }
  try {
    const st = JSON.parse(fs.readFileSync(path.join(AI, "state.json"), "utf-8"));
    out.state = JSON.stringify({ phase: st.phase, currentTask: st.currentTask, completed: (st.completed || []).slice(-5) });
  } catch { /* 无 state */ }
  return out;
}

/**
 * 组装 Context。
 * @param {object} opts
 * @param {string} opts.workdir      项目目录
 * @param {object} opts.currentTask  当前任务 {id,title,description,required_capability}
 * @param {number} [opts.budgetChars] Token/字符预算（默认 6000）
 * @param {number} [opts.topK]       检索条数（默认 14）
 */
export function assembleContext({ workdir, currentTask, budgetChars = 6000, topK = 14 }) {
  const memoryDir = path.join(workdir, ".ai", "memory");
  const query = `${currentTask.title || ""} ${currentTask.description || ""}`;

  const results = retrieve({ query, memoryDir, topK });
  // 按优先级排序（priority desc，同级 score desc）
  results.sort((a, b) => (TYPE_PRIORITY[b.type] - TYPE_PRIORITY[a.type]) || (b.score - a.score));

  // Current Task 段（永不裁剪）
  const taskSection = `### Current Task\n- ID: ${currentTask.id || "?"}\n- Title: ${currentTask.title || "?"}\n- Capability: ${currentTask.required_capability || "?"}\n- Description: ${currentTask.description || ""}\n`;
  let used = estimateChars(taskSection);

  const byType = { decision: [], knowledge: [], lesson: [], agent_memory: [] };
  const selected = [];
  for (const r of results) {
    const cost = estimateChars(r.content) + estimateChars(r.title) + PER_ENTRY_OVERHEAD;
    if (used + cost > budgetChars) break; // 超预算裁剪（低优先级在后，先被淘汰）
    selected.push(r);
    byType[r.type].push(r);
    used += cost;
  }

  const fmt = (arr) => arr.map((r) => `- [${r.type}/${r.score}] ${r.title}\n  ${String(r.content).slice(0, 300)}\n  (来源: ${r.provenance?.kind || "unknown"} ${r.provenance?.file || ""} ${r.provenance?.task_id ? "task=" + r.provenance.task_id : ""})`).join("\n");
  const sections = {
    currentTask: taskSection,
    decisions: fmt(byType.decision),
    lessons: fmt(byType.lesson),
    knowledge: fmt(byType.knowledge),
    agentMemory: fmt(byType.agent_memory),
    projectState: `- phase: ${loadProjectState(workdir).state}`,
  };

  return {
    query,
    sections,
    usedChars: used,
    budgetChars,
    retrieved: results.length,
    selected: selected.map((r) => ({ id: r.id, type: r.type, score: r.score, provenance: r.provenance })),
    truncated: results.length - selected.length,
    projectState: loadProjectState(workdir),
  };
}