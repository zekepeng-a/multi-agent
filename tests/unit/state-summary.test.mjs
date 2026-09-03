// state-summary.test.mjs —— Unit tests for state-summary.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateStateSummary } from "../../state-summary.mjs";

function makeProject() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "summary-test-"));
  const ai = path.join(d, ".ai");
  fs.mkdirSync(path.join(ai, "memory", "decisions"), { recursive: true });
  fs.mkdirSync(path.join(ai, "memory", "lessons"), { recursive: true });
  fs.writeFileSync(path.join(ai, "tasks.json"), JSON.stringify({ goal: "测试项目", replan_count: 1, tasks: [
    { id: "TASK-A", status: "completed", assigned_agent: "claude-code" },
    { id: "TASK-B", status: "pending", assigned_agent: "claude-code", dependencies: ["TASK-A"] },
  ]}));
  fs.writeFileSync(path.join(ai, "state.json"), JSON.stringify({ phase: "running", currentTask: "TASK-B", completed: ["TASK-A"] }));
  fs.writeFileSync(path.join(ai, "project.md"), "# 测试项目\n认证相关");
  fs.writeFileSync(path.join(ai, "memory", "decisions", "d1.json"), JSON.stringify({ id: "d1", title: "计划修订 #1", content: "replan", source: { kind: "replan" } }));
  fs.writeFileSync(path.join(ai, "memory", "lessons", "l1.json"), JSON.stringify({ id: "l1", title: "Review 否决", content: "MAGIC_TOKEN 缺失", source: { kind: "review" } }));
  return d;
}

test("generateStateSummary: 9 节完整且数据来自结构化源", () => {
  const d = makeProject();
  const md = generateStateSummary({ workdir: d, write: true });
  for (const h of ["Project Goal", "Current Status", "Completed Tasks", "Active Tasks", "Important Decisions", "Known Problems", "Recent Lessons", "Current Agent / Task 状态", "Next Recommended Actions"]) {
    assert.ok(md.includes(`## ${h}`), `缺节: ${h}`);
  }
  assert.ok(md.includes("TASK-A"), "Completed 来自 tasks");
  assert.ok(md.includes("计划修订 #1"), "Decisions 来自 memory");
  assert.ok(md.includes("Review 否决"), "Lessons 来自 memory");
  assert.ok(fs.existsSync(path.join(d, ".ai", "state.summary.md")), "已写入文件");
  fs.rmSync(d, { recursive: true, force: true });
});

test("generateStateSummary: 幂等（同输入同输出）", () => {
  const d = makeProject();
  const a = generateStateSummary({ workdir: d, write: false });
  const b = generateStateSummary({ workdir: d, write: false });
  assert.equal(a, b);
  fs.rmSync(d, { recursive: true, force: true });
});

test("generateStateSummary: 只读原始层", () => {
  const d = makeProject();
  const tasksBefore = fs.readFileSync(path.join(d, ".ai", "tasks.json"), "utf-8");
  generateStateSummary({ workdir: d, write: true });
  const tasksAfter = fs.readFileSync(path.join(d, ".ai", "tasks.json"), "utf-8");
  assert.equal(tasksAfter, tasksBefore, "不应修改 tasks.json");
  fs.rmSync(d, { recursive: true, force: true });
});
