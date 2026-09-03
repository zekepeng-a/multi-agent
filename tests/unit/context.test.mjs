// context.test.mjs —— Integration tests for context.mjs (Budget, Priority, provenance)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assembleContext } from "../../context.mjs";

function makeProject({ budget = 1200 } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-test-"));
  const mem = path.join(d, ".ai", "memory");
  const mk = (dir, id, type, title, content, tags) => {
    fs.mkdirSync(path.join(mem, dir), { recursive: true });
    fs.writeFileSync(path.join(mem, dir, `${id}.json`), JSON.stringify({ id, type, title, content, tags, source: { kind: "test", task_id: "TASK-0", file: `.ai/memory/${dir}/${id}.json` } }));
  };
  mk("decisions", "decision-auth", "decision", "认证 JWT 中间件", "auth token 校验 JWT RS256", ["auth", "token"]);
  for (let i = 0; i < 10; i++) mk("knowledge", `knowledge-filler-${i}`, "knowledge", `填充 ${i}`, `通用占位文本 item ${i}。${"通用描述".repeat(30)}`, ["filler"]);
  mk("agents", "agent_memory-codex", "agent_memory", "Agent 统计", "完成 2 run", ["agent-stats"]);
  fs.mkdirSync(path.join(d, ".ai"), { recursive: true });
  fs.writeFileSync(path.join(d, ".ai", "project.md"), "# p\n认证项目");
  fs.writeFileSync(path.join(d, ".ai", "state.json"), JSON.stringify({ phase: "running", currentTask: "T-1", completed: [] }));
  return d;
}

test("assembleContext: 预算内不超限", () => {
  const d = makeProject();
  const ctx = assembleContext({ workdir: d, currentTask: { id: "T-1", title: "实现认证中间件", description: "auth token", required_capability: "coding" }, budgetChars: 1200, topK: 30 });
  assert.ok(ctx.usedChars <= ctx.budgetChars, `usedChars ${ctx.usedChars} <= budget ${ctx.budgetChars}`);
  fs.rmSync(d, { recursive: true, force: true });
});

test("assembleContext: Current Task 永不裁剪", () => {
  const d = makeProject();
  const ctx = assembleContext({ workdir: d, currentTask: { id: "T-1", title: "实现认证中间件", description: "auth token", required_capability: "coding" }, budgetChars: 200, topK: 30 });
  assert.ok(ctx.sections.currentTask.includes("T-1"), "Current Task 保留");
  fs.rmSync(d, { recursive: true, force: true });
});

test("assembleContext: 高优先 decision 保留 / 低优先 agent_memory 可被裁剪", () => {
  const d = makeProject();
  const ctx = assembleContext({ workdir: d, currentTask: { id: "T-1", title: "认证 token 校验", description: "auth", required_capability: "coding" }, budgetChars: 900, topK: 30 });
  const ids = ctx.selected.map((s) => s.id);
  assert.ok(ids.includes("decision-auth"), "高相关 decision 应被选中");
  assert.ok(ctx.selected.every((s) => s.provenance), "provenance 保留");
  fs.rmSync(d, { recursive: true, force: true });
});

test("assembleContext: 无关 filler 不进入 selected（score=0 过滤）", () => {
  const d = makeProject();
  const ctx = assembleContext({ workdir: d, currentTask: { id: "T-1", title: "认证 token 校验", description: "auth jwt", required_capability: "coding" }, budgetChars: 6000, topK: 30 });
  // filler 内容不含 query 关键词 → 不应被召回
  const fillerIds = ctx.selected.filter((s) => s.id.includes("filler"));
  assert.equal(fillerIds.length, 0, "无关 filler 不应进入 Context");
  fs.rmSync(d, { recursive: true, force: true });
});

test("assembleContext: 只读（不写任何文件）", () => {
  const d = makeProject();
  const snap = (dir) => JSON.stringify(fs.readdirSync(dir, { recursive: true }).sort());
  const before = snap(path.join(d, ".ai"));
  assembleContext({ workdir: d, currentTask: { id: "T-1", title: "认证", description: "auth", required_capability: "coding" }, budgetChars: 6000 });
  const after = snap(path.join(d, ".ai"));
  assert.equal(after, before, "assembleContext 不应修改任何 .ai 内容");
  fs.rmSync(d, { recursive: true, force: true });
});
