# Installation

The runtime is plain Node.js modules — there are **no runtime npm dependencies**. What you need is a working Node runtime plus at least one agent backend CLI on your machine.

## Requirements

| Component | Needed for | Notes |
|---|---|---|
| **Node.js ≥ 20** | orchestrator + all modules | developed/tested on Node 24 |
| **DSH** | `dsh-agent` tasks (analysis/research) + Manager brain in DSH mode | headless sessions via `dsh lib/bin.js --profile headless` |
| **Claude Code CLI** (`claude`) | default worker (`claude-code`) | must be on `PATH`; needs its own auth/account |
| **Codex CLI** (`codex`) | `codex` / `architect` agents | on `PATH`; provider auth required |
| A project workspace | where tasks run | create any directory; runtime writes `.ai/` there |

You do not need every backend — the registry decides which agents are `enabled`. Enable only the ones you can run.

## Steps

```bash
# 1. Clone & prepare (no deps to fetch today)
git clone <repo> && cd dsh-multi-agent-runtime
npm install        # harmless; package.json declares no runtime deps

# 2. Point the DSH headless executor at your DSH install (if not the default)
#    The executor honors an environment variable; the committed default is the
#    author's machine path and must be overridden on other machines:
#    Windows (PowerShell):
$env:DSH_ORCH_DSH_ENTRY = "C:\path\to\npm\node_modules\@deepseek-ai\dsh\lib\bin.js"
#    or Linux/macOS:
export DSH_ORCH_DSH_ENTRY="/path/to/dsh/lib/bin.js"

# 3. Verify backends are reachable
claude --version     # if you will use claude-code agent
codex --version      # if you will use codex/architect agents
dsh --version        # if you will use dsh-agent
```

## Project workspace

The runtime never modifies your source outside the workspace. Inside the workspace it creates `.ai/`:

```
.ai/agents/registry.json   # team template (committed). Copy to your project.
.ai/tasks.json             # task DAG + plan (runtime)
.ai/state.json             # phase/status (runtime)
.ai/runs/ .ai/reviews/ .ai/evaluations/ .ai/messages/ .ai/consultations/ .ai/results/
.ai/memory/{decisions,knowledge,lessons,agents}/
.ai/state.summary.md
```

A project that has not run yet needs a registry: `cp .ai/agents/registry.json <your-project>/.ai/agents/`.

> Note: some parts currently only run in the author's environment by default (the DSH entry path above). Everything else is machine-independent.
