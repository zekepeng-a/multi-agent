// memory-attribution.test.mjs —— V0.5.7 Controlled Verification（确定性，不依赖真实 LLM）
//
// 目的：把「Memory → Context → Planner 声明 → 引用校验」这条链做成**可复现的控制实验**，
// 从而把 Memory 来源与「项目文件可见性」这一混淆变量分离：
//   Group A：Decision 只存在于 Memory store（项目文件中不存在）→ 被召回 → Planner 引用 → valid
//   Group B：同一 Decision 只放进项目文件（Memory 中不存在）→ 未进入 Context → Planner 引用 → invalid_memory_reference
// 若两组结果相同，说明 attribution 无法区分来源；本测试要求两者**必须不同**。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { assembleContext } = await import(pathToFileURL(path.join(ROOT, "context.mjs")).href);
const { validateMemoryRefs } = await import(pathToFileURL(path.join(ROOT, "orchestrator.mjs")).href);

// ── 测试夹具 ────────────────────────────────────────────────────────────────
const DECISION_TEXT = "为避免历史版本中的兼容性问题，该模块后续必须保持 API X 的参数顺序（seed 参数必须排在 limit 之前），且不得为兼容新参数而重排既有位置参数。";

const mkWorkdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "attr-"));
const cleanup = (d) => fs.rmSync(d, { recursive: true, force: true });

/** 写入一条 Memory（模拟 distiller 产出） */
function writeMemory(workdir, type, id, { title, content, tags = ["api", "兼容性", "参数顺序"] }) {
  const dir = path.join(workdir, ".ai", "memory", type);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify({
      id,
      type,
      title,
      content,
      tags,
      source: { kind: "plan-decision", file: ".ai/tasks.json" },
      provenance: { kind: "plan-decision", file: ".ai/tasks.json" },
    }),
    "utf-8"
  );
}

/** 把同一段内容写进**项目文件**（作为 Group B 的对照：只存在于文件，不存在于 Memory） */
function writeProjectFile(workdir, relPath, text) {
  const p = path.join(workdir, relPath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `# 模块约束\n\n${text}\n`, "utf-8");
}

const TASK = {
  id: "S2",
  title: "为目标调整记录实现后端接口，保持 API 参数顺序与兼容性",
  description: "实现后端接口与参数顺序约定，注意兼容性与位置参数不得重排",
  required_capability: "coding",
};

const mkPlan = () => ({
  plan: { goal: "g", assumptions: ["a1"], risks: ["r1"], architecture_decisions: [{ decision: "d1" }, { decision: "d2" }] },
  tasks: [{ id: "TASK-001" }, { id: "TASK-002" }],
});

// ── §16 Group A：Memory-only（决定性正例） ──────────────────────────────────
test("GroupA: Memory-only Decision → 被召回 → 进入 Context 文本 → Planner 引用 → valid", () => {
  const d = mkWorkdir();
  try {
    writeMemory(d, "decisions", "decision-mm000001", { title: "架构决策：API X 参数顺序兼容性约束", content: DECISION_TEXT });
    const ctx = assembleContext({ workdir: d, currentTask: TASK, budgetChars: 6000, topK: 12 });

    // 1) 被检索并选中
    assert.equal(ctx.selected.length, 1, "应召回该 memory-only decision");
    assert.equal(ctx.selected[0].id, "decision-mm000001");
    // 2) 注入文本必须携带 memory_id（否则 Planner 无法引用）
    assert.ok(ctx.sections.decisions.includes("memory_id=decision-mm000001"), "注入文本必须含 memory_id");
    // 3) Planner（fixture 输出，模拟 LLM）声明使用它
    const plannerOutput = {
      ...mkPlan(),
      plan: {
        ...mkPlan().plan,
        memory_refs: [
          {
            memory_id: "decision-mm000001",
            affected_output: "TASK-002",
            stance: "adopted",
            effect: "继承该历史决策的兼容性约束：保持 API X 参数顺序，seed 必须排在 limit 之前",
            reason: "避免重排既有位置参数导致的历史兼容性问题",
          },
        ],
      },
    };
    const r = validateMemoryRefs(plannerOutput.plan.memory_refs, { contextMemoryIds: ctx.selected.map((s) => s.id), plan: plannerOutput });
    assert.equal(r.valid.length, 1, JSON.stringify(r.invalid));
    assert.equal(r.valid[0].affected_output, "TASK-002");
    assert.equal(r.summary.contextUnusedCount, 0);
  } finally { cleanup(d); }
});

