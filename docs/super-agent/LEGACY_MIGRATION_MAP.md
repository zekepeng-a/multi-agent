# LEGACY_MIGRATION_MAP.md

**Status:** INDEPENDENT AUDIT / MIGRATION CANDIDATE MAP — NOT AN ACCEPTED DESIGN  
**Date:** 2026-10-02  
**Repository:** `zekepeng-a/multi-agent`  
**Reviewed branch:** `super-agent/constitution-v0.1`  
**Reviewed HEAD:** `36eda87644c589a11dddb9aa775eb8831ec642af`  
**Project Control G8 baseline:** `79f03e1c0fc680b6876428e3dd26c6f616817cf7`

本文件回答“哪些旧问题仍值得解决，以及旧资产应处于什么位置”，不决定未来模块、Agent 数量、实现方案或开发阶段。所有分类都是审计建议，不授权代码迁移、删除、重构或新功能。没有改变 roadmap、ADR 或任何实现。

审计基线时 GitHub Constitution 仍为 **PROPOSED R2 / NOT YET ACCEPTED**，Legacy Asset Audit 为 **FIRST-PASS STATIC AUDIT**。“文档已完成”不能解释为 Human 已接受。本地图采用其中明确的防污染原则，但不把 proposal 或前次模型审查当成架构权威。

**Repository recording note — 2026-10-02:** 本地图按原审计基线完整纳入治理目录；原分类、历史数量、37 项 inventory、风险、范围缺口和优先级均保留。当前 Constitution 已提议 R3（仍未接受）；参见 [Convergence Record](SA0_CONVERGENCE_RECORD.md)。此记录不升级地图为接受后的设计或代码迁移许可。

## 1. Evidence boundary and reading coverage

### 1.1 Git 与读取方式

已通过 GitHub ref 验证审查 HEAD。GitHub compare 证明它相对 G8 baseline 只新增九份 Super Agent 文档，既有源码、测试和 Project Control 文档未变。因此：Super Agent 文档依据固定 GitHub HEAD；既有实现通过内容等价的本地 G8 checkout 阅读，不依赖聊天历史恢复实现事实。

固定基线入口：[Constitution][constitution]、[Legacy Audit][legacy-audit]、[Evaluation Baseline][evaluation]、[Reality][sa-reality]、[SA Roadmap][sa-roadmap]、[Blueprint][blueprint]、[canonical architecture][canonical]、[current implementation map][pc-reality]、[Roadmap][roadmap]。

### 1.2 核心源码 inventory

已检查以下全部 legacy 核心文件及真实调用链，不只依赖模块注释：

| 路径 | 检查内容 |
|---|---|
| [orchestrator.mjs][orchestrator] | load/save、两阶段 Planner、consultation、Precheck、dependency status、matching、contract、dispatch、validation、review、failure evaluation、Replan、parallel loop、messages、runs、scope warning、report、refresh |
| [executors.mjs][executors] | 三类 CLI adapter、result-file collector、error/result normalization、timeout/cancel、in-memory handles、resolver fallback |
| [planner-lifecycle.mjs][planner] | normalization、stage validation、finalization、publication、identity、canonical digest、identity checking |
| [file-wait.mjs][file-wait] | JSON parsing、size stability、deadline、stale-invalid handling、rename/copy publication |
| [distiller.mjs][distiller] | source scanning、model output → decision/knowledge、lesson aggregation、agent statistics、IDs、upsert、rebuild |
| [retriever.mjs][retriever] | tokenization、scoring、type filtering、topK、content truncation、provenance |
| [context.mjs][context] | task/state input、selection priority、budget estimate、rendering、source display |
| [state-summary.mjs][summary] | derived status/decisions/next actions、write/read behavior |
| [.ai/agents/registry.json][registry] | identity/model/backend/score/tools/permission declarations与实际消费路径 |
| [examples/legacy/team.js-demo-2026-08-26.js][demo] | 历史只读 CLI、表格/JSON 输出、配置与状态读取；不是当前产品入口 |

同时检查 legacy architecture / memory / configuration / testing / limitations 文档、package scripts、Git ignore 和相关 Git 变更历史。Project Control 覆盖判断以当前 domain/store/controller/runtime/workspace/policy/memory/capsule 边界及其 tests/Evidence 为准，不能把 canonical schema sketch 算作已实现能力。

### 1.3 测试读取范围与证明边界

已阅读全部 17 份 legacy unit/integration 测试：

