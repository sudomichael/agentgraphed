<div align="center">

# AgentGraphed

**Local-first analytics dashboard for AI coding sessions.**

See what you built with Claude Code and Codex CLI — across every project, every session, every dollar.

[![npm version](https://img.shields.io/npm/v/agentgraphed?color=00f5ff)](https://www.npmjs.com/package/agentgraphed)
[![license](https://img.shields.io/badge/license-MIT-success)](./LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-success)](https://nodejs.org)

</div>

<!-- TODO: hero screenshot -->
<!-- ![AgentGraphed dashboard](./docs/screenshots/dashboard.png) -->

---

## Why

You've been pair-coding with AI for months. Where did all those sessions go? Which projects ate your week? How much have you spent? AgentGraphed reads your local Claude Code and Codex CLI logs and turns them into a real dashboard — timelines, project breakdowns, model usage, cost estimates, and one-click resume.

No login. No cloud. Nothing leaves your machine.

## Install

```bash
npx agentgraphed
```

That's it. The dashboard opens at `http://localhost:3737`. Re-run any time to refresh.

> Requires Node 20+. First launch scans `~/.claude/projects/` and `~/.codex/sessions/` — sessions appear immediately, no configuration.

## Features

- **Dashboard** — 30-day usage chart, KPIs, top projects, work categories at a glance
- **Timeline** — every session grouped by day, searchable, filterable by project or provider
- **Projects** — auto-detected from git repo roots; see which projects pull the most AI time
- **Sessions** — read past conversations in a clean chat-bubble view
- **Resume** — one click copies `cd <cwd> && claude --resume <id>` to your clipboard
- **Copy context** *(optional, BYO LLM key)* — generates a primer for a fresh chat
- **Multi-label classification** *(optional, BYO LLM key)* — auto-categorizes sessions as Feature / Debugging / Planning / Refactor / Styling / DevOps / Data / Payments / Docs / Content
- **Cost estimates** — uses LiteLLM's auto-updating pricing data (2700+ models covered)
- **Range picker** — 7d / 30d / 90d / all-time on every chart

## Privacy

- Everything lives in `~/.agentgraphed/agentgraphed.sqlite` on your machine.
- Nothing is uploaded unless **you** click "Copy context" or "Classify sessions," and even then only to *your* LLM provider with *your* API key.
- API keys are stored in plaintext in the SQLite file — same threat model as `~/.aws/credentials` or a `.env`. Don't commit your home folder to git.

## Supported sources

- **Claude Code** — reads `~/.claude/projects/*/*.jsonl`
- **Codex CLI** — reads `~/.codex/sessions/YYYY/MM/DD/*.jsonl`

More adapters coming. If you want a specific one, [open an issue](https://github.com/sudomichael/agentgraphed/issues/new).

## Optional: LLM session titles & categories

Without an API key, sessions show the first line of the first prompt as the title. With a key:

- **Anthropic** — Haiku 4.5 (default) gives clean past-tense titles like "Fixed Stripe checkout double-decimal bug"
- **OpenAI** — GPT-5 mini works equally well, often cheaper

Click *Settings → LLM provider*, paste your key, then *Classify uncategorized*. Cost is fractions of a cent per session — typically $0.01–0.03 for a few hundred sessions.

## Optional: capture sessions from a team

If you run an agency or team and want sessions from every dev to land in one dashboard, install the SessionEnd hook on each laptop:

```bash
npx agentgraphed onboard https://your-host.example.com <ingest-token>
```

This patches `~/.claude/settings.json` to upload each completed session to your hosted instance. No background daemon, no friction.

To remove:

```bash
npx agentgraphed offboard
```

## Configuration

Environment variables:

| Variable                  | Default                                   | What it does                                   |
| ------------------------- | ----------------------------------------- | ---------------------------------------------- |
| `AGENTGRAPHED_PORT`       | `3737`                                    | Starting port (auto-increments if in use)      |
| `AGENTGRAPHED_DATA_DIR`   | `~/.agentgraphed`                         | Where to store SQLite + uploads                |
| `AGENTGRAPHED_CLAUDE_DIR` | `~/.claude/projects`                      | Override Claude Code log location              |
| `AGENTGRAPHED_CODEX_DIR`  | `~/.codex/sessions`                       | Override Codex log location                    |

Log directories can also be edited at `Settings → Data sources` without restarting.

## Development

```bash
git clone https://github.com/sudomichael/agentgraphed.git
cd agentgraphed
npm install
npm run dev
```

Open `http://localhost:3737`. Hot reload, source under `src/`.

To produce a publishable build:

```bash
npm run build         # builds Next.js standalone bundle
npm pack              # creates agentgraphed-X.Y.Z.tgz
```

## License

MIT © [Michael Patrick](https://github.com/sudomichael)
