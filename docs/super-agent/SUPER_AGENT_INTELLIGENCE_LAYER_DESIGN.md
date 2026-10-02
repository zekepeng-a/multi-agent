# Super Agent Intelligence Layer — Boundary Design

**Status:** PROPOSED / BOUNDARY DESIGN ONLY — NOT ACCEPTED, NOT IMPLEMENTED  
**Date:** 2026-10-02  
**Repository:** `zekepeng-a/multi-agent`  
**Reviewed governance branch / HEAD:** `super-agent/constitution-v0.1` / `36eda87644c589a11dddb9aa775eb8831ec642af`  
**Project Control OS baseline:** G8 bounded milestone COMPLETE / `79f03e1c0fc680b6876428e3dd26c6f616817cf7`  
**Authorization:** 本次仅授权设计与边界分析；不授权实现、迁移、阶段推进或修改既有 authority。

本文的“Intelligence Layer”是问题解决策略的语义责任名称，不是新增顶层架构层、必建模块、独立 Controller 或 Execution Engine。以下规则是供 Human 审查的候选设计；不能反向宣称当前仓库已经具备这些能力。

### Source basis and status

在设计基线时按要求重读 [Constitution R2][constitution]、[Legacy Migration Map][migration]、[canonical architecture][canonical]、[ROADMAP][roadmap]，并核对 [Blueprint][blueprint] 与 [Evaluation Baseline][evaluation]。GitHub branch ref 已重新核对；与 G8 baseline 的 compare 仅有九份新增 Super Agent 文档，既有 Project Control 文档/源码/测试未变，故使用内容等价的本地 G8 checkout 检查其边界。

设计基线状态区别：Constitution 仍为 **PROPOSED R2 / NOT YET ACCEPTED**；Migration Map 是独立审计候选，不是接受后的迁移决定；Evaluation Baseline 尚无 benchmark results。本文复用其防污染方向作为提案依据，既有 Project Control 冻结约束仍然有效。本次未开展外部框架调研、性能实验或新运行证明。

**Repository recording note — 2026-10-02:** 原始候选设计完整纳入治理目录，基线引用保留为历史审计 pins，Migration Map 改为仓库内链接。当前 Constitution/Evaluation R3 参见 [Convergence Record](SA0_CONVERGENCE_RECORD.md)；本文仍为 PROPOSED / BOUNDARY DESIGN ONLY。策略谱包含 deterministic/direct tool、single strong agent、specialist consultation、DAG/dependency planning、parallel execution、iterative refinement 与 multi-agent：可组合候选，不是等级，不增加执行/Memory 权威。

## 1. Purpose

Intelligence Layer 回答：**在既定项目目标、验收契约、权限、预算和当前事实之内，哪种问题解决方式最合适，为什么？**

Project Control OS 回答：**当前权威状态是什么，哪个动作获准执行，执行与效果发生了什么，什么证据可以支持验收，如何保留不确定性和恢复历史？**

前者组织推理和提出方法，后者保留控制权。Intelligence 不取代 Goal / Task / Acceptance、Policy / Approval、Runtime boundary、Evidence / Verification、Effect uncertainty 或 durable control history，也不复制这些系统。

候选交互关系：

```text
既有权威对象 + 当前事实 + 可用能力 + 预算
                    ↓
        Intelligence：评估、建议、计划
                    ↓
        既有可信 Control Plane 准入与授权
                    ↓
       Runtime Adapter 执行被授予的工作
                    ↓
        Reality / 候选结果 / Evidence
                    ↓
     既有 Verification / Acceptance / recovery
                    ↓
       下一轮策略建议读取新的当前事实
```

这是责任关系，不指定新 API、store collection、Agent 数量、Team、通信拓扑或实现调用链。不存在“Intelligence 已选策略，所以可以执行”的捷径。

成功标准是同一控制契约下的可复现结果改善：正确性、目标保持、恢复能力、证据覆盖、成本、延迟和人工纠偏负担。策略层级更深、参与者更多或模型更自信都不是成功证据。