| 测试路径 | 真正证明什么 | 不证明什么 |
|---|---|---|
| `tests/unit/orchestrator.test.mjs` | 非法 task element 过滤、半写等待、BOM、import guard | 完整 Manager 控制闭环正确 |
| `tests/unit/planner-semantic.test.mjs` | 空/中间 JSON 的等待与谓词行为 | 计划符合真实目标、合法授权或完整验收 |
| `tests/unit/planner-invalid-json-stale.test.mjs` | stale-invalid、增长中 JSON、deadline 区分 | producer 停止写入或输入已经最终交付 |
| `tests/unit/planner-lifecycle.test.mjs` | stage validation、marker/finalize、初次发布 digest 可复算 | 所有实际消费路径均重新验证内容与 identity |
| `tests/unit/artifact-identity.test.mjs` | identity 字段差异检测、canonical digest 与 lineage 示例 | 带旧 digest 的内容篡改一定被拒绝 |
| `tests/unit/validation.test.mjs` | 命令说明清洗、引号、原文本保留 | shell 安全、Permission、完整 Acceptance |
| `tests/unit/reviewer.test.mjs` | verdict/infra failure 分类及不默认 PASS | 语义 verdict 真实、Reviewer 独立可信、安全重试 |
| `tests/unit/review-evidence.test.mjs` | worker report 与 validation evidence 共同进入 prompt | 持久证据完整性、实际 Reviewer 正确判断 |
| `tests/unit/distiller.test.mjs` | 去重、聚合、数量级重建、坏数据跳过、Planner decision 蒸馏 | 知识真实性、Memory 晋升权限、source validity |
| `tests/unit/retriever.test.mjs` | 分词、确定性排名、type filter | 来源当前有效、召回质量或复杂任务收益 |
| `tests/unit/context.test.mjs` | 样例预算、priority、provenance、只读 | 最终完整输入预算、必要约束完整性、freshness |
| `tests/unit/state-summary.test.mjs` | section 内容、样例一致性、原 tasks 不修改 | 跨时间 byte-identical、当前权威状态或恢复正确 |
| `tests/unit/memory-attribution.test.mjs` | 本轮 ID membership、输出定位、stance/effect 校验 | 模型实际因果依赖、来源真实、Decision 被合法推翻 |
| `tests/integration/executors.test.mjs` | resolver/registry 结构、BOM；还固化未知 backend fallback | 真实 CLI 交付、权限 enforcement、provider parity |
| `tests/integration/memory-attribution.test.mjs` | controlled fixture 能区分 Memory 与非 Memory 引用 | live model 真正使用了来源、来源事实正确 |
| `tests/integration/planner-finalization.test.mjs` | scripted writer 的半写/骨架/marker/fallback 与 publication | 活跃 producer 下的完整原子交付保证 |
| `tests/integration/artifact-identity.test.mjs` | 手工组装的 publish/accept/attribution/tasks/run 链 | 生产 `doReplan()` 切换了 owning plan 或历史被完整保留 |

本任务没有重跑测试，也没有运行真实付费模型/CLI。以上是源码和 assertion 范围审查，不是新的 CI PASS 报告。不得以历史测试数量代替迁移适用性证明。

### 1.4 历史报告 inventory 与缺口

| 材料 | 来源与可用性 | 审计用途 |
|---|---|---|
| [V0.5-OPEN-SOURCE-READINESS.md][readiness] | Git-tracked，2026-09-01 | 当时的配置化、开源检查、25-test/E2E 报告；历史数量原样保留，不外推当前能力 |
| [V0.5-GITHUB-PUBLISH-REPORT.md][publish-report] | Git-tracked，2026-09-01 | 发布记录明确远端 CI NOT VERIFIED；不能把 workflow 存在当作 CI 成功 |
| [docs/releases/v0.5.0.md][release] | Git-tracked，2026-09-27 | 当时 142/142 报告、R1/R3 与八项 debt；PASS 不意味着满足新的 Project Control invariants |
| `CHANGELOG.md` 与 legacy 相关 Git commits | Git-tracked | BOM/requires_review/distillation、半写、语义完成、stale-invalid、review evidence、attribution、finalization、R1/R3 的演变链 |
| `docs/architecture/FINAL_ARCHAEOLOGY.md` / `ARCHAEOLOGY_CLOSURE.md` | Git-tracked，Project Control 时代 | 对照新权威边界；不是 legacy runtime 的 live execution proof |
| 工作区 `outputs/multi-agent-analysis.md` | 未入库的旧审查，声明源 SHA `aeb306af...` | 当时风险线索；相关结论须由当前同等源码重新核实，其建议不是当前授权 |
| 工作区 `work/multi-agent/test-results.txt` | 未入库的历史 142-pass 输出 | 补充历史记录；缺少当前 HEAD 的完整独立绑定，不能用于本次新 PASS 声明 |
| `V0.5-FINAL-Architecture-Audit.md` | readiness 报告引用，但未在已检查 Git 文件/可用路径历史中找到 | **UNAVAILABLE**；不推断其审查内容，不声称已阅读 |
| 原始本机 GPT↔DSH 对话/现场 E2E `.ai` artifacts | 未在可用仓库/审查工作区中找到完整集合；`.ai` 运行态被 Git ignore | **UNAVAILABLE / INCOMPLETE**；不能重建遗漏的人工介入、输入或效果事实 |

