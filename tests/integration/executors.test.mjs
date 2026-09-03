// executors.test.mjs —— Integration tests: Executor Resolver + Agent Registry structure
// NOTE: no external runtime is spawned here (Claude/Codex/DSH E2E lives in the
// requires-external E2E suite; see docs/testing.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { resolveExecutor, REGISTRY } = await import(pathToFileURL(path.join(ROOT, "executors.mjs")).href);

test("Executor Resolver: 已知 backend 返回 executor 实例", () => {
  const e = resolveExecutor("claude-code");
  assert.ok(e && typeof e.execute === "function", "claude-code executor 应可解析");
  const c = resolveExecutor("codex");
  assert.ok(c && typeof c.execute === "function", "codex executor 应可解析");
  const d = resolveExecutor("dsh-headless");
  assert.ok(d && typeof d.execute === "function", "dsh-headless executor 应可解析");
});

test("Executor Resolver: 未知 backend fallback 到 claude-code（设计特性）", () => {
  const e = resolveExecutor("no-such-backend");
  assert.ok(e && typeof e.execute === "function", "未知 backend 应 fallback 到默认 executor（claude-code）");
});

test("Agent Registry: 8 agents，Agent≠Model 结构成立", () => {
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, ".ai", "agents", "registry.json"), "utf-8"));
  const agents = reg.agents || [];
  assert.ok(agents.length >= 7, "至少 7 个 agent");
  for (const a of agents) {
    assert.ok(a.id, "每个 agent 有 id");
    assert.ok(a.backend && typeof a.backend.type === "string", `${a.id} 有 backend.type`);
    // Model 是可绑定配置：manager 无 model 合理；worker 可空（用 runtime 默认）或字符串
    if ("model" in a) assert.ok(typeof a.model === "string", `${a.id} 的 model 是字符串绑定`);
  }
  const ids = agents.map((a) => a.id);
  assert.ok(ids.includes("manager") && ids.includes("architect") && ids.includes("claude-code"), "关键角色存在");
});

test("Agent Registry: Model 不决定 Agent 身份（backend 决定执行方式）", () => {
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, ".ai", "agents", "registry.json"), "utf-8"));
  const codexAgents = (reg.agents || []).filter((a) => a.backend.type === "codex");
  assert.ok(codexAgents.some((a) => a.id === "architect"), "architect 走 codex backend（Codex 是 Agent 角色）");
});

test("Agent Registry: 默认 registry 模板存在（.gitignore 保留入库）", () => {
  assert.ok(fs.existsSync(path.join(ROOT, ".ai", "agents", "registry.json")), "registry.json 模板应存在");
});
