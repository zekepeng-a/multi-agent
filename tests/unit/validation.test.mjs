// validation.test.mjs —— Bug #6 回归：验收命令规范化与校验（V0.5.3）
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { normalizeRunCommand } = await import(pathToFileURL(path.join(ROOT, "orchestrator.mjs")).href);

// 1) 正常命令不改变
test("Bug#6: 正常命令保持不变", () => {
  for (const cmd of ["node scripts/learning.test.mjs", "npx tsc --noEmit", "npm run lint", "node -e \"process.exit(0)\""]) {
    const r = normalizeRunCommand(cmd);
    assert.equal(r.valid, true, `${cmd} 应合法`);
    assert.equal(r.command, cmd, `${cmd} 不应被改动`);
    assert.equal(r.stripped, null, "无剥离内容");
  }
});

// 2) 命令 + 中文括注（Test 4 现场形态）
test("Bug#6: 剥离中文括注（Test 4 现场）", () => {
  const r = normalizeRunCommand("node scripts/learning.test.mjs（exit 0，佐证本任务未触碰任何代码）");
  assert.equal(r.valid, true);
  assert.equal(r.command, "node scripts/learning.test.mjs");
  assert.ok(r.stripped.includes("exit 0"));
});

test("Bug#6: 剥离裸中文说明（无括号）", () => {
  const r = normalizeRunCommand("node scripts/x.test.mjs 应当全部通过");
  assert.equal(r.valid, true);
  assert.equal(r.command, "node scripts/x.test.mjs");
});

// 3) 命令 + 英文说明
test("Bug#6: 剥离半角括号英文说明", () => {
  const r = normalizeRunCommand("node test.js (should exit 0)");
  assert.equal(r.valid, true);
  assert.equal(r.command, "node test.js");
});

test("Bug#6: shell 注释（# ...）不被剥离（合法语法）", () => {
  const r = normalizeRunCommand("node test.js # run the suite");
  assert.equal(r.valid, true);
  assert.equal(r.command, "node test.js # run the suite");
});

// 4) 带参数的正常命令不能被错误截断
test("Bug#6: 引号内参数/括号/中文不被破坏", () => {
  const cmd = `node -e "const s=require('fs').readFileSync('a.txt','utf-8');if(s.trim()!=='中文')process.exit(1)"`;
  const r = normalizeRunCommand(cmd);
  assert.equal(r.valid, true);
  assert.equal(r.command, cmd, "引号内内容必须原样保留");
});

test("Bug#6: 多参数/管道/重定向命令完整保留", () => {
  for (const cmd of ["node scripts/t.mjs --flag value", "node a.mjs | node b.mjs", "node a.mjs > out.txt 2>&1", "npm test -- --grep x"]) {
    const r = normalizeRunCommand(cmd);
    assert.equal(r.valid, true, `${cmd} 应合法`);
    assert.equal(r.command, cmd);
  }
});

// 5) 空命令
test("Bug#6: 空命令被拒绝", () => {
  for (const raw of ["", "   ", "\t"]) {
    const r = normalizeRunCommand(raw);
    assert.equal(r.valid, false);
    assert.equal(r.code, "empty_command");
  }
});

// 6) 非法命令
test("Bug#6: 纯中文说明不是命令 → 拒绝", () => {
  const r = normalizeRunCommand("检查文件是否存在且内容正确");
  assert.equal(r.valid, false);
  assert.equal(r.code, "empty_after_strip");
});

test("Bug#6: 引号不配对 → 拒绝", () => {
  const r = normalizeRunCommand('node -e "console.log(1)');
  assert.equal(r.valid, false);
  assert.equal(r.code, "unbalanced_quotes");
});

// 7) 多个验收命令（逐条独立规范化）
test("Bug#6: 多条验收命令各自规范化（数组语义）", () => {
  const criteria = [
    "file: docs/x.md",
    "run: node scripts/a.test.mjs（exit 0，佐证未触碰代码）",
    "run: npx tsc --noEmit",
    "该任务不应修改 lib/db.ts（人工核对）",
  ];
  const out = criteria.map((c) => (c.startsWith("run:") ? normalizeRunCommand(c.slice(4)) : null));
  assert.equal(out[1].valid, true);
  assert.equal(out[1].command, "node scripts/a.test.mjs");
  assert.equal(out[2].valid, true);
  assert.equal(out[2].command, "npx tsc --noEmit");
});

// 8) 清洗后仍为空/非法
test("Bug#6: 仅括注说明 → 清洗后为空 → 拒绝", () => {
  const r = normalizeRunCommand("（本任务不需要执行任何命令）");
  assert.equal(r.valid, false);
  assert.ok(["empty_command", "empty_after_strip"].includes(r.code), `实际 code=${r.code}`);
});

test("Bug#6: 拒绝时仍保留原始文本（审计）", () => {
  const raw = "node x.test.mjs（exit 0，佐证）";
  const r = normalizeRunCommand(raw);
  assert.equal(r.raw, raw, "raw 必须原样保留");
  assert.ok(r.command === "node x.test.mjs");
});
