// retriever.test.mjs —— Unit tests for retriever.mjs (BM25-like, deterministic)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { retrieve, tokenize, scoreEntry, estimateChars } from "../../retriever.mjs";

function makeMemoryDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "retriever-test-"));
  const mk = (dir, id, type, title, content, tags) => {
    fs.mkdirSync(path.join(d, dir), { recursive: true });
    fs.writeFileSync(path.join(d, dir, `${id}.json`), JSON.stringify({ id, type, title, content, tags, source: { kind: "test" } }));
  };
  mk("decisions", "decision-auth-token", "decision", "认证系统：JWT 校验中间件选型", "JWT RS256 校验 auth token，网关层。", ["auth", "token"]);
  mk("knowledge", "knowledge-ui", "knowledge", "UI 设计规范", "按钮圆角 8px。", ["ui"]);
  mk("lessons", "lesson-db", "lesson", "数据库迁移失败", "迁移未加事务。", ["db"]);
  return d;
}

test("tokenize: 英文词 + 中文 2-gram", () => {
  const t = tokenize("认证系统 auth token 校验");
  assert.ok(t.includes("auth"));
  assert.ok(t.includes("token"));
  assert.ok(t.includes("认证"));
  assert.ok(t.includes("系统"));
});

test("estimateChars: 封装存在且有限", () => {
  const n = estimateChars("hello world 中文测试");
  assert.ok(typeof n === "number" && n > 0 && n < 100);
});

test("retrieve: 高相关排第一，无关被过滤", () => {
  const d = makeMemoryDir();
  const res = retrieve({ query: "认证系统 auth token 校验实现", memoryDir: d, topK: 10 });
  assert.equal(res[0].id, "decision-auth-token", "A（高相关）应排第一");
  assert.ok(!res.some((r) => r.id === "lesson-db"), "C（无关）应被过滤");
  assert.ok(!res.some((r) => r.id === "knowledge-ui"), "B（低相关）应被过滤");
  assert.ok(res[0].provenance, "provenance 保留");
  fs.rmSync(d, { recursive: true, force: true });
});

test("retrieve: typeFilter 只返回指定类型", () => {
  const d = makeMemoryDir();
  const res = retrieve({ query: "认证 token", memoryDir: d, typeFilter: ["lesson"] });
  assert.ok(res.every((r) => r.type === "lesson"));
  fs.rmSync(d, { recursive: true, force: true });
});

test("retrieve: score 降序", () => {
  const d = makeMemoryDir();
  const res = retrieve({ query: "认证系统 auth token", memoryDir: d, topK: 10 });
  for (let i = 1; i < res.length; i++) assert.ok(res[i - 1].score >= res[i].score);
  fs.rmSync(d, { recursive: true, force: true });
});

test("scoreEntry: 确定性（同输入同分数）", () => {
  const e = { title: "auth", content: "token 校验", tags: ["auth"] };
  const q = tokenize("auth token");
  assert.equal(scoreEntry(q, e), scoreEntry(q, e));
});