因此本地图完成的是**可访问核心源码、全部 legacy tests 和可追溯历史材料的审计**，不是“所有原始历史报告均已恢复”。缺失材料限制性能、事故频率与现场成功率结论，但不妨碍对可见权威污染路径作出分类。

## 2. Classification and priority vocabulary

- **KEEP CONCEPT**：保留其解决问题的价值；重新决定实现，不继承旧模块或默认架构。
- **REBUILD**：问题仍有价值，但旧协议/实现不能继承。若现有 Project Control 已覆盖，优先沿用该边界，不能因为此标签再造一套。
- **DEMOTE**：只作为辅助视图、建议、分析或 provider-local capability；没有 Project State、Decision、Memory promotion、Permission 或 Acceptance 权威。
- **RETIRE**：从未来权威链和迁移依赖中排除；建议最终删除/隔离对应运行路径，但本任务不执行删除。历史代码、失败案例和测试可继续保留供考古。

优先级只表示**审计与迁移决策优先级**，不是 roadmap 或编码顺序：

- **MP0 — 排除污染**：先明确不可继承的 authority / unsafe recovery / fallback。
- **MP1 — 对照现有覆盖**：优先识别重复能力、契约冲突和可复用的问题定义。
- **MP2 — 需求与价值验证**：仅当具体 long-horizon failure 或公平评测证明需要时考虑。
- **MP3 — 辅助候选**：低优先、按真实使用需要再评估。
- RETIRE 不取得迁移优先级；其 MP0 是排除优先级。

下文“核心”指语义责任是否应维持，不表示旧组件必须成为独立模块或未来最终系统一定采用它。

## 3. Asset inventory and value assessment

每项均回答：解决什么问题、问题是否仍存在、Project Control 是否已覆盖、是否应成为 Super Agent 核心能力。风险与生态位置通过相同 ID 对应下一节。

