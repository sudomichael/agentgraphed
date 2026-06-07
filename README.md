<div align="center">

# AgentGraphed

**The Claude Code usage monitor.** Local-first analytics dashboard for Claude Code & Codex CLI sessions.

See every session, every project, every dollar — across your whole machine. No login. No cloud. Nothing leaves your computer.

[![npm version](https://img.shields.io/npm/v/agentgraphed?color=00f5ff)](https://www.npmjs.com/package/agentgraphed)
[![license](https://img.shields.io/badge/license-MIT-success)](./LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-success)](https://nodejs.org)

</div>

---

## Install & run — one command

```bash
npx agentgraphed
```

That's the whole install. No clone, no signup, no config file. The dashboard opens at <http://localhost:3737> the moment it's ready. Re-run any time to scan for new sessions.

**Prefer a global install?**

```bash
npm install -g agentgraphed
agentgraphed
```

**Don't have npx / Node?** Install Node 20+ from <https://nodejs.org> (the LTS version is fine). Check yours with `node --version`.

### What to expect on first run

1. `npx agentgraphed` downloads the package once (~15 MB, takes 30-60s on a typical connection). Subsequent runs start in seconds — npm caches the package.
2. You'll see one `npm warn exec` line and a couple of `npm warn deprecated` warnings from transitive dependencies. These are harmless; they'll go away in a future release.
3. The dashboard server boots. You'll see:
   ```
   › Starting AgentGraphed on http://localhost:3737
   › Scanning local AI coding sessions…
     Found 142 Claude + 8 Codex sessions (14821 messages indexed in 1943ms)
   › Ready. Press Ctrl+C to stop.
   ```
4. Your browser opens to the dashboard automatically.
5. To stop the server, hit `Ctrl+C` in that terminal. Your indexed data stays at `~/.agentgraphed/agentgraphed.sqlite` for next time.

![AgentGraphed dashboard](./docs/screenshots/dashboard.png)

---

## What it does

AgentGraphed reads your local Claude Code (`~/.claude/projects/`) and Codex CLI (`~/.codex/sessions/`) JSONL logs and turns them into a real dashboard. There's no agent to install on each session, no API key required to get started — it just reads files your CLI tools were already writing.

After `npx agentgraphed`, here's how to use it:

- **Browse your work** — Timeline groups every session by day. Multi-day sessions show `STARTED · SPANS Nd` / `CONTINUED` / `CLOSED` badges so nothing hides on a single bucket. Click any session to read the full conversation in a chat-bubble view.
- **Resume a session** — On any session page, click *Resume session* to copy `cd <cwd> && claude --resume <id>` to your clipboard. Paste it in your terminal to pick up where you left off.
- **Find a specific project** — Projects ranks every git repo you've worked in by activity, tokens, and cost. Click one to see only that repo's sessions.
- **Refresh after more coding** — Re-run `npx agentgraphed`. It re-scans your CLI logs incrementally; already-ingested sessions are skipped.
- **Get clean titles and categories** *(optional, BYO key)* — Open *Settings → LLM provider*, paste an Anthropic or OpenAI key, then click *Classify uncategorized*. Past-tense titles like "Fixed Stripe checkout bug" replace the raw first prompt. Cost is typically $0.01-0.03 for a few hundred sessions.
- **Live quota probe** *(optional, opt-in)* — On the dashboard, click *Probe now* (or toggle *Poll every 60s*) for live 5h & 7d rate-limit utilization read straight from Anthropic. Each probe costs a single token (~$0.00006).

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

## Screenshots

<table>
  <tr>
    <td width="50%">
      <a href="./docs/screenshots/timeline.png"><img src="./docs/screenshots/timeline.png" alt="Timeline — every session grouped by day, with started/continued/closed badges for multi-day sessions" /></a>
      <p align="center"><sub><b>Timeline</b> — every session, grouped by day. Multi-day sessions get <code>STARTED · SPANS Nd</code> / <code>CONTINUED</code> / <code>CLOSED</code> badges so nothing hides on one bucket.</sub></p>
    </td>
    <td width="50%">
      <a href="./docs/screenshots/session-detail.png"><img src="./docs/screenshots/session-detail.png" alt="Session detail — chat-bubble view of a past conversation with resume and copy-context actions" /></a>
      <p align="center"><sub><b>Session detail</b> — read past conversations in a clean chat-bubble view. One click to resume in Claude Code or copy a primer for a fresh chat.</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <a href="./docs/screenshots/projects.png"><img src="./docs/screenshots/projects.png" alt="Projects — every repo auto-detected with session count, tokens, and cost" /></a>
      <p align="center"><sub><b>Projects</b> — every git repo you've worked in, ranked by activity. See which projects are eating your week.</sub></p>
    </td>
    <td width="50%">
      <a href="./docs/screenshots/analytics.png"><img src="./docs/screenshots/analytics.png" alt="Analytics — sessions per day, provider split, model breakdown" /></a>
      <p align="center"><sub><b>Analytics</b> — sessions per day, provider split, model breakdown with cost per model.</sub></p>
    </td>
  </tr>
</table>

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

## Configuration

Environment variables:

| Variable                  | Default                                   | What it does                                   |
| ------------------------- | ----------------------------------------- | ---------------------------------------------- |
| `AGENTGRAPHED_PORT`       | `3737`                                    | Starting port (auto-increments if in use)      |
| `AGENTGRAPHED_DATA_DIR`   | `~/.agentgraphed`                         | Where to store the SQLite DB                   |
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
