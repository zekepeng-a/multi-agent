// review-evidence.test.mjs —— V0.5.6 / Bug #9 回归：调度器验收证据进入 Review Gate
//
// Bug #9：Reviewer 拿不到 Scheduler(validateTask) 已执行的验收结果，只看到 Worker 自述
//         （worker 在沙箱内被禁止执行命令 ⇒ 自报"未执行/tests failed"）⇒ 误判 FAIL。
// 修复：validateTask 产出结构化 checks（command/exit_code/stdout/stderr/status），
//       经 formatValidationEvidence 注入 Reviewer prompt；与 WORKER REPORT 并列，冲突由 Reviewer 裁定。
// 安全语义不变：evidence 只是事实依据，**绝不**绕过 Review Gate（无有效 verdict ⇒ 不得 PASS）。
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { buildReviewPrompt, formatValidationEvidence, truncateMiddle, classifyReviewOutcome, evaluateFailure } =
  await import(pathToFileURL(path.join(ROOT, "orchestrator.mjs")).href);

const RES = "/tmp/_review-TASK-X.json";
const mkTask = (over = {}) => ({
  id: "TASK-X",
  title: "实现并验证功能",
  constraints: [],
  acceptance_criteria: ["run: node test.js"],
  review_rules: ["产出必须可运行且验收命令通过"],
  result: { summary: "实现完成", modified_files: ["lib/a.ts"], tests: [], issues: [] },
  ...over,
});

// ── Test 1：Validation PASS 能被 Reviewer 看见 ─────────────────────────────────
test("Test1: validation PASS 的 command/exit_code/stdout/status 出现在 Review prompt", () => {
  const validation = {
    pass: true,
    detail: "✓ run: node test.js exit 0",
    checks: [{ kind: "run", raw: "run: node test.js", command: "node test.js", exitCode: 0, stdout: "9/9 tests passed\n", stderr: "", status: "PASS" }],
  };
  const p = buildReviewPrompt(mkTask(), validation, RES);
  assert.ok(p.includes("[VALIDATION EVIDENCE"), "应包含证据块标题");
  assert.ok(p.includes("command: node test.js"), "应包含 command");
  assert.ok(p.includes("exit_code: 0"), "应包含 exit_code=0");
  assert.ok(p.includes("9/9 tests passed"), "应包含 stdout 摘要");
  assert.ok(p.includes("status: PASS"), "应包含 status");
  assert.ok(p.includes("validation_status: PASS"), "应包含整体状态");
});

// ── Test 2：Validation FAIL 能被 Reviewer 看见 ────────────────────────────────
test("Test2: validation FAIL 的真实失败证据进入 Review prompt", () => {
  const validation = {
    pass: false,
    detail: "✗ run: node test.js exit 1",
    checks: [{ kind: "run", raw: "run: node test.js", command: "node test.js", exitCode: 1, stdout: "", stderr: "AssertionError: expected 1 to equal 2\n", status: "FAIL" }],
  };
  const p = buildReviewPrompt(mkTask(), validation, RES);
  assert.ok(p.includes("exit_code: 1"));
  assert.ok(p.includes("AssertionError"), "应包含 stderr 证据");
  assert.ok(p.includes("validation_status: FAIL"));
  assert.ok(!p.includes("validation_status: PASS"));
});

// ── Test 3（最关键）：Worker 自述与 Validation 冲突 ⇒ 两组信息同时可见 ─────────────
test("Test3: Worker 自述与调度器证据冲突时，两组信息必须同时呈现", () => {
  const task = mkTask({
    result: {
      summary: "tests were not executed in this environment",
      modified_files: ["lib/a.ts"],
      tests: [{ name: "node test.js", result: "fail" }],
      issues: ["I was not allowed to execute commands"],
    },
  });
  const validation = {
    pass: true,
    detail: "✓ run: node test.js exit 0",
    checks: [{ kind: "run", raw: "run: node test.js", command: "node test.js", exitCode: 0, stdout: "all tests passed (9/9)\n", stderr: "", status: "PASS" }],
  };
  const p = buildReviewPrompt(task, validation, RES);
  // Worker 原始报告保留
  assert.ok(p.includes("[WORKER REPORT"), "Worker 报告不得被删除");
  assert.ok(p.includes("tests were not executed"), "Worker 自述保留");
  assert.ok(p.includes("I was not allowed to execute commands"), "Worker issues 保留");
  // 调度器证据同时呈现
  assert.ok(p.includes("exit_code: 0"), "调度器 exit_code 必须出现");
  assert.ok(p.includes("all tests passed"), "调度器 stdout 必须出现");
  assert.ok(p.includes("conflict".slice(0, 3)) || p.includes("冲突"), "应提示冲突以事实为准");
});

