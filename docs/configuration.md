# Configuration

All configuration is **data**, not code: agents and their model bindings live in the registry; knobs are environment variables. Models are manually bound — there is no automatic routing.

## Agent Registry (`.ai/agents/registry.json`)

The team roster. One entry per Agent:

```json
{
  "id": "architect",
  "role": "技术架构专家",
  "capabilities": { "architecture": 5, "coding": 5, "analysis": 4 },
  "backend": { "type": "codex", "enabled": true },
  "model": "deepseek/deepseek-v4-pro",
  "status": "ready"
}
```

- **`id`** — team-member name (an Agent, never a model name).
- **`capabilities.<skill>`** — 0–5 score used by capability matching (`pickWorker`). Tasks declare `required_capability`; the enabled agent with the highest score for that skill wins.
- **`backend.type`** — which runtime: `claude-code` | `codex` | `dsh-headless`. Must match a registered executor (`executors.mjs`).
- **`backend.enabled`** — `false` agents are never auto-dispatched (e.g. manual/GUI or session-only backends).
- **`model`** — the bound model string forwarded to the runtime (`--model`/`-m`). Empty means "use runtime default". Leave it empty if you rely on the CLI's own config.
- **`status`** — `"ready"` or other (non-ready agents are skipped).

### Model binding rules

- Agent ≠ Model: editing `model` never changes code or routing.
- Use **pure model IDs** (e.g. `deepseek/deepseek-v4-pro`, `claude-sonnet-4.5`) — the string is forwarded verbatim to the CLI. Do not put descriptive text there (a past bug bound a description and the CLI rejected it).
- Claude Code default: leave `model` empty to use your `~/.claude/settings.json` configuration.

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `DSH_ORCH_DSH_ENTRY` | Absolute path to `dsh/lib/bin.js` for the `dsh-headless` executor | author-machine path (must override on other machines) |
| `DSH_ORCH_MAX_PARALLEL` | Max concurrent tasks per batch | `3` |
| `DSH_ORCH_REVIEW` | (not yet wired) reserved | — |

## CLI flags

`orchestrator.mjs` accepts:

```
node orchestrator.mjs "<goal>" --workdir <project-dir> [--skip-plan]
```

- `--workdir` — where the workspace `.ai/` lives (default: current dir).
- `--skip-plan` — use the existing `.ai/tasks.json` instead of re-planning.

`distiller.mjs` / `state-summary.mjs` accept `--workdir <dir>` (and `--verbose` for the distiller).

## LLM brains & worker auth

- **Manager brain** during planning/review/replan is the LLM invoked through your backend CLI configuration (Claude Code settings, DSH `agent-default-model`, etc.).
- **Worker auth** belongs to each CLI (Claude subscription, Codex provider config, DSH model keys). None of these secrets live in this repo. The runtime never stores API keys.
