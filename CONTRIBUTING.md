# Contributing

Thanks for considering a contribution to AgentGraphed.

## Setup

```bash
git clone https://github.com/sudomichael/agentgraphed.git
cd agentgraphed
npm install
npm run dev
```

Then open `http://localhost:3737`. The app auto-detects your local Claude Code and Codex CLI sessions.

## Project layout

- `src/app/` — Next.js routes (App Router)
- `src/components/` — React components
- `src/lib/` — Core logic (db, ingest, llm, pricing, formatting, query helpers)
- `bin/` — `agentgraphed` CLI entrypoints (`onboard`, `offboard`, default `start`)
- `scripts/` — Build-time helpers (LiteLLM pricing fetch, standalone-asset copy)

## Common tasks

| Command                  | What it does                                   |
| ------------------------ | ---------------------------------------------- |
| `npm run dev`            | Hot-reload dev server on port 3737             |
| `npm run build`          | Production build + standalone bundle           |
| `npm run start`          | Run the standalone bundle locally              |
| `npm run lint`           | ESLint via Next                                |
| `npm run fetch-pricing`  | Refresh LiteLLM pricing data manually          |
| `npm pack`               | Produce a publishable tarball                  |

## Filing issues

Bugs and feature requests both welcome. For bugs please include:

- AgentGraphed version (`npx agentgraphed --help` shows it)
- Node version (`node --version`)
- Operating system
- The minimum steps that reproduce the issue
- What you expected vs. what happened

For feature requests, describe the problem you're trying to solve before suggesting a specific implementation — there are often simpler answers.

## Pull requests

- Keep PRs small and focused. One feature or one fix per PR.
- Add a CHANGELOG entry under "Unreleased".
- New ingestion adapters (other coding agents) should follow the pattern in `src/lib/ingest/codex.ts` — one file per provider, same DB schema, provider tag stored on each session.
- UI changes should match the existing dark-mode visual language (see `tailwind.config.ts` for tokens).

## Code style

We don't enforce a particular style beyond `npm run lint`. The codebase favors explicit over clever — readable code beats minimal code.