当前 G8 完成仅证明 bounded Project Control milestone。它不证明通用智能规划、自动 Replan、任意 provider 的 in-flight recovery、live DSH 执行或大型长期项目已经解决；本文不补写这些能力为 IMPLEMENTED。

## 2. Authority Boundary

### 2.1 可以做什么

| 能力 | 候选边界 |
|---|---|
| 提建议 | 解释当前事实、提出方案/风险/澄清请求；保存来源与推理区别。 |
| 生成计划 | 提供步骤、依赖假设、预期产物、候选验证方法；草案步骤不是已创建的 authoritative Task。 |
| 选择策略 | 在约束允许的候选内推荐最简单的充分策略，说明替代方案、依据与不确定性。 |
| 调整执行方式 | 已授予工作内的实现细节可由执行方选择；改变 provider、能力、scope、预算或受控动作时，必须回到现有可信授权边界检查。 |
| 建议重新规划 | 对新事实、验证失败、预算变化提出修订计划，保留原计划与历史；不能自行重写控制对象。 |
| 请求人工确认 | 明确指出需要 Human 的方向/契约判断或既有 Approval；说明缺什么，不能让 Human approval 代替事实证明。 |

上述能力不授予直接写 Project State 的权限。即使建议生成新 Task、改变契约或晋升知识，也只是提案，由原有有权边界决定是否以及如何处理；本设计不新建该处理协议。

### 2.2 禁止的 authority transfer

| 不可做 | 对应既有边界 |
|---|---|
| 修改 Goal、项目方向或 Acceptance Contract | Human intent / 既有受控变更；计划不能降低验收条件来“成功”。 |
| 自我授权、继承或扩展 Approval | Capability ≠ Permission；批准绑定 action、target、version、scope、capability，Policy DENY 不可被策略或 Approval 覆盖。 |
| 接受 Task / Goal / Project 或改变其权威状态 | Runtime 输出与推理 verdict 只是候选；既有 Control Plane / Acceptance Controller 保持状态权威。 |
| 晋升 Memory、写入新 Decision 或升级来源权威 | 可提出候选；ADR-0008 晋升/验证/来源规则与现有 Decision authority 不变。 |
| 绕过 Verification | Specialist/Reviewer 的同意不等于 PASS；PASS 也不能跳过现有 Acceptance checks。 |
| 把外部效果、receipt 或报告当验收证明 | Effect ≠ Evidence；Adapter receipt 只证明输入边界接收，不证明正确、完成或最终模型 token。 |
| 覆写历史、原地替换正式 Capsule | 单 Attempt 不可变快照、hash、manifest、delivery history、CAS/replay 保持原语义。 |
| 对 UNKNOWN 自动重试、换 provider 或重建过去事实 | 先由既有 recovery/reconciliation 确认可行性；无可靠观察不能推导“没有发生”。 |

### 2.3 输入与输出的审计边界

建议读取已有 Project / Goal / Task identity、contract pin、ACTIVE Decisions、Workspace/Reality observations、Policy/Approval restrictions、runtime capabilities 和预算。项目归属、版本、来源和观察时间应能归属到建议依据；缺失或无法确认须显式标记，不以聊天回忆补齐。

Memory 仅通过 ADR-0008 current-use 语义消费：project-scoped、ACTIVE、所有必要来源 CURRENT、先 eligibility 后 relevance；INFERRED 默认排除，只有可信 assembler 显式 opt-in 后才可进入执行 Capsule。本文不允许策略推理绕过 assembler 设置、不消费 history/debug Memory 作为当前执行知识、不新增 Agent Memory authority。

策略建议应说明：适用任务及所依据版本、事实指标、推理假设、候选策略、选择理由、被拒绝替代方案、所需能力/授权、预算估计、候选验证与停止条件。此清单是审计内容要求，不是新 domain record 或持久化 schema。

正式 Runtime 输入仍由可信 Capsule boundary 生成：必要约束不得裁剪；dispatch 前 freshness、selection completeness、Policy/Approval、capability 和所有选入来源按 ADR-0009 检查。策略文本不能充当 Capsule，也不能直接修改 trusted assembler profile。