// ── §13 错误归因：引用了本轮 Context 之外的 memory_id ────────────────────────
test("§13: Planner 声称使用未进入本轮 Context 的 memory_id → invalid_memory_reference", () => {
  const d = mkWorkdir();
  try {
    // 历史库里有 decision-other999，但与本轮 query/tags 零重叠（纯英文主题 + 空 tags ⇒ score=0 被过滤）⇒ 不会被召回
    writeMemory(d, "decisions", "decision-other999", { title: "Pagination and cache TTL policy for export reports", content: "Export report pagination uses cursor tokens with a 300 second cache TTL.", tags: [] });
    writeMemory(d, "decisions", "decision-mm000001", { title: "架构决策：API X 参数顺序兼容性约束", content: DECISION_TEXT });
    const ctx = assembleContext({ workdir: d, currentTask: TASK, budgetChars: 6000, topK: 12 });
    const ctxIds = ctx.selected.map((s) => s.id);
    assert.ok(ctxIds.includes("decision-mm000001"));
    assert.ok(!ctxIds.includes("decision-other999"), "无关条目不得进入本轮 Context");

    const r = validateMemoryRefs(
      [{ memory_id: "decision-other999", affected_output: "TASK-001", effect: "继承该决策的分页与缓存策略约束" }],
      { contextMemoryIds: ctxIds, plan: mkPlan() }
    );
    assert.equal(r.valid.length, 0);
    assert.equal(r.invalid[0].code, "invalid_memory_reference");
  } finally { cleanup(d); }
});

// ── §14 只看到、不使用 ──────────────────────────────────────────────────────
test("§14: Context 含 3 条 Decision 但 Planner 明确未使用（refs=[]）→ PASS，不强制引用", () => {
  const d = mkWorkdir();
  try {
    writeMemory(d, "decisions", "decision-aa000001", { title: "架构决策：API 参数顺序约束 A", content: DECISION_TEXT });
    writeMemory(d, "decisions", "decision-bb000002", { title: "架构决策：API 参数顺序约束 B", content: DECISION_TEXT + "（补充 B）" });
    writeMemory(d, "knowledge", "knowledge-cc000003", { title: "专家意见：API 参数顺序的兼容性核验", content: DECISION_TEXT + "（专家补充）" });
    const ctx = assembleContext({ workdir: d, currentTask: TASK, budgetChars: 6000, topK: 12 });
    assert.ok(ctx.selected.length >= 2, `应召回若干条目（实际 ${ctx.selected.length}）`);

    const r = validateMemoryRefs([], { contextMemoryIds: ctx.selected.map((s) => s.id), plan: mkPlan() });
    assert.equal(r.valid.length, 0);
    assert.equal(r.invalid.length, 0, "未使用不得被视为错误");
    assert.equal(r.summary.contextUnusedCount, ctx.selected.length);
  } finally { cleanup(d); }
});

// ── §16 Group B：项目文件替代解释（决定性对照） ─────────────────────────────
test("GroupB: 同一约束只存在于**项目文件**（Memory 中不存在）→ 未进入 Context → 引用被判 invalid", () => {
  const d = mkWorkdir();
  try {
    writeProjectFile(d, "docs/api-compat-note.md", DECISION_TEXT); // 只写文件，不写 Memory
    const ctx = assembleContext({ workdir: d, currentTask: TASK, budgetChars: 6000, topK: 12 });
    assert.equal(ctx.selected.length, 0, "Memory store 为空 ⇒ 本轮 Context 无 memory 条目");

    // Planner 若声称引用了「项目文件里那条约束」的 memory_id（该 ID 从未进入 Context）
    const r = validateMemoryRefs(
      [{ memory_id: "decision-file00001", affected_output: "TASK-001", effect: "继承项目文档中的 API 参数顺序兼容性约束" }],
      { contextMemoryIds: ctx.selected.map((s) => s.id), plan: mkPlan() }
    );
    assert.equal(r.valid.length, 0);
    assert.equal(r.invalid[0].code, "invalid_memory_reference");
  } finally { cleanup(d); }
});