// ── Test 4：invalid verdict + validation PASS ⇒ 仍不得 PASS ───────────────────
test("Test4: validation PASS 不能替代 Review（invalid verdict 仍判 FAIL）", () => {
  const o = classifyReviewOutcome({ exitCode: 0, raw: { verdict: "MAYBE" }, resFileExists: true });
  assert.equal(o.kind, "invalid_verdict", "非法 verdict 必须被识别");
  assert.notEqual(o.verdict && o.verdict.verdict, "PASS", "非法 verdict 绝不产生 PASS");
  // 证据块本身不含任何 verdict 字段/结论（不得影响 verdict 判定）
  const block = formatValidationEvidence({ pass: true, checks: [{ kind: "run", raw: "run: node test.js", command: "node test.js", exitCode: 0, stdout: "ok", stderr: "", status: "PASS" }] });
  assert.ok(!/"verdict"\s*:/.test(block), "证据块内不得出现 verdict 字段");
  assert.ok(block.includes("本证据不构成通过结论"), "证据块必须声明不构成通过结论");
  assert.ok(!/所以必须\s*PASS|must pass/i.test(block), "证据块不得诱导 PASS");
});

// ── Test 5：Reviewer process failure + validation PASS ⇒ review-unavailable → retry ──
test("Test5: validation PASS + Reviewer 进程失败 ⇒ review-unavailable → retry（安全语义不变）", () => {
  const o = classifyReviewOutcome({ exitCode: 1, raw: null, resFileExists: false, stderrTail: "boom" });
  assert.equal(o.kind, "process_failure");
  const reason = `review-unavailable: ${o.code} Reviewer 不可用`;
  // fixture 必须是合法的 DAG task（含 id）：缺 id 会把产物写成 .ai/evaluations/undefined.json，
  // 与其他测试文件并行时争抢同一路径 → Windows rename EPERM。
  const ev = evaluateFailure({ id: "TASK-EV-1", failure_reason: reason, failure_history: [reason], retry_count: 0 }, { agents: [] });
  assert.equal(ev.suggested_action, "retry", "进程失败走 retry，不得直接 DONE/PASS");
});

// ── Test 6：验收命令本身失败（exit != 0）⇒ 证据正确传达 ────────────────────────
test("Test6: 验收命令执行失败时，失败证据完整进入 prompt", () => {
  const validation = {
    pass: false,
    checks: [
      { kind: "run", raw: "run: node scripts/x.test.mjs", command: "node scripts/x.test.mjs", exitCode: 127, stdout: "", stderr: "Cannot find module 'scripts/x.test.mjs'", status: "FAIL" },
      { kind: "file", raw: "file: docs/x.md", path: "docs/x.md", status: "FAIL", detail: "文件缺失" },
    ],
  };
  const p = buildReviewPrompt(mkTask(), validation, RES);
  assert.ok(p.includes("exit_code: 127"));
  assert.ok(p.includes("Cannot find module"));
  assert.ok(p.includes("validation_status: FAIL（0/2 项通过）"));
  assert.ok(p.includes("文件缺失"), "file 项证据同样传达");
});

// ── Test 7：大 stdout/stderr ⇒ 正确截断且保留核心信息 ─────────────────────────
test("Test7: 超大 stdout/stderr 被截断，command/exit_code 与截断标记保留", () => {
  const big = "line of log output\n".repeat(5000); // ≈100KB
  const validation = {
    pass: false,
    checks: [{ kind: "run", raw: "run: node big.js", command: "node big.js", exitCode: 1, stdout: `HEAD-MARKER\n${big}\nTAIL-MARKER`, stderr: `ERR-HEAD\n${big}\nERR-TAIL`, status: "FAIL" }],
  };
  const block = formatValidationEvidence(validation);
  assert.ok(block.length <= 2400 + 200, `证据块应受 maxTotal 限制（实际 ${block.length}）`);
  assert.ok(block.includes("truncated"), "应含截断标记");
  assert.ok(block.includes("command: node big.js"), "command 必须保留");
  assert.ok(block.includes("exit_code: 1"), "exit_code 必须保留");
  assert.ok(block.includes("HEAD-MARKER") && block.includes("TAIL-MARKER"), "stdout 首尾信息保留");
  const p = buildReviewPrompt(mkTask(), validation, RES);
  assert.ok(p.length < 20000, `prompt 不得被日志撑爆（实际 ${p.length}）`);
});

// ── 附加 1：无验收命令时明确告知"无客观证据"（不得伪造） ────────────────────────
test("附加1: 无验收证据时明确标注无法提供客观执行证据", () => {
  const p = buildReviewPrompt(mkTask({ acceptance_criteria: ["人工核对交付文档"] }), { pass: true, checks: [] }, RES);
  assert.ok(p.includes("无法提供客观执行证据"));
  assert.ok(!p.includes("[VALIDATION EVIDENCE（调度器实际执行结果"));
});

// ── 附加 2：truncateMiddle 单元语义 ──────────────────────────────────────────
test("附加2: truncateMiddle 保留首尾并对短文本零改动", () => {
  assert.equal(truncateMiddle("short", 100), "short");
  const t = truncateMiddle("A".repeat(50) + "B".repeat(50), 20);
  assert.ok(t.startsWith("A"));
  assert.ok(t.includes("truncated"));
  assert.ok(t.length <= 20 + 40);
});
