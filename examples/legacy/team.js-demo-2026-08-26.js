#!/usr/bin/env node
/**
 * team.js —— AI 团队与项目状态查询 CLI（agent-demo V0.1 协同试点，TASK-002）
 *
 * 运行：node team.js           → 人类可读表格输出（默认）
 *       node team.js --json    → 机器可读 JSON 输出（stdout 只有 JSON）
 * 表格输出：
 *   1) 「AI 团队」表格 —— 读取 .ai/agents/registry.json（每行：名称 / 角色 / 能力 / 状态，
 *      capabilities 对象转成 "reasoning 5 / planning 5" 这类字符串）
 *   2) 「项目状态」行 —— 读取 .ai/state.json（phase / currentTask / completed，数组以逗号连接）
 * --json 输出：{ mode, generatedAt, team[], status }；团队为空时顶层补 warnings。
 * 错误分流：表格模式人话错误到 stderr、exit 1（原状）；JSON 模式 stdout 只输出 { mode, error }，exit 2。
 *
 * 本脚本只读上述两个文件，不修改任何文件；纯 Node.js 标准库，无第三方依赖。
 */
'use strict';

const fs = require('fs');
const path = require('path');

// 基于脚本所在目录定位，保证在任意 cwd 下运行都能找到（也符合"在项目根目录运行"的约定）
const REGISTRY_PATH = path.join(__dirname, '.ai', 'agents', 'registry.json');
const STATE_PATH = path.join(__dirname, '.ai', 'state.json');

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/**
 * 估算字符串在终端中的显示宽度：CJK/全角字符按 2 列计，半角按 1 列计。
 * 这样中文与英文混排的表格也能对齐美观。
 */
function displayWidth(str) {
  let width = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0);
    const isWide =
      (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo 初声
      code === 0x2329 || code === 0x232a || // 书名号〈〉
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) || // CJK 部首 / 汉字 / 假名等
      (code >= 0xac00 && code <= 0xd7a3) || // Hangul 音节
      (code >= 0xf900 && code <= 0xfaff) || // CJK 兼容汉字
      (code >= 0xfe30 && code <= 0xfe4f) || // CJK 兼容形式（竖排标点等）
      (code >= 0xff00 && code <= 0xff60) || // 全角 ASCII / 全角标点
      (code >= 0xffe0 && code <= 0xffe6);   // 全角符号（￥￡等）
    width += isWide ? 2 : 1;
  }
  return width;
}

/** 右侧补空格到指定显示宽度（不足宽度时原样返回，避免表格断裂）。 */
function padRight(str, width) {
  const pad = width - displayWidth(str);
  return pad > 0 ? str + ' '.repeat(pad) : str;
}

/**
 * 读取并解析 JSON 文件；失败时抛出带 code/label/file 的 Error（人话文案逐行保留在
 * err.message 里），由 main() 按模式决定如何输出与退出，本函数不再直接 console/exit。
 * @param {string} filePath 文件绝对路径
 * @param {string} label    人类可读的名称（用于报错信息）
 * @throws {Error} err.code = 'ENOENT'（缺失）| 'PARSE'（非法 JSON）| 其他读取错误原文
 *                 （如 EACCES/EIO）；err.label、err.file 同参数
 */
function readJson(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    const lines =
      err.code === 'ENOENT'
        ? [
            `错误：未找到 ${label}`,
            `  期望位置：${filePath}`,
            '  请确认 team.js 位于项目根目录，且 .ai/ 目录结构完好。',
          ]
        : [
            `错误：读取 ${label} 失败（${err.message}）`,
            `  文件位置：${filePath}`,
          ];
    const e = new Error(lines.join('\n'));
    e.code = err.code; // 'ENOENT'，或其他读取错误（EACCES/EIO 等）的原文
    e.label = label;
    e.file = filePath;
    throw e;
  }
  // 兼容 Windows 编辑器常见的 UTF-8 BOM：JSON.parse 不接受开头 BOM，一次性去掉所有前导 BOM
  raw = raw.replace(/^\uFEFF+/, '');
  try {
    return JSON.parse(raw);
  } catch (err) {
    const e = new Error(
      [`错误：${label} 内容不是合法 JSON（${err.message}）`, `  文件位置：${filePath}`].join('\n')
    );
    e.code = 'PARSE';
    e.label = label;
    e.file = filePath;
    throw e;
  }
}

