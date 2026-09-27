// file-wait.mjs —— 通用文件等待工具（**不含任何 Planner 领域知识**）
//
// R1 拆分的产物：把"等待文件出现 / 稳定 / 可解析"从 orchestrator 中抽出，
// 使其不再承担 Planner 的完成判定语义（tasks / architecture_decisions / memory_refs / 占位符 …）。
// 本模块只回答三件事：文件出现了吗？大小稳定了吗？JSON 能解析吗？
import fs from "node:fs";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 剥离 UTF-8 BOM（外部工具写文件时的常见污染） */
export function stripBom(text) {
  return String(text == null ? "" : text).replace(/^\uFEFF/, "");
}

/** 从文本中提取第一个 JSON 对象/数组（容错用；无匹配时返回 "{}"） */
export function extractJson(text) {
  const s = String(text == null ? "" : text);
  const obj = s.match(/\{[\s\S]*\}/);
  if (obj) return obj[0];
  const arr = s.match(/\[[\s\S]*\]/);
  return arr ? arr[0] : "{}";
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
 * 等待文件写完并解析为 JSON（Bug #4：半写竞态；Bug #8：陈旧非法 JSON 提前失败）。
 *
 * **通用语义**：本函数不理解内容含义。调用方可通过两个**通用扩展点**表达自身需求：
 *  - `isComplete(parsed)`：内容是否"可用"（谓词由调用方提供，工具本身不做领域判断）
 *  - `onStaleInvalid(info)`：长期稳定但不可解析时的通知（调用方自行决定分类与措辞）
 *
 * 完成判据：文件大小连续 stableSamples 次采样不变 **且** 解析成功（**且** 谓词满足）。
 * deadline 到期后返回最后一次可解析结果（由调用方决定是否降级）。
 *
 * @param {string} file
 * @param {number} deadline epoch ms
 * @param {object} [opts]
 * @param {number} [opts.pollMs=500]
 * @param {number} [opts.stableSamples=3]          大小连续不变次数（"稳定"判据）
 * @param {number} [opts.invalidStableSamples=10]  "稳定但非法"连续次数上限（stale 判据）
 * @param {Function|null} [opts.isComplete]        内容可用性谓词（通用扩展点）
 * @param {Function|null} [opts.onStaleInvalid]    stale 通知（通用扩展点）
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
            invalidStable++;
            if (invalidStable >= invalidStableSamples) {
              if (typeof onStaleInvalid === "function") {
                onStaleInvalid({ reason: "stale_invalid_json", file, size, invalidStable, elapsedMs: Date.now() - startedAt });
              }
              return null;
            }
          }
          stable = 0; // 大小稳定但（不可解析 或 谓词未满足）：继续等待
        }
      }
    }
    await sleep(pollMs);
  }
  return lastParsed !== null ? lastParsed : (fs.existsSync(file) ? readJsonStrict(file) : null);
}

/** 原子发布：tmp → final（rename 优先；失败回退 copy+rm） */
export function publishFile(tmpFile, finalFile) {
  try { fs.renameSync(tmpFile, finalFile); return "rename"; }
  catch (e) {
    fs.copyFileSync(tmpFile, finalFile);
    try { fs.rmSync(tmpFile, { force: true }); } catch { /* 已消失 */ }
    return "copy";
  }
}
