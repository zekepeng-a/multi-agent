// distiller.test.mjs —— Unit/Integration tests for distiller.mjs (dedup, aggregation, rebuild)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { distill } from "../../distiller.mjs";

function makeProject({ withReviews = true, withReplan = false } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "distill-test-"));
  const ai = path.join(d, ".ai");
  const mk = (rel, obj) => { const p = path.join(ai, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 2)); };
  if (withReviews) {
    mk("reviews/TASK-B-1.json", { taskId: "TASK-B", verdict: "FAIL", reason: "missing MAGIC_TOKEN_42" });
    mk("reviews/TASK-B-2.json", { taskId: "TASK-B", verdict: "FAIL", reason: "MAGIC_TOKEN_42 missing, different wording" });
  }
  mk("evaluations/TASK-B.json", { taskId: "TASK-B", verdict: "FAIL", suggested_action: "replan", reason: "review-fail: MAGIC_TOKEN_42" });
  mk("runs/run1.json", { taskId: "TASK-A", agent: "claude-code", status: "completed", phase: "done" });
  mk("runs/run2.json", { taskId: "TASK-B", agent: "claude-code", status: "completed", phase: "done" });
  if (withReplan) mk("tasks.json", { goal: "t", replan_count: 1, tasks: [{ id: "TASK-B", retry_count: 1, status: "completed" }] });
  return d;
}

test("distill: Review FAIL + Evaluation → lessons（同失败模式聚合为 1 条）", async () => {
  const d = makeProject();
  const r1 = await distill({ workdir: d });
  const lessonsDir = path.join(d, ".ai", "memory", "lessons");
  const files = fs.readdirSync(lessonsDir).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 1, "至少 1 条 lesson");
  // 同模式（MAGIC_TOKEN）聚合：3 个候选应只产生 1 条 lesson（review×2 同模式 + eval 同任务）
  assert.equal(files.length, 1, "同失败模式应聚合为 1 条 lesson（MAGIC_TOKEN）");
  fs.rmSync(d, { recursive: true, force: true });
});

test("distill: 幂等（重复执行不新增）", async () => {
  const d = makeProject();
  await distill({ workdir: d });
  const r2 = await distill({ workdir: d });
  assert.equal(r2.added, 0, "重复执行不应新增");
  fs.rmSync(d, { recursive: true, force: true });
});

test("distill: 删除 memory/ 后可重建", async () => {
  const d = makeProject();
  await distill({ workdir: d });
  const memDir = path.join(d, ".ai", "memory");
  const before = fs.readdirSync(path.join(memDir, "lessons")).length + fs.readdirSync(path.join(memDir, "agents")).length;
  fs.rmSync(memDir, { recursive: true, force: true });
  const r = await distill({ workdir: d });
  assert.ok(r.added >= 1, "删除后可重建");
  const after = fs.readdirSync(path.join(memDir, "lessons")).length + fs.readdirSync(path.join(memDir, "agents")).length;
  assert.equal(after, before, "重建后条目数一致");
  fs.rmSync(d, { recursive: true, force: true });
});

test("distill: agent_memory per-agent 聚合（多 run 后仍 1 条）", async () => {
  const d = makeProject();
  await distill({ workdir: d });
  fs.appendFileSync(path.join(d, ".ai", "runs", "run3.json"), JSON.stringify({ taskId: "TASK-C", agent: "claude-code", status: "failed" }));
  await distill({ workdir: d });
  const agentsDir = path.join(d, ".ai", "memory", "agents");
  const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".json"));
  assert.equal(files.length, 1, "同一 agent 应只有 1 条 agent_memory");
  fs.rmSync(d, { recursive: true, force: true });
});

test("distill: replan → decision 蒸馏", async () => {
  const d = makeProject({ withReplan: true });
  await distill({ workdir: d });
  const decDir = path.join(d, ".ai", "memory", "decisions");
  const files = fs.readdirSync(decDir).filter((f) => f.endsWith(".json"));
  assert.equal(files.length, 1, "replan 应产生 1 条 decision");
  const dec = JSON.parse(fs.readFileSync(path.join(decDir, files[0]), "utf-8"));
  assert.ok("supersedes" in dec, "decision 含 supersedes 字段");
  assert.ok(dec.source, "decision 含 provenance");
  fs.rmSync(d, { recursive: true, force: true });
});

test("distill: 坏数据容错（不崩溃，跳过坏文件）", async () => {
  const d = makeProject();
  fs.writeFileSync(path.join(d, ".ai", "runs", "bad.json"), "{ 不是合法 JSON");
  const r = await distill({ workdir: d }); // 不应 throw
  assert.ok(typeof r.added === "number");
  fs.rmSync(d, { recursive: true, force: true });
});