/** 把 capabilities 对象转成 "reasoning 5 / planning 5" 这类字符串（保持 JSON 键顺序）。 */
function formatCapabilities(caps) {
  if (caps === null || typeof caps !== 'object' || Array.isArray(caps)) {
    return '';
  }
  return Object.entries(caps)
    .map(([key, value]) => `${key} ${value}`)
    .join(' / ');
}

/** 渲染 ASCII 边框表格（兼容性好，避免部分终端不显示制表符）。 */
function renderTable(headers, rows) {
  const allRows = [headers, ...rows];
  const colCount = headers.length;
  const widths = headers.map((_, col) =>
    Math.max(...allRows.map((r) => displayWidth(String(r[col] ?? '-'))))
  );
  const border = '+' + widths.map((w) => '-'.repeat(w + 2)).join('+') + '+';
  const rowLine = (r) =>
    '| ' + r.map((cell, i) => padRight(String(cell ?? '-'), widths[i])).join(' | ') + ' |';

  const lines = [border, rowLine(headers), border];
  for (const row of rows) lines.push(rowLine(row));
  lines.push(border);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function main() {
  const jsonMode = process.argv.slice(2).includes('--json');

  let registry, state;
  try {
    registry = readJson(REGISTRY_PATH, '.ai/agents/registry.json');
    state = readJson(STATE_PATH, '.ai/state.json');
  } catch (err) {
    if (!jsonMode) {
      // 表格模式：人类错误文案逐行输出到 stderr，exit 1（与改动前完全一致）
      console.error(err.message);
      process.exit(1);
    }
    // JSON 模式：人类可读文案仍到 stderr（便于人排查），stdout 只输出一个错误对象，exit 2
    console.error(err.message);
    console.log(
      JSON.stringify(
        { mode: 'json', error: { code: err.code, label: err.label, file: err.file, message: err.message } },
        null,
        2
      )
    );
    process.exit(2);
  }

  if (!jsonMode) {
    // ==================== 表格模式（无 --json）：以下为原实现，逐行未动 ====================
    // 1) AI 团队表格
    const agents = Array.isArray(registry.agents) ? registry.agents : [];
    console.log('==================== AI 团队 ====================');
    if (agents.length === 0) {
      console.log('（无 agent 数据：registry.agents 为空或不是数组）');
    } else {
      const rows = agents.map((a) => [
        a.name ?? '-',
        a.role ?? '-',
        formatCapabilities(a.capabilities) || '-',
        a.status ?? '-',
      ]);
      console.log(renderTable(['名称', '角色', '能力', '状态'], rows));
    }

    // 2) 项目状态行
    const completed = Array.isArray(state.completed) ? state.completed.join(',') : '-';
    console.log('');
    console.log('-------------------- 项目状态 --------------------');
    console.log(
      `阶段(phase)=${state.phase ?? '-'}，当前任务(currentTask)=${state.currentTask ?? '-'}，已完成(completed)=${completed}`
    );

    console.log('');
    console.log('（数据来源：.ai/agents/registry.json、.ai/state.json —— 本次执行只读，未修改任何文件）');
    return;
  }

  // ==================== JSON 模式（--json）：stdout 只输出一个 JSON 对象 ====================
  // 原理：「把解析后的两份数据原样序列化 + 给每个 agent 补一个 capabilitiesText」，
  // 而不是把表格重画一遍——实现量最小，永不与表格渲染逻辑走偏。
  const agents = registry && Array.isArray(registry.agents) ? registry.agents : [];
  const team = agents.map((a) => ({
    ...a, // 保留注册表原始字段（id/name/role/access/brain/…）
    capabilitiesText: formatCapabilities(a.capabilities), // 复用现有函数，保证与表格列逐字符一致
  }));
  const out = { mode: 'json', generatedAt: new Date().toISOString(), team };
  if (!(registry && Array.isArray(registry.agents))) {
    out.warnings = ['registry.agents 缺失或不是数组']; // 仅异常时出现
  }
  out.status = state; // state.json 原样放入，不裁剪字段
  console.log(JSON.stringify(out, null, 2));
}

main();