| ID / 资产 / 分类 | 解决的问题 | 问题仍存在？ | 当前 Project Control 覆盖 | 核心能力判断 |
|---|---|---|---|---|
| A01 Global Manager authority — RETIRE | 汇总计划、执行、验收、状态、恢复、Memory | 协调需要仍在；集中混合权威不应保留 | Controller/store 分离控制事实；bounded G8 已验证组合 | 保留协调责任，不保留旧 Manager 总权威 |
| A02 `.ai/tasks.json` / `.ai/state.json` truth — RETIRE | 跨会话保存任务与阶段 | 耐久状态需要仍在 | Store/CAS/events/replay/SQLite 已覆盖控制状态 | 耐久控制语义是核心；旧双文件 truth 不是 |
| A03 Two-phase Planner — REBUILD | 从目标提出可执行分解 | 复杂任务可能需要；简单任务未必 | Goal/Task/Contract 提供承载；没有证明智能分解能力 | 可选执行建议能力，不冻结两阶段或独立 Planner |
| A04 Expert consultation — DEMOTE | 针对不熟悉领域补充分析 | 可能存在，须按任务验证 | 可作为候选来源；PC 不负责产生专业知识 | 不设为固定核心角色 |
| A05 Agent identity ≠ Model — KEEP CONCEPT | 分离执行身份与模型配置 | 存在 | I-07 与 RuntimeRef/capability 已有相关边界；没有完整通用 Agent Registry | 身份分离是语义核心；旧角色清单不是 |
| A06 Registry matching / static scores — REBUILD | 将任务匹配可执行能力 | provider/strategy 选择问题存在 | Adapter capabilities 覆盖接口能力，不覆盖质量路由 | 可选选择能力，不能用静态分数证明适配或授予权限 |
| A07 DAG/dependency scheduling — KEEP CONCEPT | 表达前置依赖与就绪顺序 | 部分任务存在 | PC hierarchy/aggregation 不等于执行 DAG scheduler | 可选策略；不以 DAG 或 multi-agent 定义产品 |
| A08 Plan Precheck — REBUILD | 在执行前拒绝坏依赖、输入和路由 | 存在 | ownership、pins、Policy、Workspace、Capsule 有相应 fail-closed 检查；未覆盖所有执行计划 | 准入检查责任必要；旧七项检查不是完整契约 |
| A09 Parallel batches — KEEP CONCEPT | 缩短可分解任务的完成时间 | 对可并行任务可能存在 | WorkspaceManager 已提供 bounded isolation/integration，非通用并行调度 | 可选优化；需证明集成成本与收益 |
| A10 Scope/change detection — REBUILD | 识别越界写入及冲突 | 存在 | G6 Workspace access/write scope 与 integration 冲突检查已覆盖 bounded 写入路径 | 写权限边界重要；旧声明比较/告警不迁入 |
| A11 Executor/provider seam — KEEP CONCEPT | 隔离 provider 调用差异 | 存在 | ADR-0004、Runtime Adapter、LocalProcess/DSH substitution 已覆盖 bounded seam | 替换能力是语义核心；无需第二个 legacy Executor 层 |
| A12 Claude/DSH/Codex CLI executors — REBUILD | 接入真实执行工具 | 具体 provider 需求可能存在 | LocalProcess 与 DshWorkflow adapter 已有 bounded 实现；不等同旧 Claude/Codex headless 各路径完整证明 | 生态插件候选，不绑定某 provider 为核心 |
| A13 Unknown provider/default worker fallback — RETIRE | 配置错时仍继续执行 | 可用性需求存在，静默替换做法不可继承 | Unsupported capability / fail-closed 边界已存在 | 不是核心；不能以保证闭环替代合法执行 |
| A14 Normalized Result/Error — KEEP CONCEPT | 控制层理解不同 runtime 的观察 | 存在 | RuntimeObservation/Result/Ref 与 Evidence pipeline 已覆盖 bounded contract | 输入输出语义需要；旧 completed envelope 不继承权威 |
| A15 Failure taxonomy/evaluator — REBUILD | 区分 infra、plan、validation 失败 | 存在 | Run/Attempt/Effect/Policy/Acceptance 已区分控制失败；没有完整智能诊断 | 分类责任重要；推理建议可选且无转换权威 |
| A16 Retry budgets / worker switching — REBUILD | 有限地恢复失败 | 存在 | Effect UNKNOWN reconciliation、Run recovery、Capsule no-blind-retry 已覆盖关键安全语义 | 安全恢复是核心；次数有界本身不足以授权重试 |
| A17 Local Replan / completed-work reuse — REBUILD | 修正计划且避免重复有效工作 | 长期项目可能需要 | 新 Run lineage、pins/Acceptance 有控制基础；没有智能重规划协议 | 可选执行适应能力，不能改变目标/验收权威 |
| A18 stale-running → pending recovery — RETIRE | 重启后不永久卡住 | 问题仍在，旧推导不安全 | 既有 LOST/BLOCKED/reconciliation 与 durable restart 边界覆盖 bounded 场景 | 保留耐久恢复责任；不保留“重启即重发” |
| A19 Worker result-file collection / live handles — REBUILD | 观察执行返回、超时及取消 | 存在 | Adapter result/receipt 与 G8 durable-result bounded proof；任意 in-flight provider recovery 仍未普遍证明 | 必要观察责任；旧文件路径/进程 Map 不是耐久事实 |
| A20 Artifact identity/hash/lineage — KEEP CONCEPT | 确定消费哪份计划与来源版本 | 存在 | PC pins、Memory source refs、Capsule canonical hash 有已接受实现；执行计划 identity 尚未决定 | 可追溯性是核心；旧 planId/digest 协议不可直接复制 |
| A21 Planner finalization/publication/file wait — REBUILD | 拒绝中间态、半写与坏 JSON | provider 若输出文件仍存在 | Capsule 正式快照/receipt 已区分持久化与交付；不通用处理任意模型文件流 | provider-local 问题，不设全局文件协议 |
| A22 Legacy validation→completed gate — RETIRE | 判断任务是否完成 | 验证需要仍在 | Task/parent contract-bound Evidence→Verification→Acceptance 已覆盖 | 验收责任是核心；旧 gate 会污染它 |
| A23 Model Reviewer semantic opinion — DEMOTE | 查找测试以外的缺陷 | 可能存在 | Verification 接口/Acceptance 权威已存在；实质 verifier 仍按 contract 提供 | 可作为分析/验证贡献，不是新的 Acceptance owner |
| A24 Validation evidence presentation — KEEP CONCEPT | 防止 Reviewer 仅相信 worker 自述 | 存在 | durable Evidence/Verification 已承载；Capsule 保留 source identity/authority | 可复核证据是核心；旧 prompt 格式不是 |
| A25 Planner/Replan→durable decision distillation — RETIRE | 跨会话积累设计取舍 | 记住经接受决定有价值，自动晋升没有 | ADR-0007 Decision、ADR-0008 promoted Memory 已覆盖权威边界 | 不迁移旧晋升链或历史条目作为已接受知识 |
| A26 Lesson candidate extraction — DEMOTE | 从失败记录提出经验 | 可能存在 | Memory 接受经验证 LESSON；没有自动 distillation pipeline，且 G7.3 明确 non-goal | 可选候选生成，不授予可信度 |
| A27 Agent performance statistics — DEMOTE | 观察 provider/执行身份表现 | 评测与选择可能需要 | Event/Run 等已有事实；不存在通用质量评分平台 | 辅助测量，不自动成为路由/Memory 权威 |
| A28 Keyword Retriever — DEMOTE | 按相关性找到历史信息 | 存在 | Memory current-use eligibility-before-ranking 已覆盖最小查询 | 检索需求有价值；旧词频算法不是核心架构 |
| A29 Bounded Context assembly — REBUILD | 有限输入容量下提供相关上下文 | 存在 | ADR-0009 已覆盖完整 bounded input、required budget、freshness、source authority | 输入边界需要；不再造第二份 Capsule/Project State |
| A30 State Summary — DEMOTE | 人/新 session 快速了解状态 | 存在 | durable control sources 已有；一般 summary 产品视图未普遍实现 | 可选只读视图，不能作为恢复或 readiness 判据 |
| A31 Automatic distill/summary refresh — DEMOTE | 辅助材料及时更新且失败不阻塞主流程 | 辅助刷新可能需要 | source validity/authoritative mutation 已有机制；没有通用 refresh framework | 非核心，不因旧 Hook 存在或缺失引入 framework |
| A32 Agent message file channel — DEMOTE | 交换辅助信息 | 具体协作场景可能存在 | Adapter sendMessage 为 capability；没有通用可信 message bus | 可选 provider-local 协作，不冻结团队/消息系统 |
| A33 Raw run/history provenance — KEEP CONCEPT | 回答谁执行、何时、用了什么结果 | 存在 | Run/Attempt/Event/Effect/Capsule/result proof 已覆盖 bounded lineage | 可审计历史是核心；旧 JSONL/schema 不自动迁移 |
| A34 Final report / team CLI — DEMOTE | 为 Human 显示状态和结果 | 存在 | 控制事实存在，用户视图不等于控制权威 | 可选展示；demo 非最终产品入口 |
| A35 Parsing/BOM/wait/publication utilities — REBUILD | 处理外部格式与文件时序 | 某些 provider 存在 | 各现有边界有自己的序列化/完整性规则；不缺一个通用 utility subsystem | 非核心；只按具体独立需要审查，非整文件 KEEP |
| A36 Legacy regression fixtures/tests — KEEP CONCEPT | 保存曾发生的失败与负例 | 存在 | PC tests 验证新边界；不能代替所有旧 failure 经验 | 质量资产，不能把旧 assertion 当新规范 |
| A37 CLI/env/config surface — DEMOTE | 配置模型、工具与本机入口 | 存在 | capability-shaped adapters 与 trusted profiles 已有部分承载 | 辅助部署配置，旧 defaults 不成为产品身份 |