Current Reality 对事实判断优先，但不授予 Permission、不改变 normative constraints、不重写 Accepted State 历史。来源冲突时保留冲突并交给现有控制边界处理，不能用“现实优先”取消 Human 方向。

### 2.4 什么时候需要 Human

- 目标或验收契约存在无法由当前权威文件消除的歧义，或方案要求改变方向/范围。
- 当前 Policy / Approval 规则要求具名授权，且尚未存在匹配、当前有效的授权。
- 建议超出授予的能力、写入范围或预算，涉及新的 D/E 边界。
- 不可兼容的产品取舍无法由已有 Decision/约束决定，需要 Human 作方向判断。

不因为“复杂度高”或“一次模型失败”自动请求人工接管。可在已授权范围内收集事实、运行已有验证；infra failure 与效应不确定性走各自现有控制路径。Human 可以决定暂停或改变方向，不能凭批准把 UNKNOWN 变为无效果、把缺失证据变为已验证。

## 3. Strategy Selection Model

### 3.1 可组合策略，而非升级阶梯

Single / Multi 描述参与方式；Specialist consultation 描述补充分析；DAG 描述依赖顺序；Parallel 描述调度；Iterative refinement 描述反馈循环。它们不互斥，也不是复杂任务必须逐层升级的等级。

一个 Agent 可以按 DAG 顺序工作；多个执行参与者可以完全串行；咨询 Specialist 可以不产生任何写入；迭代可以由同一执行方完成。这里的参与者是临时能力选择，不新增 Agent 层级、永久角色或 Team domain。已有确定性工具足够的任务无需强行模型化。

| 候选策略 | 何时值得考虑 | 必须具备的前提 | 不应使用 / 简单替代 | 需要证明的增益 |
|---|---|---|---|---|
| Single Agent | 目标与范围明确，已有能力足以完成；也是默认比较基线 | 有效输入、能力与权限匹配、可验证产物 | 无法满足必要能力或输入完整性时不能仅凭“默认”继续；先澄清/补事实 | 在同一契约下的充分性、成本、恢复与结果质量 |
| Multi Agent | 可分别验证/集成的工作确有不同能力需要，或公平对照证明协作有益 | 可说明的分工、输入边界、结果归属、受控集成；每项实际动作合法 | 仅因任务长、文件多、一次失败或“共识更可靠”不可选择；单 Agent + 咨询是替代 | 扣除协调、重复工作与集成缺陷后的净收益 |
| Specialist consultation | 有具体知识缺口、需要独立批判/分析；不必委派写入 | 有界问题与来源；意见保持候选身份 | 不能自报 expert/Reviewer 获得权威；无需专业输入时省略 | 分析是否减少真实缺陷或纠偏成本，不以一致率证明事实 |
| DAG execution | 产物存在真实前置依赖，顺序影响正确性或就绪性 | 依赖来源可说明，区分已验证边与推断边；循环/未解析依赖不能宣称 ready | 普通列表足够时不用图；Project hierarchy 不自动变执行 DAG | 顺序错误、无效启动和重工是否减少 |
| Parallel execution | 独立子问题存在，延迟收益可能超过协调成本 | 数据/效果依赖已核；实际 scope 与 isolation/integration 能力充分；每个动作按原规则获准 | 共享可变状态、外部效果冲突、集成规则不明时串行；文件路径声明不等于隔离 | 墙钟改善、总成本、冲突与验证失败率 |
| Iterative refinement | 已有可验证反馈表明需要修正，在原目标/契约内继续有意义 | 失败类型明确、有限预算/停止条件、每轮实际输入与结果可追溯 | 同一失败无新事实、目标被反复改小、UNKNOWN 被当普通失败时停止 | 对比一次执行的质量改善与额外成本，不把迭代次数当进展 |

### 3.2 候选选择协议

