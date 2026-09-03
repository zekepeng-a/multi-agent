/**
 * retriever.mjs —— V0.5-P0-02 Retriever（BM25-like 确定性关键词检索）
 *
 * 只读 Memory 层（.ai/memory/{decisions,knowledge,lessons,agents}），
 * 不修改任何 Memory / Run / Review / Task / 原始日志。
 * 无 embedding / 向量库 / 第三方依赖。
 *
 * 用法（可编程）：
 *   import { retrieve } from "./retriever.mjs";
 *   const results = retrieve({ query, memoryDir, topK, typeFilter });
 *
 * 输出条目：{ id, type, score, title, content, tags, provenance, source }
 */
import fs from "node:fs";
import path from "node:path";

const TYPE_DIRS = {
  decision: "decisions",
  knowledge: "knowledge",
  lesson: "lessons",
  agent_memory: "agents",
};

/** 估算字符数（Token Budget 统一入口，避免散落各处） */
export function estimateChars(s) {
  // 字符级估算（英文约 4 字符/token，中文约 1 字符/token 的保守近似）
  const str = String(s || "");
  let cjk = 0;
  for (const ch of str) if (/[\u4e00-\u9fff]/.test(ch)) cjk++;
  return Math.ceil((str.length - cjk) / 4) + cjk;
}

/** 分词：英文词（≥2）+ 中文 2-gram（确定性） */
export function tokenize(text) {
  const tokens = [];
  for (const m of String(text || "").toLowerCase().match(/[a-z0-9_]{2,}|[\u4e00-\u9fa5]{2,}/g) || []) {
    if (/[\u4e00-\u9fa5]/.test(m)) {
      for (let i = 0; i < m.length - 1; i++) tokens.push(m.slice(i, i + 2));
    } else {
      tokens.push(m);
    }
  }
  return tokens;
}

/** 加载某类型 memory 文件 */
function loadEntries(memoryDir, type) {
  const dir = path.join(memoryDir, TYPE_DIRS[type]);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const e = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
        if (!e || !e.id) return null;
        return { ...e, type, _file: path.join(dir, f) };
      } catch { return null; }
    })
    .filter(Boolean);
}

/** 确定性相关评分：title×3 + content×1 + tags×2（BM25-like 简化 TF 加权） */
export function scoreEntry(queryTokens, entry) {
  const titleTokens = tokenize(entry.title || "");
  const contentTokens = tokenize((entry.content || "") + " " + (entry.tags || []).join(" "));
  let score = 0;
  for (const q of queryTokens) {
    score += titleTokens.filter((t) => t === q).length * 3;
    score += contentTokens.filter((t) => t === q).length;
  }
  for (const tag of entry.tags || []) if (queryTokens.includes(String(tag).toLowerCase())) score += 2;
  return score;
}

/**
 * 检索：query → topK 相关 Memory 条目（按 score 降序）。
 * @param {object} opts
 * @param {string} opts.query       检索查询（当前任务 title+description）
 * @param {string} opts.memoryDir   .ai/memory 路径
 * @param {number} [opts.topK]      返回条数上限（默认 12）
 * @param {string[]} [opts.typeFilter] 仅检索这些类型（decision/knowledge/lesson/agent_memory）
 */
export function retrieve({ query, memoryDir, topK = 12, typeFilter = null }) {
  const queryTokens = tokenize(query);
  const types = typeFilter || Object.keys(TYPE_DIRS);
  const results = [];
  for (const type of types) {
    for (const entry of loadEntries(memoryDir, type)) {
      const score = scoreEntry(queryTokens, entry);
      if (score <= 0) continue; // 无关条目不进入结果（C 类被过滤）
      results.push({
        id: entry.id,
        type: entry.type,
        score,
        title: entry.title,
        content: String(entry.content || "").slice(0, 600),
        tags: entry.tags || [],
        provenance: entry.source || { kind: "unknown" },
        source: entry.source || { kind: "unknown" },
      });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}