## 4. Risk assessment, future ecosystem position and migration priority

风险来自当前源码或测试范围，均指**若继承旧路径**的风险；不要求修复冻结 V0.5，也不声称当前 Project Control 存在相同缺陷。

| ID | 迁移风险与可检查依据 | Future ecosystem position | Priority |
|---|---|---|---|
| A01 | `main/runTask/plan` 同时决定任务、执行、completed 和 Memory；会回收 Control Plane 权威 | 排除全局权威；协调概念只能在现有控制边界之内 | MP0 |
| A02 | `save()` 两次文件写入不是一个 state/events/replay 事务；混合 plan 与 task state，成为第二 truth | 旧运行态隔离为历史材料；不自动导入 authoritative store | MP0 |
| A03 | Planner 自产 acceptance_criteria/architecture_decisions；fallback 硬编码 server.js/test.js 且无完整 identity | 可选、非权威的 planning proposal | MP2 |
| A04 | `consultExpert` 文件存在即可降级采信；stage2 prompt 要求直接采信，旧意见缺本轮 immutable pin | 辅助分析来源，不能直接成为 evidence 或约束 | MP2 |
| A05 | agent 名称/role/model 字段可能被误当能力、认证或权限；手工模型字符串不证明可用性 | 与 provider 无关的身份概念候选，不新增认证系统 | MP1 |
| A06 | `pickWorker` 最高分为零仍 matched；assigned_agent 不是严格选择约束；scores 为声明 | 有证据支持时的可选选择机制 | MP2 |
| A07 | 缺失依赖在 `computeStatus` 被过滤，初始 Precheck 与 Replan 不对称；completed 不等于输入仍有效 | 有边界的执行策略候选；不预设必须每 Attempt 重建或全项目共用 | MP2 |
| A08 | 只有初始 `main` 跑 Precheck；旧验证不证明来源、权限和效果安全 | 对照现有 admission 边界，不能独立决定授权 | MP1 |
| A09 | 相同 ROOT、精确字符串冲突检查、未声明文件视为无交集；并行 Replan 共享任务集 | 只在可信 Workspace 约束与公平收益证据下考虑 | MP2 |
| A10 | `scopeViolations` 依赖 worker modified_files，越界仅 warning；不是真实 write enforcement | 沿用已接受 Workspace 控制责任；声明仅作辅助 | MP1 |
| A11 | 第二套 Result/cancel/status 生命周期会与 RuntimeRef/Run/Attempt 分叉 | 现有 Runtime Adapter contract 的问题来源，不另立权威层 | MP1 |
| A12 | 本机路径、权限字段未普遍消费、Codex 固定 bypass 参数、隐藏 provider 默认值 | 有具体需求后逐 provider 审查；不整体移入核心 | MP2 |
| A13 | `resolveExecutor` unknown→Claude；无 worker 时默认 Claude；能力配置错可触发另一路执行 | 不进入未来执行链；保留失败教材 | MP0 |
| A14 | completed 与 tests/files 多为自报；normalization 不证明真实效果或验收 | 控制边界的候选 observation，保留 authority 类型 | MP1 |
| A15 | failure history 字符串匹配，未知种类默认 retry；分类 verdict 容易被误当事实 | 辅助诊断，合法恢复由现有控制规则决定 | MP1 |
| A16 | `runTask` 重试并未以返回 retryable 作为完整安全 gate；limits 不覆盖全部 Planner/Review/consult calls | 条件化恢复能力；不迁移固定计数作为安全证明 | MP0 |
| A17 | Replan 可改 acceptance；按 ID 给新字段继承 completed/result；真实函数未同步 P2 到 tasks.plan/state/currentPlanId | 可选计划建议；旧成果适用性与合法 revision 不能由模型决定 | MP0 |
| A18 | Manager 重启不能证明旧进程终止或效果不存在，直接 requeue 可重复执行 | 排除旧恢复推导，保留 interrupted-work 场景 | MP0 |
| A19 | 文件出现不等于 receipt 或进程停止；_active Map 不耐久；taskId 路径被覆盖，cancel kill 不证明 no-effect | provider observation 适配候选，遵守已有 uncertainty 边界 | MP1 |
| A20 | checker 比较已存 digest 字段不重算内容；orchestrator 对 mismatch 主要记录日志；Replan wiring 与 fixture 不同 | 对照现有 durable identity/pins；计划协议仍待单独决定 | MP1 |
| A21 | stability fallback 不是 producer commit；finalize 后发布再读文件但未完整重验；final write 非 insert-only 快照 | provider-local completion 协议候选，不覆盖 Capsule receipt | MP1 |
| A22 | empty criteria 与普通文本自动 PASS；file-exists 不证明内容；missing requires_review 默认 false | 完成权威只在现有 Acceptance 路径；旧 gate 排除 | MP0 |
| A23 | 有效 PASS/FAIL JSON 优先于过程故障分类；身份不同不等于证据独立；Reviewer Write 非权威授权 | 辅助评语/显式验证贡献；不得自报 role 获权 | MP1 |
| A24 | 截断 prompt 可能丢内容；`recordRun` 未保留调用方传入的完整 validation；展示事实不等于 durable proof | 可读证据视图；完整证据保留由已有边界决定 | MP1 |
| A25 | 模型 architecture_decisions 自动转 decision，再被 context 读取；没有 current source resolver/promotion attestation | 排除旧晋升与自动 migration；历史内容仅候选材料 | MP0 |
| A26 | failure-pattern 粗聚合、review/eval 文件可覆盖、source path 非版本、upsert 丢旧正文 | 可选 LESSON candidate 生成；不得绕过 ADR-0008 | MP3 |
| A27 | `phase=done` 也计 completed，可能统计 failed done phase 为成功；没有 task/model/预算难度控制 | 非权威 measurement；不能直接驱动默认路由 | MP3 |
| A28 | 只按词频/type 排名，不先检 source validity；相关过时信息进入输入；正文被截断 | 仅 current-use 规则之后的可选相关性策略 | MP3 |
| A29 | task 可以已超 budget；state/envelope 未完整计入；两次 state 读取；正文静默 slice；无 freshness | 沿用 Capsule 问题边界；不迁入第二 assembler truth | MP1 |
| A30 | raw task completed/Memory decision 被显示为状态；缺失依赖被视为可继续；生成时间改变输出 | 重建的辅助视图；不用于重放过去输入或改变状态 | MP3 |
| A31 | 先保存状态再派生并不为来源内容提供 version/freshness；吞辅助错误不可吞控制错误 | 非权威维护任务，不改变接受状态 | MP3 |
| A32 | from_agent_id 自报；文件标 delivered 不证明接收；collect/inject 共用状态可能提前消费消息 | 有具体协作需求再考虑；不可传播批准或接受权威 | MP3 |
| A33 | timestamp RunId、分阶段多条记录、TaskId 覆盖 reviews/results、JSON/JSONL 双写；不是稳定 Attempt 证据链 | 审计语义沿用现有 Run/Attempt/Events；旧记录作为标明来源的历史 | MP1 |
| A34 | report 基于旧 self-report；`.ai/report.md` 还经 JSON writer 输出；demo 假定旧目录布局 | 只读解释层，不成为产品 control interface 决策 | MP3 |
| A35 | readJsonStrict 含宽松提取；size stable 不证明内容稳定；copy fallback 非原子且 catch 范围宽 | 小工具按需重新审查；没有全局 utility migration 承诺 | MP3 |
| A36 | assertions 固化 auto-distill/unknown fallback 等旧行为；部分 integration 手工接线跳过生产 Manager | failure corpus/负例；旧 expected result 可转为新规则的拒绝案例 | MP1 |
| A37 | 环境默认值和描述性 model 字符串；reserved/env 文档不全；CLI flags 与实际行为须核验 | 可选部署体验，不把 local defaults 写成宪法 | MP3 |