1. **先确认边界。** 获取当前项目归属、目标/contract pin、约束、授权条件、能力与预算；必要输入无法确认时不形成“可执行”结论。
2. **再判断可行性。** 排除需要未实现能力或越过权限/恢复边界的策略；推理说“安全”不能代替隔离、Policy 或来源有效性检查。
3. **建立最简单基线。** 能用确定性工具则不增加推理；需要模型时优先强 single-agent 候选。
4. **按具体失败模式加入能力。** 知识缺口→咨询；前置依赖→规划；独立工作且具备隔离→考虑并行；反馈显示方案有误→提出 Replan。不存在“高复杂→Multi Agent”规则。
5. **解释选择与不确定性。** 区分当前观测、已有评测证据、任务相关假设与预计收益。缺少收益证据时保持可选实验提案，不能成为默认。
6. **交给原有控制边界。** 计划准入与实际执行分离；需要新权限、新受控工作或新的架构协议时，不由策略选择直接补齐。
7. **依据真实结果复核。** Verification 失败、来源漂移、预算消耗或能力变化可触发新建议；不自动覆盖已经 dispatch 的输入/历史。

选择结果是条件性的：所依据版本、能力或来源变化后，不能继续套用旧建议作为执行许可。新方案需要新鲜输入；已有 Capsule 的 reservation / UNKNOWN 约束不因“重新选择”而取消。

### 3.3 Replan 与迭代的区别

迭代是同一目标/契约内依据反馈改进产物；Replan 是修改候选步骤、顺序、分解或方式。两者均不表示修改 Goal、Acceptance 或恢复权限。

候选触发条件：已验证的依赖假设失败、明确的验证失败、必要能力不可用、当前事实使原步骤不可行、预算不足以完成原方案。模型感觉“困难”只能触发调查建议，不能作为自动重派依据。

Execution / infra / plan / policy / evidence / reality-conflict / external-effect uncertainty 分开处理。Policy DENY 不可改路由规避；证据不足不等于产物错误；UNKNOWN 不等于失败；不能依据相同 task ID 继承改义后步骤的旧完成状态。

当前候选保守选择：**Replan 先作为有来源依据的提案；不授权自主创建/替换 Task、自动取消在途工作或自动重新 dispatch。** 可在既有授予范围内修正实现细节；更广的自动执行协议属于第 7 节待决定边界。

### 3.4 从可选策略到默认策略

采用 Evaluation Baseline R2 的候选纪律，不宣称它已被接受或已有结果。比较同一 Goal / Task / Acceptance / Workspace / Policy，采用强 simpler baseline；隔离 orchestration 效应时尽可能保持 model/provider 一致，provider 替换另行报告。

预先声明任务族、预算模式、质量/成本/延迟指标、版本与停止规则；记录失败、跳过、人工干预、所有策略的调优投入、重复试验与方差；holdout 不用于调参。不用自有 benchmark 答案污染 Memory/context，不用模型 judge 或共识作为唯一证明。

权威/权限/约束违规是不可用条件，不能用低成本或高平均分抵消。性能结论只适用于已测任务族和版本。benchmark 支持架构选择，不替代具体项目的 Evidence / Verification / Acceptance。

## 4. Complexity Assessment

### 4.1 输出证据画像，不生成“智能评分”

复杂度画像描述已知工作形态与不确定性，不生成总分、模型 IQ 分、Agent ranking 或“超过阈值自动多 Agent”规则。所有观察均需 scope、来源、版本/时间；尚未检查的范围记为未知，不记零。

