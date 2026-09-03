# DSH Multi-Agent Runtime —— 项目工作区指引（V0.5）

> 本目录是 Multi-Agent Runtime 的**代码仓库**（V0.5 架构已冻结）。开发/使用请先读 [README.md](README.md) 与 [docs/](docs/)。
> 面向 Agent 的约定：核心概念 **Agent ≠ Model**；**Memory 是派生层**，原始历史（.ai/runs|reviews|evaluations|messages|results）是 Source of Truth。

## 仓库地图

| 文件 | 职责 |
|---|---|
| `orchestrator.mjs` | Manager：规划/专家咨询/Precheck/调度/并行/Review/Evaluator/Replan/Run |
| `executors.mjs` | Executor 适配（claude-code / dsh-headless / codex） |
| `distiller.mjs` | 原始历史 → 派生 Memory（decisions/knowledge/lessons/agents） |
| `retriever.mjs` | BM25-like 检索（只读） |
| `context.mjs` | Context 组装（Token Budget + Priority，只读） |
| `state-summary.mjs` | .ai/state.summary.md 生成 |
| `tests/` | node:test（unit + integration，无需外部 runtime） |
| `docs/` | architecture / memory / installation / configuration / usage / testing / limitations |
| `.ai/agents/registry.json` | Agent 团队模板（唯一入库的 .ai 文件） |

## 开发纪律

1. **架构冻结**：Manager/Planner/Agent/Model/Executor/DAG/Review/Evaluator/Replan/Memory 之间的核心关系不变。发现问题 → 记录 Architecture Debt，不趁机重构。
2. **Agent ≠ Model**：Agent 是团队成员（registry），Model 是绑定配置（人工）。不做自动 Model Routing。
3. **Memory = 派生层**：蒸馏/检索/Context 只读原始层；可删可重建。
4. **测试**：改核心逻辑必须过 `npm test`（node:test）；外部 runtime E2E 单独标注。
5. **命令**：`npm test` / `node orchestrator.mjs "<goal>" --workdir <dir>` / `node distiller.mjs --workdir <dir>` / `node state-summary.mjs --workdir <dir>`。
6. **配置**：Agent/Model 都在 `.ai/agents/registry.json`；DSH 路径用 `DSH_ORCH_DSH_ENTRY` 环境变量覆盖。