## 5. Evidence-backed risk clusters

### 5.1 Authority pollution — must not migrate

当前 `Planner architecture_decisions → distiller decision → retriever/context → future Planner` 确实存在。确定性蒸馏没有消除模型来源的不可信性。对应 `distiller.test.mjs` 恰好证明该自动转换发生，而不是证明其适合未来。

Task/Acceptance/Decision/Memory/Policy 的控制权不能从旧 Manager、Reviewer、registry permissions、message 文件或 generated report 继承。合法来源只能通过现有已接受边界参与；不自动把 old completed、PASS、decision、delivered 标签转成新控制事实。

### 5.2 Recovery and effects — bounded is not safe

旧 timeout/non-zero/malformed→retry，以及重启 running→pending，均没有先证明效果未发生。`retryable` 是错误类别字段，不是重发许可。bounded retry 只能限制次数，不能证明重复操作安全；停止/kill 也不是 effect reconciliation。

Project Control 已有 UNKNOWN/reconciliation 与 receipt uncertainty，不能迁入一条更弱的 legacy 快捷路径。当前 prototype 对任意 real in-flight provider recovery 仍有明确边界；缺口不是复活旧 requeue 的理由。

### 5.3 Plan identity and historical continuity

静态源码表明生产 `doReplan()` 创建并发布 P2 后提取 tasks，但未把 P2 的 owning identity 同步到原 tasks.plan/state/currentPlanId。integration artifact test 则在 fixture 中手工完成同步，因此不能覆盖这条真实接线。