| 指标 | 可核事实 | 必须分开的推理/限制 |
|---|---|---|
| 文件数量与范围 | 某 repo revision、目录范围内已枚举/实际涉及文件；记录枚举方式 | 预计修改文件数是估计；少数关键文件可比大量机械修改更复杂，计数不证明风险或工作量 |
| Dependency 数量/结构 | 有来源的 build/import/产物依赖、已确认前置条件及其方向 | import graph 不等于执行 DAG；模型生成的边是待验证假设；未知边不等于无依赖 |
| 风险等级 | 当前有效 Policy、Human Decision、既有 scope/capability 分类及版本 | “当前被标为高风险”是治理事实，不是客观风险已完全测量；策略推断不能降低分类或免批准 |
| 时间跨度 | 已发生的 elapsed time、历史任务时长、已记录期限/中断 | 预计耗时/跨 session 次数是估计；历史平均不保证本次完成或可恢复 |
| 能力与边界 | 当前 adapter capability、读写/外部效果范围、实际可用工具 | 声明可调用不证明任务质量；provider native parallel 不证明控制侧隔离 |
| 验证与不确定性 | 当前契约、可运行验证、已失败检查、未解析来源 | 覆盖率或 test PASS 不证明所有未知正确；预计困难程度必须附假设和可推翻条件 |

风险、规模、知识不确定性、依赖耦合、时间连续性分别记录。高风险操作可能很简单，但仍需批准；低风险任务可能困难，但不自动要求 Human。无需把这些维度压成一个总分。

### 4.2 简单 / 中等 / 高复杂的候选判定

以下是可复核的描述性标签，不是新的 domain status、Permission 或强制路由。每次标注都要列出满足条件的具体事实、未覆盖范围与推理理由；不同画像不能仅凭标签互相比较。

| 画像 | 判定依据 | 策略含义 |
|---|---|---|
| SIMPLE / 简单 | 目标与范围明确；已检查范围内无需独立前置产物协调；已有能力与验证能覆盖所需工作；无未处理效应不确定性 | direct tool 或 single-agent 是起点；风险审批仍单独执行 |
| MODERATE / 中等 | 可指出若干必要子问题/前置产物或具体知识缺口；接口和验证方式已知；不必跨多个未验证控制边界 | 可先 single-agent + 显式步骤或咨询；不默认多参与者 |
| HIGH / 高复杂 | 有来源支持的跨边界依赖、显著集成耦合、长时间连续性需要，或多种验证/能力需求必须共同满足 | 需要更明确计划与检查点；DAG/并行/委派仍各自证明必要性与可行性 |
| UNDETERMINED / 未确定 | 必要范围、依赖、输入有效性或能力尚未确认，无法作上述判断 | 提出已授权的有界只读调查或澄清；不能填零后归类为简单，不能直接升级为多 Agent |

HIGH 不表示“单 Agent 不足”，SIMPLE 不表示“可以跳过控制”。例如：两份涉及 schema 与回放语义的文件可有较强耦合；大量独立机械检查可由确定性工具完成；延续很久的研究可能需要耐久控制记录，但不需要同时多个执行者。

预计困难程度、预期成本、潜在并行收益和 plan confidence 均属于推理。记录为何这样估计、哪些观察可证伪，以及缺失信息；自报 confidence 不晋升为 VERIFIED / ACCEPTED。

### 4.3 可验证与可调整

画像与建议通过实际观测复核：选了并行却产生集成冲突、重复工作或无延迟改善，应保留失败证据；单 Agent 已充分解决，不追加复杂度。后续校准可根据公平评测更新候选选择规则，但不自动产生新的 accepted Decision 或 routing 权限。

本文不冻结通用文件数/依赖数/分钟数阈值；跨项目硬阈值缺乏当前证据。未来若采用阈值，需任务族、测量范围、版本、holdout 结果和误判说明。画像、选择规则与自动执行准入不是同一件事。

## 5. Legacy Asset Mapping

“保留”仅为 KEEP CONCEPT；“重构”是未来必要时重新设计，不继承旧代码；“可选策略”没有控制权；“淘汰”是从未来权威链排除，不在本任务删除历史文件。

