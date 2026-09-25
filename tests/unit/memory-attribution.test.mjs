// memory-attribution.test.mjs —— V0.5.7：Planner memory_refs 的引用合法性校验（单元）
//
// 定位：attribution 是**审计声明**，不是 Runtime 判定的因果真理。
// Runtime 只做机械检查：memory_id ∈ 本轮 Context、affected_output 可定位、stance 合法、effect 具体。
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { validateMemoryRefs } = await import(pathToFileURL(path.join(ROOT, "orchestrator.mjs")).href);

const CTX = ["decision-aaaa1111", "decision-bbbb2222", "knowledge-cccc3333"];
const mkPlan = (over = {}) => ({
  plan: {
    goal: "g",
    assumptions: ["a1", "a2"],
    risks: ["r1"],
    architecture_decisions: [{ decision: "d1" }, { decision: "d2" }, { decision: "d3" }],
    ...(over.plan || {}),
  },
  tasks: [{ id: "TASK-001" }, { id: "TASK-002" }, ...(over.tasks || [])],
});

// ── 正向：合法引用 ───────────────────────────────────────────────────────────
test("A1: 合法引用（memory_id ∈ Context + TASK 存在 + effect 具体）→ valid", () => {
  const r = validateMemoryRefs(
    [{ memory_id: "decision-aaaa1111", affected_output: "TASK-002", stance: "adopted", effect: "继承「纯函数追加到既有模块，不新建文件」的落点约束", reason: "避免第二套口径" }],
    { contextMemoryIds: CTX, plan: mkPlan() }
  );
  assert.equal(r.valid.length, 1);
  assert.equal(r.invalid.length, 0);
  assert.equal(r.valid[0].memory_id, "decision-aaaa1111");
  assert.equal(r.summary.validCount, 1);
  assert.deepEqual(r.summary.stances, { adopted: 1 });
});

test("A2: architecture_decisions[i] / assumptions[i] / risks[i] 均可定位", () => {
  const r = validateMemoryRefs(
    [
      { memory_id: "decision-aaaa1111", affected_output: "architecture_decisions[2]", effect: "沿用该决策的接口形态（独立只读路由）" },
      { memory_id: "decision-bbbb2222", affected_output: "assumptions[1]", effect: "继承该假设：不新增持久化字段" },
      { memory_id: "knowledge-cccc3333", affected_output: "risks[0]", effect: "按专家意见把该风险显式列出" },
    ],
    { contextMemoryIds: CTX, plan: mkPlan() }
  );
  assert.equal(r.valid.length, 3, JSON.stringify(r.invalid));
});

// ── 反向：非法引用必须被拒绝 ─────────────────────────────────────────────────
test("B1: memory_id 属于历史库但**不在本轮 Context** → invalid_memory_reference", () => {
  const r = validateMemoryRefs(
    [{ memory_id: "decision-9999ffff", affected_output: "TASK-001", effect: "继承某个历史决策的约束" }],
    { contextMemoryIds: CTX, plan: mkPlan() }
  );
  assert.equal(r.valid.length, 0);
  assert.equal(r.invalid[0].code, "invalid_memory_reference");
});

test("B2: 编造 memory_id → invalid_memory_reference", () => {
  const r = validateMemoryRefs([{ memory_id: "decision-made-up", affected_output: "TASK-001", effect: "继承某项设计约束" }], { contextMemoryIds: CTX, plan: mkPlan() });
  assert.equal(r.invalid[0].code, "invalid_memory_reference");
});

test("B3: affected_output 指向不存在的 TASK → invalid_affected_output", () => {
  const r = validateMemoryRefs([{ memory_id: "decision-aaaa1111", affected_output: "TASK-999", effect: "继承某项设计约束" }], { contextMemoryIds: CTX, plan: mkPlan() });
  assert.equal(r.invalid[0].code, "invalid_affected_output");
});

test("B4: affected_output 为不可定位的笼统描述 → invalid_affected_output", () => {
  for (const bad of ["overall plan", "整个计划", "plan"]) {
    const r = validateMemoryRefs([{ memory_id: "decision-aaaa1111", affected_output: bad, effect: "继承某项设计约束" }], { contextMemoryIds: CTX, plan: mkPlan() });
    assert.equal(r.invalid[0].code, "invalid_affected_output", `${bad} 应被拒绝`);
  }
});

test("B5: architecture_decisions 索引越界 → invalid_affected_output", () => {
  const r = validateMemoryRefs([{ memory_id: "decision-aaaa1111", affected_output: "architecture_decisions[7]", effect: "继承某项设计约束" }], { contextMemoryIds: CTX, plan: mkPlan() });
  assert.equal(r.invalid[0].code, "invalid_affected_output");
});

test("B6: stance 非法 → invalid_stance", () => {
  const r = validateMemoryRefs([{ memory_id: "decision-aaaa1111", affected_output: "TASK-001", stance: "maybe", effect: "继承某项设计约束" }], { contextMemoryIds: CTX, plan: mkPlan() });
  assert.equal(r.invalid[0].code, "invalid_stance");
});

test("B7: effect 空泛 / 过短 → vague_effect", () => {
  for (const eff of ["帮助了规划", "参考", "有帮助", "used", "ok"]) {
    const r = validateMemoryRefs([{ memory_id: "decision-aaaa1111", affected_output: "TASK-001", effect: eff }], { contextMemoryIds: CTX, plan: mkPlan() });
    assert.equal(r.invalid[0].code, "vague_effect", `${eff} 应被判为空泛`);
  }
});