本次地图沿用前次独立审查的无文件写入反例，并重新核对 checker 源码：改变 artifact 的 goal、保留旧 planDigest，`computePlanDigest` 已不同，但 `verifyArtifactIdentity` 仍可返回 `IDENTITY CONSISTENT`。这证明的是**字段一致性不等于内容完整性**，不是当前 Capsule 存在同样问题。

Replan 按 ID 继承 completed/result 也不证明当前 contract/source 下有效。旧 checker、RunId、hash ID 或 lineage 字段存在，都不足以授予迁移资格。

### 5.4 Workspace and permission

旧 parallel conflict 只比较声明路径的精确交集；scope 依赖 worker 自报且仅告警。registry 的 permissions 字段不能证明实际 enforcement，provider bypass 参数更不能当成授权。

当前 Workspace/Policy/Approval/Command 的 bounded 已接受语义是对照基准。并行性能需求若未被公平评测证明，不能因为已有 Promise.all 就假设必须进入产品。

### 5.5 Memory, context and evidence provenance

旧 source path 可指向后来被覆盖的内容。distiller 使用短 hash 与截断内容构造 ID，Replan supersedes 字符串也不证明真实对象 lineage；lesson upsert 和 recent_sources 不能代替不可变历史与来源有效性。

Legacy context 的预算统计不是最终完整交付快照预算；attribution 是模型声明，不是实际因果证明。当前 ADR-0008/0009 已覆盖 current-use/authority/pins/budget/delivery，优先避免重复建立一套低保证上下文与 Memory 控制。

### 5.6 Historical PASS is not migration proof

25/142 等数量是当时报告或输出的事实记录，不能证明 future Super Agent 架构收益。Release 已记录 fallback DAG、Replan 不过 Precheck、blocked 无 owner 等 debt；它们没有在“zero known blockers”措辞下消失。

旧 tests 主要验证导出函数、模块合作和 scripted writer；没有公平 single-agent 对照，没有真实跨 CLI 控制闭环的完整自动证明。测试叫 integration 不代表已经覆盖生产调用链。

## 6. Future ecosystem position

本节是责任位置地图，不是候选模块分解或最终 topology。

| 位置 | 可接受的资产关系 | 不允许继承 |
|---|---|---|
| Existing control authority | 已接受 Project/Goal/Task/Acceptance/Decision/Memory/Policy/Approval/Effect/Workspace/Capsule 边界；相关 legacy 问题用于检验覆盖 | 第二 state store、模型自行改验收、旧 decision 自动晋升、消息授予权限 |
| Conditional execution capability | planning suggestions、dependency ordering、strategy selection、specialist consultation、parallel scheduling、局部适应 | 固定 Planner/Reviewer 层、固定团队、所有任务先走 DAG、多 Agent 默认 |
| Provider ecosystem | Adapter contract 下的具体 provider 适配；兼容性知识与失败案例 | provider 绑定产品身份、静默 fallback、本机路径或 bypass 成为正常权威路径 |
| Non-authoritative assistance | summaries、reports、lessons candidates、keyword relevance、statistics、消息 | 报告覆盖 Reality、统计变成认证、Memory relevance 变成 validity |
| Historical evidence archive | 旧源码/fixtures/release/失败记录，保留时间与 provenance；不复写失败历史 | 因保留资料就重新激活 V0.5 或自动迁移状态 |

确定需要的是明确权威、可恢复控制连续性和可核验结果。其余资产均可能被更简单策略替代；问题仍存在也不等于需要一个同名模块。