// ── §16 关键断言：attribution 能区分 Memory 来源与 Project File 来源 ─────────
test("§16: Group A 与 Group B 结果必须不同（attribution 可区分来源）", () => {
  const da = mkWorkdir(), db = mkWorkdir();
  try {
    // Group A：约束在 Memory
    writeMemory(da, "decisions", "decision-mm000001", { title: "架构决策：API X 参数顺序兼容性约束", content: DECISION_TEXT });
    const ctxA = assembleContext({ workdir: da, currentTask: TASK, budgetChars: 6000, topK: 12 });
    const refs = [{ memory_id: "decision-mm000001", affected_output: "TASK-001", effect: "继承该历史决策的 API 参数顺序兼容性约束" }];
    const rA = validateMemoryRefs(refs, { contextMemoryIds: ctxA.selected.map((s) => s.id), plan: mkPlan() });

    // Group B：同一约束只在项目文件（Memory 空）
    writeProjectFile(db, "docs/api-compat-note.md", DECISION_TEXT);
    const ctxB = assembleContext({ workdir: db, currentTask: TASK, budgetChars: 6000, topK: 12 });
    const rB = validateMemoryRefs(refs, { contextMemoryIds: ctxB.selected.map((s) => s.id), plan: mkPlan() });

    assert.equal(rA.valid.length, 1, "Group A 应验证通过（Memory 来源）");
    assert.equal(rB.valid.length, 0, "Group B 应验证失败（项目文件来源，且未进入 Context）");
    assert.equal(rB.invalid[0].code, "invalid_memory_reference");
    assert.notDeepEqual(rA.summary.validCount, rB.summary.validCount, "两组结果必须可区分");
  } finally { cleanup(da); cleanup(db); }
});

// ── §21：推翻历史决策同样算"使用"（stance 维度） ────────────────────────────
test("§21: Planner 推翻历史 Decision（stance=rejected）→ 仍为合法引用（使用的一种）", () => {
  const d = mkWorkdir();
  try {
    writeMemory(d, "decisions", "decision-mm000001", { title: "架构决策：API X 参数顺序兼容性约束", content: DECISION_TEXT });
    const ctx = assembleContext({ workdir: d, currentTask: TASK, budgetChars: 6000, topK: 12 });
    const r = validateMemoryRefs(
      [{ memory_id: "decision-mm000001", affected_output: "architecture_decisions[0]", stance: "rejected", effect: "该历史约束在当前需求下不成立：新接口不需要保持旧参数顺序，予以推翻", reason: "本需求为独立新接口" }],
      { contextMemoryIds: ctx.selected.map((s) => s.id), plan: mkPlan() }
    );
    assert.equal(r.valid.length, 1, JSON.stringify(r.invalid));
    assert.equal(r.valid[0].stance, "rejected");
  } finally { cleanup(d); }
});

// ── 只读性：整套 controlled 流程不得写入 Memory ─────────────────────────────
test("只读性: 组装 Context + 校验 attribution 不修改 Memory 文件", () => {
  const d = mkWorkdir();
  try {
    writeMemory(d, "decisions", "decision-mm000001", { title: "架构决策：API X 参数顺序兼容性约束", content: DECISION_TEXT });
    const file = path.join(d, ".ai", "memory", "decisions", "decision-mm000001.json");
    const before = fs.readFileSync(file, "utf-8");
    const ctx = assembleContext({ workdir: d, currentTask: TASK, budgetChars: 6000, topK: 12 });
    validateMemoryRefs([{ memory_id: "decision-mm000001", affected_output: "TASK-001", effect: "继承该历史决策的兼容性约束" }], { contextMemoryIds: ctx.selected.map((s) => s.id), plan: mkPlan() });
    assert.equal(fs.readFileSync(file, "utf-8"), before, "Memory 文件不得被修改");
  } finally { cleanup(d); }
});