| Legacy 资产 / Map ID | 分类与未来位置 | 仍有价值的问题 | 既有覆盖与不可继承部分 |
|---|---|---|---|
| Planner / A03、A08 | **重构 + 可选策略**：产生分解与计划建议 | 复杂问题如何形成可验证步骤 | PC 有 Goal/Task/Contract、准入与输入边界，没有证明智能规划；不继承固定两阶段、Planner 写 project truth 或初次检查后 Replan 绕过检查 |
| DAG / A07 | **保留概念 + 可选策略**：表达真实前置依赖 | 避免错误就绪顺序与无效启动 | Project hierarchy/aggregation 不是 DAG scheduler；不强制所有工作图化、不继承旧 dependency 状态为权威 |
| Reviewer / A04、A23 | **可选辅助 / DEMOTE**：咨询、批判与候选验证分析 | 发现盲点与检查证据 | 既有 Verification/Acceptance 已有权威边界；不新增永久 Reviewer 身份、不自报角色获得验证权限、不用 verdict 直接完成 Task |
| Registry / A05、A06 | **重构能力描述概念；淘汰静态分数与角色授权** | 区分 Agent 与 Model、选择可用 provider/capability | PC 已有 RuntimeRef 与 capability contract；质量路由尚无证据；不创建永久 Agent registry/marketplace，不把工具声明等同 Permission |
| Parallel / A09、A10 | **保留概念 + 可选策略** | 对真正独立工作降低延迟 | 优先现有 Workspace 隔离/集成边界；不继承共享 ROOT + 路径声明即安全的假设，不新增 leases/fencing |
| Replan / A15–A18 | **重构 + 可选提案；淘汰不安全自动恢复** | 新事实/反馈使旧步骤不可行 | 复用既有 Run/Attempt/Effect recovery；不继承 stale-running 自动重排、ID 不变继承 completed、通用 retry 或改 contract 来通过 |

同时排除旧 Manager 总权威、`.ai/tasks/state` 双文件 truth、模型蒸馏直写 Decision/Memory、空验收/text auto-PASS、未知 backend 静默 fallback（Map A01/A02/A13/A22/A25）。这是防污染前提，不是新增迁移工程。

概念价值不决定最终采用。Planner/DAG/Parallel/Replan 等只有在具体任务失败或公平评测证明增益后，才值得进入独立设计/实现授权；本文件不为它们排列编码 roadmap。

## 6. DSH Position

DSH 可作为 Runtime / Agent Provider / Execution Backend，通过既有 Runtime Adapter 提供能力；它不是 Super Agent 本体、control authority 或产品成立的前提。

- strategy recommendation 使用能力需求，不以 DSH Workflow/Team/Session 身份替代 Project / Task / Run / Attempt。
- provider 自有规划、并行或会话机制可以是执行内部优化，受授予范围约束；不能因此产生新永久角色、Team authority 或跳过 Control Plane。
- Adapter capability 说明接口可支持什么，不授予权限，也不证明策略质量。缺失能力则拒绝该候选或提出合法替代，不静默切换未知 backend。
- Provider 替换须重新检查实际 action/capability/scope、输入与当前授权条件；DSH 的能力不能自动转授给 Codex/Claude，反向同样如此。
- Runtime 自有 session/context/live handles/credentials 与正式 Capsule 分离；输入 receipt 只证明 Adapter 边界接收，结果仍需现有 Evidence/Verification/Acceptance。
- G8 Slice 4 的 DSH 证明限于 injected engine 下的 public-contract substitution；不外推 live host、真实模型执行、文件隔离或结果 durability。
- 当前 LocalProcess / DSH Workflow 的 in-flight resume/reconcile 仍无完整支持；策略选择不能宣称切换 provider 可以恢复未知在途执行。

即使没有 DSH，只要某个替代 provider 满足此次执行所需边界与能力，候选 Super Agent 仍可成立。这个条件不宣称当前已经证明任意 provider substitution。

## 7. Open Questions

下面不重新开放已有 authority；区分“需要未来冻结的协议”和“尚无 demonstrated need 的生态候选”。它们不是待建模块清单，也不构成实现授权。