test("B8: 缺 memory_id / affected_output / 非对象元素 → 结构化拒绝", () => {
  const r = validateMemoryRefs(
    [{ affected_output: "TASK-001", effect: "继承某项设计约束" }, { memory_id: "decision-aaaa1111", effect: "继承某项设计约束" }, "decision-aaaa1111", null],
    { contextMemoryIds: CTX, plan: mkPlan() }
  );
  const codes = r.invalid.map((x) => x.code);
  assert.ok(codes.includes("missing_memory_id"));
  assert.ok(codes.includes("missing_affected_output"));
  assert.equal(codes.filter((c) => c === "malformed_ref").length, 2);
  assert.equal(r.valid.length, 0);
});

test("B9: refs 非数组 → not_an_array（不崩溃）", () => {
  for (const bad of ["decision-aaaa1111", 42, { memory_id: "x" }]) {
    const r = validateMemoryRefs(bad, { contextMemoryIds: CTX, plan: mkPlan() });
    assert.equal(r.valid.length, 0);
    assert.ok(r.invalid.some((x) => x.code === "not_an_array"));
  }
});

// ── 状态 A：只看到、不使用（正常情况，不得强迫引用） ─────────────────────────
test("C1: 看到 Memory 但未使用（refs=[]）→ 无 valid 也无 invalid，且统计 unused", () => {
  const r = validateMemoryRefs([], { contextMemoryIds: CTX, plan: mkPlan() });
  assert.equal(r.valid.length, 0);
  assert.equal(r.invalid.length, 0);
  assert.equal(r.summary.contextMemoryCount, 3);
  assert.equal(r.summary.contextUnusedCount, 3);
});

test("C2: refs 缺失（undefined/null）→ 视为未使用（不报错）", () => {
  for (const v of [undefined, null]) {
    const r = validateMemoryRefs(v, { contextMemoryIds: CTX, plan: mkPlan() });
    assert.equal(r.valid.length, 0);
    assert.equal(r.invalid.length, 0);
  }
});

// ── §21：允许推翻/修正历史决策（同样是"使用"） ───────────────────────────────
test("D1: stance=rejected / modified / superseded 均合法（推翻历史决策也算使用）", () => {
  const r = validateMemoryRefs(
    [
      { memory_id: "decision-aaaa1111", affected_output: "TASK-001", stance: "rejected", effect: "该决策的零 schema 变更前提在本需求下不成立，改为新增可选字段", reason: "需求必须持久化历史" },
      { memory_id: "decision-bbbb2222", affected_output: "architecture_decisions[0]", stance: "modified", effect: "在原决策基础上把落点从文件末尾改为标记之前", reason: "避免落入扫描区" },
      { memory_id: "knowledge-cccc3333", affected_output: "risks[0]", stance: "superseded", effect: "该专家意见已被本次咨询的新结论取代", reason: "窗口口径变化" },
    ],
    { contextMemoryIds: CTX, plan: mkPlan() }
  );
  assert.equal(r.valid.length, 3, JSON.stringify(r.invalid));
  assert.deepEqual(r.summary.stances, { rejected: 1, modified: 1, superseded: 1 });
});

test("D2: stance 缺失 → 归一为 adopted 且标记 explicit_stance=false", () => {
  const r = validateMemoryRefs([{ memory_id: "decision-aaaa1111", affected_output: "TASK-001", effect: "继承某项设计约束" }], { contextMemoryIds: CTX, plan: mkPlan() });
  assert.equal(r.valid[0].stance, "adopted");
  assert.equal(r.valid[0].explicit_stance, false);
});

// ── 混合与统计 ──────────────────────────────────────────────────────────────
test("E1: 混合引用（2 合法 + 2 非法）→ 分类正确且 summary 一致", () => {
  const r = validateMemoryRefs(
    [
      { memory_id: "decision-aaaa1111", affected_output: "TASK-001", effect: "继承禁止条件：不新增写路径" },
      { memory_id: "decision-bbbb2222", affected_output: "TASK-002", stance: "rejected", effect: "该决策不适用于本需求，予以推翻" },
      { memory_id: "decision-zzzz", affected_output: "TASK-001", effect: "继承某项设计约束" },
      { memory_id: "decision-aaaa1111", affected_output: "TASK-001", effect: "帮助了规划" },
    ],
    { contextMemoryIds: CTX, plan: mkPlan() }
  );
  assert.equal(r.valid.length, 2);
  assert.equal(r.invalid.length, 2);
  assert.equal(r.summary.declared, 4);
  assert.equal(r.summary.validCount, 2);
  assert.equal(r.summary.invalidCount, 2);
  assert.equal(r.summary.contextUnusedCount, 1); // knowledge-cccc3333 未被引用
});

test("E2: 同一 memory 引用到多个 output → 均合法", () => {
  const r = validateMemoryRefs(
    [
      { memory_id: "decision-aaaa1111", affected_output: "TASK-001", effect: "继承禁止条件：不新增写路径" },
      { memory_id: "decision-aaaa1111", affected_output: "TASK-002", effect: "同一条约束同样适用于实现任务" },
    ],
    { contextMemoryIds: CTX, plan: mkPlan() }
  );
  assert.equal(r.valid.length, 2);
});
