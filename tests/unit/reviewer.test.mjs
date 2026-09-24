// reviewer.test.mjs —— V0.5.3 Reviewer 稳定性回归（失败分类 + 安全语义 + 防循环）
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { classifyReviewOutcome, evaluateFailure } = await import(pathToFileURL(path.join(ROOT, "orchestrator.mjs")).href);

// ── 失败分类 ────────────────────────────────────────────────────────────────

test("classify: 有效 verdict（PASS/FAIL）→ kind=verdict", () => {
  for (const v of ["PASS", "FAIL"]) {
    const o = classifyReviewOutcome({ exitCode: 0, raw: { verdict: v, reason: "r" }, resFileExists: true });
    assert.equal(o.kind, "verdict");
    assert.equal(o.verdict.verdict, v);
  }
});

test("classify: 进程非零退出且无结果文件 → process_failure（旧行为：无区分）", () => {
  const o = classifyReviewOutcome({ exitCode: 1, raw: null, resFileExists: false, stderrTail: "boom" });
  assert.equal(o.kind, "process_failure");
  assert.equal(o.code, "review_process_exit");
  assert.ok(o.reason.includes("exit 1"));
});

test("classify: 超时无结果文件 → timeout", () => {
  const o = classifyReviewOutcome({ exitCode: null, timedOut: true, raw: null, resFileExists: false });
  assert.equal(o.kind, "timeout");
  assert.equal(o.code, "review_timeout");
});

test("classify: 结果文件存在但 verdict 非法 → invalid_verdict", () => {
  const o = classifyReviewOutcome({ exitCode: 0, raw: { verdict: "MAYBE" }, resFileExists: true });
  assert.equal(o.kind, "invalid_verdict");
  assert.equal(o.code, "invalid_verdict");
});

test("classify: 进程未产出文件也未正常退出 → process_failure(nofile)", () => {
  const o = classifyReviewOutcome({ exitCode: null, timedOut: false, raw: null, resFileExists: false });
  assert.equal(o.kind, "process_failure");
  assert.equal(o.code, "review_process_nofile");
});

// ── 安全语义：任何非 verdict 都不得 PASS ─────────────────────────────────────

test("安全语义: 所有失败分类都不产生 PASS", () => {
  const cases = [
    { exitCode: 1, raw: null, resFileExists: false },
    { exitCode: null, timedOut: true, raw: null, resFileExists: false },
    { exitCode: 0, raw: { verdict: "MAYBE" }, resFileExists: true },
    { exitCode: null, raw: null, resFileExists: false },
  ];
  for (const c of cases) {
    const o = classifyReviewOutcome(c);
    assert.notEqual(o.kind, "verdict", "非 verdict 分类");
    assert.notEqual(o.verdict && o.verdict.verdict, "PASS", "绝不允许 PASS");
  }
});

// ── 防循环：review-unavailable 不判为计划问题 ────────────────────────────────

test("防循环: review-unavailable（进程失败）→ retry 而非 replan", () => {
  const task = { failure_reason: "review-unavailable: review_process_exit Reviewer 进程异常退出（exit 1）", failure_history: [], retry_count: 0 };
  const ev = evaluateFailure(task, { agents: [] });
  assert.equal(ev.suggested_action, "retry", "基础设施失败应重试，不应触发 replan 循环");
});

test("防循环: review-unavailable（超时）→ retry", () => {
  const task = { failure_reason: "review-unavailable: review_timeout Reviewer 超时未产出 verdict", failure_history: [], retry_count: 2 };
  const ev = evaluateFailure(task, { agents: [] });
  assert.equal(ev.suggested_action, "retry");
});

test("防循环: review-unavailable（非法 verdict）→ retry", () => {
  const task = { failure_reason: "review-unavailable: invalid_verdict Reviewer 产出的 verdict 非法", failure_history: [], retry_count: 1 };
  const ev = evaluateFailure(task, { agents: [] });
  assert.equal(ev.suggested_action, "retry");
});

// ── 旧行为保持：真实 review-fail 仍走 replan 链路 ─────────────────────────────

test("旧行为保持: review-fail（真实评审否决）且重试 1 次后 → replan", () => {
  const task = { failure_reason: "review-fail: 产出缺少 MAGIC_TOKEN", failure_history: ["review-fail: 产出缺少 MAGIC_TOKEN"], retry_count: 1 };
  const ev = evaluateFailure(task, { agents: [] });
  assert.equal(ev.suggested_action, "replan", "真实 Review FAIL 的既有语义不得改变");
});

test("旧行为保持: 验收未通过 + 重试耗尽 → replan", () => {
  const task = { failure_reason: "验收未通过: ✗ file: server.js 缺失", failure_history: ["验收未通过: ✗ file: server.js 缺失"], retry_count: 2 };
  const ev = evaluateFailure(task, { agents: [] });
  assert.equal(ev.suggested_action, "replan");
});

test("旧行为保持: 临时执行失败（timeout/秒退）→ retry", () => {
  for (const reason of ["non_zero_exit: claude 退出码 1，无结果文件", "timeout: worker 超时", "malformed_result: 结果文件非法 JSON"]) {
    const task = { failure_reason: reason, failure_history: [reason], retry_count: 0 };
    const ev = evaluateFailure(task, { agents: [] });
    assert.equal(ev.suggested_action, "retry", `${reason} 应重试`);
  }
});