## 7. Migration priority and decision prerequisites

### MP0 — 先排除污染，非执行删除

优先审查 A01/A02/A13/A16/A17/A18/A22/A25：不能继承 global Manager truth、文件 state authority、自动 fallback、unsafe retry/requeue、模型改验收后继承完成、自动 Memory decision promotion。保留历史材料供负例使用。

### MP1 — 先证明是否已有覆盖

对 identity、admission、Workspace、runtime seam、Result、evidence/history、Capsule 等先做 boundary 对照。已有实现解决问题时，迁移结果可以是**不迁任何 legacy code**。不能因“REBUILD”另外造 transaction、replay、recovery、memory promotion 或 receipt 系统。

### MP2 — 仅在 demonstrated need 后选择执行候选

Planner、consultation、routing、DAG、parallel、provider 接入需要具体失败场景与公平 simpler baseline。比较必须包括正确性、恢复、集成缺陷、成本、延迟、人工介入，不能只证明更复杂策略成功一次。没有结果时不晋升默认。

### MP3 — 辅助候选保持可选

summary、candidate lessons、statistics、message transport、关键词检索和 CLI 展示都没有当前必须迁移的依据。没有使用需求可以不进入最终系统。

### 任何后续具体迁移须另行证明

1. 具体问题与现有控制覆盖缺口，而非“旧代码已经有”。
2. 被选择的是概念、负例、utility 还是实现；不能互相替代证明。
3. 不改变现有 authority/pins/Permission/Acceptance/UNKNOWN 语义。
4. 生产调用链证据，而非只检查手工装配 fixture。
5. 真实 source/version/历史归属，不能拿路径和模型声明补写过去。
6. 若引入新的计划生命周期、delegation 权限、持久步骤或恢复含义，属于待决定边界；本地图不替它作决定。
7. 具有独立 Human 迁移/实现授权；本地图本身不是授权。

**当前结论：没有任何 legacy 组件因此获得“必须进入最终系统”或“可直接移植”的资格。**

## 8. Differences from the first-pass Legacy Asset Audit

| First-pass disposition | 本次修正 |
|---|---|
| KEEP implementation/concept 共用一个标签 | 严格只保留概念价值；代码迁移需单独审查 |
| DAG / Replan 必须 Attempt-local | 保留无 project-state 权威边界；不提前冻结所有未来 execution plan 的 lifespan |
| conflict-free batches | 改称声明冲突感知；源码未证明真实 conflict-free writes |
| bounded retry KEEP PRINCIPLE | 加入“有界不足以安全”；旧重发行为不迁移 |
| Artifact identity KEEP CONCEPT | 保留问题；补充 checker 内容完整性与真实 Replan wiring proof gaps |
| polling/finalization 全部 EVIDENCE ONLY | 旧实现仍不继承；保留中间态/最终态/发布区分的独立问题价值，以 REBUILD 分类 |
| file-wait KEEP UTILITY | 不整体保留；BOM 等小问题可再选，宽松解析/size stability/copy 原子性不能授予安全保证 |
| distiller 项目 Memory promotion RETIRE | 保持 RETIRE；单独将非权威 lesson candidate 问题 DEMOTE，不丢失所有失败学习价值 |
| Agent memory 稳定统计 | DEMOTE，明确统计口径受 phase/status 和样本偏差影响，不能证明质量 |
| raw history / provenance | 保留概念；明确旧文件会覆盖、部分证据未落盘，不是新权威证据链 |

本审计不改写原审计、Constitution、Roadmap 或历史报告。也不解决尚未决定的执行计划/策略/持久化边界，不开始任何实现。

[constitution]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/SUPER_AGENT_CONSTITUTION.md
[legacy-audit]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/docs/super-agent/LEGACY_V05_ASSET_AUDIT.md
[evaluation]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/docs/super-agent/EVALUATION_BASELINE.md
[sa-reality]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/SUPER_AGENT_REALITY.md
[sa-roadmap]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/SUPER_AGENT_ROADMAP.md
[blueprint]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/PROJECT_BLUEPRINT.md
[canonical]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/docs/architecture/PROJECT_CONTROL_OS_ARCHITECTURE.md
[pc-reality]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/PROJECT_ARCHITECTURE.md
[roadmap]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/ROADMAP.md
[orchestrator]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/orchestrator.mjs
[executors]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/executors.mjs
[planner]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/planner-lifecycle.mjs
[file-wait]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/file-wait.mjs
[distiller]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/distiller.mjs
[retriever]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/retriever.mjs
[context]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/context.mjs
[summary]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/state-summary.mjs
[registry]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/.ai/agents/registry.json
[demo]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/examples/legacy/team.js-demo-2026-08-26.js
[readiness]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/V0.5-OPEN-SOURCE-READINESS.md
[publish-report]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/V0.5-GITHUB-PUBLISH-REPORT.md
[release]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/docs/releases/v0.5.0.md