| 问题 | 当前候选选择 / 边界 | 什么证据才值得继续 |
|---|---|---|
| 是否需要长期 Agent Identity？ | 暂不引入；保留 Agent ≠ Model，沿用既有执行归属与 RuntimeRef。身份存在也不授予角色/权限。 | 现有 Project/Run/Attempt/provider 归属无法表达的具体连续性需求；若设计持久身份，先明确生命周期、归属与非授权含义 |
| 是否需要 Agent Memory？ | 暂不新增；provider-local cache/context 不得进入项目 truth。共享知识通过现有 ADR-0008 来源、验证与晋升边界。 | 当前 Capsule/current-use Memory 无法解决的具体上下文失败；先区分临时上下文与新 durable knowledge，不能另起晋升权威 |
| 是否需要自动 Replan？ | 当前仅有界建议与已授予实现细节调整；不自主变更控制对象或重发。 | 实际失败需要更广自动调整时，冻结 allowed changes、授权、失效、在途动作、并发与恢复协议；属于 D gate，不从本设计推导已解决 |
| Plan / dependency 是否应有独立 durable identity？ | 本文不引入 PlanId 或 store；候选步骤不是 Task authority，历史引用不证明完成。 | 跨 Attempt/重启需要证明实际采用哪份计划且现有绑定无法表达时，明确 immutable meaning、revision、lineage 与 replay；不是直接复活旧 `.ai` 文件协议 |
| Multi/DAG/parallel 的 readiness、局部失败与集成结果如何受控？ | 暂不定义 scheduler；执行 DAG 不改变项目 membership/Acceptance，结果必须通过既有验证。 | 真正获准执行这些策略前，需要冻结产物依赖语义、输入有效性、取消/部分失败、集成与安全恢复；复用 PC，拒绝第二套 execution authority |
| 是否需要 Multi-Agent Communication Protocol？ | 暂不建通用协议；咨询消息是候选内容，消息送达不等于执行、Evidence 或 Acceptance。 | 跨参与者通信成为具体闭环阻塞时，限定请求/响应身份、来源、交付事实、失效与预算；不能把自报 delivered 变为可信 receipt |
| 是否需要 Agent Marketplace？ | 无 demonstrated need，保持可选远期问题；不为已有 Registry 建生态系统。 | 能力供应确实跨组织/非本地配置且现有 provider 配置不够时，再审查来源、权限、供应链和评测问题 |
| 画像与 strategy profile 谁维护，何时可成为默认？ | 当前为版本化候选设计/评测问题；策略模型不能自改治理约束或声称已接受 profile。 | 有评测结果后再明确可信配置维护与默认变更的审查入口；规则不自行生成授权 |
| 长期项目需要哪种 provider recovery？ | 保留当前 DEFERRED FUTURE D；无 resume/reconcile 能力时不假装可以恢复。 | 一个真实 in-flight failure 需要 provider-specific observation/rebinding 时才独立授权研究；不新增 lease、锁或通用 recovery subsystem |

测量工具、候选画像字段呈现、样例选择和有限评测次数是工程/评测细节，不自动构成新架构 gap。真正的 D gap 是尚未冻结的身份、计划/依赖语义、自动执行/恢复边界；只有拟采用的能力触及它们时才需要进入对应 gate。

**Non-goals:** 新 Agent 层级、永久角色、Team 架构、Execution Engine、身份认证系统、独立 Memory/Execution authority、通用 provenance graph、自动知识晋升、vector/embedding、旧 V0.5 代码迁移、Roadmap domain、Observability 新体系、leases/fencing、修改 ADR 或冻结 invariants。

**Human review boundary:** 可审查本候选是否正确划分“建议—授权—执行—验证”。接受边界设计也不自动批准任何模块、策略流水线或新阶段；下一步如需实现，须先冻结所采用能力涉及的 D 协议，并获得单独的 bounded authorization。

[constitution]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/SUPER_AGENT_CONSTITUTION.md
[migration]: LEGACY_MIGRATION_MAP.md
[canonical]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/docs/architecture/PROJECT_CONTROL_OS_ARCHITECTURE.md
[roadmap]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/ROADMAP.md
[blueprint]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/PROJECT_BLUEPRINT.md
[evaluation]: https://github.com/zekepeng-a/multi-agent/blob/36eda87644c589a11dddb9aa775eb8831ec642af/docs/super-agent/EVALUATION_BASELINE.md
