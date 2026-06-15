<div align="center">

# AgentGraphed

**Local-first history, search, and analytics for Claude Code and Codex.**

Find old sessions, resume unfinished work, search past conversations, and see usage across every AI coding project on your machine.

No login. No cloud. Nothing leaves your computer.

🌐 **Site:** <https://agentgraphed.com> · 📦 **npm:** <https://www.npmjs.com/package/agentgraphed>

[![npm version](https://img.shields.io/npm/v/agentgraphed?color=00f5ff)](https://www.npmjs.com/package/agentgraphed)
[![license](https://img.shields.io/badge/license-MIT-success)](./LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-success)](https://nodejs.org)

</div>

![AgentGraphed dashboard](./docs/screenshots/dashboard.png)

---

## What it does

AgentGraphed automatically indexes every Claude Code and Codex session on your machine. With it you can:

- **Find old work** you forgot about — every session, searchable.
- **Resume abandoned sessions** with one click.
- **Browse project history** across every git repo you've touched.
- **Generate context for a new chat** from any past conversation.
- **Track usage and costs** across providers, models, and projects.

Everything stays local. AgentGraphed reads the JSONL logs your CLI tools were already writing (`~/.claude/projects/`, `~/.codex/sessions/`) and turns them into a real dashboard.

## Try it

```bash
npx agentgraphed
```

That's the whole install. No clone, no signup, no config file. The dashboard opens at <http://localhost:3737>. Re-run any time, or leave it running — it re-scans every 5 minutes.

**Prefer a global install?**

```bash
npm install -g agentgraphed
agentgraphed
```

**Don't have npx / Node?** Install Node 20+ from <https://nodejs.org> (the LTS version is fine).

### What to expect on first run

1. `npx agentgraphed` downloads the package once (~15 MB, takes 30-60s on a typical connection). Subsequent runs start in seconds — npm caches the package.
2. You'll see one `npm warn exec` line and a couple of `npm warn deprecated` warnings from transitive dependencies. Harmless.
3. The dashboard server boots:
   ```
   › Starting AgentGraphed on http://localhost:3737
   › Scanning local AI coding sessions…
     Found 142 Claude + 8 Codex sessions (14821 messages indexed in 1943ms)
   › Ready. Press Ctrl+C to stop.
   ```
4. Your browser opens to the dashboard automatically.
5. To stop the server, hit `Ctrl+C`. Your indexed data stays at `~/.agentgraphed/agentgraphed.sqlite` for next time — even after Claude Code rotates the original log files off disk.

## Screenshots

<table>
  <tr>
    <td width="50%">
      <a href="./docs/screenshots/timeline.png"><img src="./docs/screenshots/timeline.png" alt="Timeline — find old work" /></a>
      <p align="center"><sub><b>Find old work</b> — every session, grouped by day. Search and filter by project, provider, or model.</sub></p>
    </td>
    <td width="50%">
      <a href="./docs/screenshots/session-detail.png"><img src="./docs/screenshots/session-detail.png" alt="Session detail — resume unfinished sessions" /></a>
      <p align="center"><sub><b>Resume unfinished sessions</b> — read the full conversation, copy a one-line resume command, or generate a primer to paste into a fresh chat.</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <a href="./docs/screenshots/projects.png"><img src="./docs/screenshots/projects.png" alt="Projects — browse project history" /></a>
      <p align="center"><sub><b>Browse project history</b> — every git repo you've worked in, ranked by activity. Click any project to see only its sessions.</sub></p>
    </td>
    <td width="50%">
      <a href="./docs/screenshots/analytics.png"><img src="./docs/screenshots/analytics.png" alt="Analytics — see where your AI time and money go" /></a>
      <p align="center"><sub><b>See where your AI time goes</b> — usage by day, model, project, and category, with retail-priced cost estimates from LiteLLM's 2700+ model catalog.</sub></p>
    </td>
  </tr>
</table>

## Features

- **Timeline** — every session grouped by day, with `STARTED · SPANS Nd` / `CONTINUED` / `CLOSED` badges so multi-day work doesn't hide on a single bucket.
- **Sessions** — read past conversations in a chat-bubble view; search by content, project, provider, or model.
- **Resume** — one click copies `cd <cwd> && claude --resume <id>` to your clipboard.
- **Generate context** *(optional, BYO LLM key)* — produces a primer to paste into a fresh chat so you don't lose context when resuming.
- **Projects** — auto-detected from git repo roots; per-project usage, model spend, and session history.
- **Dashboard** — usage chart, KPIs, top projects, work-type breakdown, per-model cost. Filter the whole dashboard by project or model family.
- **Auto-classification** *(optional, BYO LLM key, on by default)* — categorizes sessions as Feature / Debugging / Planning / Refactor / Styling / DevOps / Data / Payments / Docs / Content and writes a clean past-tense title for each. Typically a few cents for hundreds of sessions.
- **Live quota probe** *(optional)* — hover the sidebar widget to read your live Anthropic 5h/7d and OpenAI per-minute rate-limit utilization. Single-token probes (~$0.00006 each).
- **Share** — generate a stat-card PNG of your dashboard, project, or session view and copy it straight to your clipboard.
- **Background ingest** — re-scans local logs every 5 minutes; new sessions appear without you doing anything.
- **Cost estimates** — LiteLLM's auto-updating retail pricing for 2700+ models. Treat as directional.
- **Range picker** — 7d / 30d / 90d / all-time on every chart, with auto-suggested log scale when the data is long-tailed.

## Privacy

AgentGraphed is **local-first by default**. Everything lives in `~/.agentgraphed/agentgraphed.sqlite` on your machine.

There are exactly three things that can ever leave your computer, and every one of them is opt-in:

1. **LLM session classification + "Summarize for new chat"** — only fires when you click the button or enable auto-classify. Sends a sampled set of your own prompts to *your* configured LLM provider with *your* API key. Nothing reaches AgentGraphed servers.

2. **The opt-in leaderboard.** Off by default. When you turn it on, every six hours (or sooner if you finished a new session since the last submit) your local app posts a batch of *session-level* rows to `https://agentgraphed.com/api/leaderboard/submit`. Each row contains: the handle you picked, a random per-session UUID, start time, duration, provider, model, tokens by kind (input/output/cache_read/cache_write), est. cost, and message count. **No prompts, no project names, no session content, no file paths, no git branches, no API keys.** Full breakdown of what is and isn't sent: <https://agentgraphed.com/privacy>.

3. **API keys** are stored in plaintext in your local SQLite file — same threat model as `~/.aws/credentials` or a `.env`. Don't commit your home folder to git.

**To verify any of this, read the source.** The leaderboard submitter is one function (`maybeSubmitLeaderboard`) in [`src/lib/ingest/auto.ts`](./src/lib/ingest/auto.ts). The wire format is one schema — what's not in the schema isn't sent.

**To audit or delete your leaderboard data:**

```bash
# See everything we have for your handle
curl "https://agentgraphed.com/api/leaderboard/my-data?handle=YOUR_HANDLE"

# Delete it all
curl -X DELETE "https://agentgraphed.com/api/leaderboard/my-data?handle=YOUR_HANDLE"
```

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
| `AGENTGRAPHED_NO_OPEN`    | _(unset)_                                 | Set to `1` to never open a browser (`--no-open`) |

Log directories can also be edited at `Settings → Data sources` without restarting.

## Run as a service

To keep AgentGraphed running in the background so the dashboard is always at
`http://localhost:3737`, run it with `--no-open` (or `AGENTGRAPHED_NO_OPEN=1`)
under your OS service manager. The flag skips the browser launch, which would
otherwise pop a window on every (re)start.

### macOS (launchd)

Save as `~/Library/LaunchAgents/com.agentgraphed.plist` (replace `YOU` with your
username), then `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.agentgraphed.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.agentgraphed</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/env</string>
        <string>npx</string>
        <string>agentgraphed</string>
        <string>--no-open</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>/Users/YOU</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>/Users/YOU/Library/Logs/agentgraphed.log</string>
    <key>StandardErrorPath</key><string>/Users/YOU/Library/Logs/agentgraphed.log</string>
</dict>
</plist>
```

### Linux (systemd user service)

Save as `~/.config/systemd/user/agentgraphed.service`, then
`systemctl --user enable --now agentgraphed` (and `loginctl enable-linger $USER`
to keep it running after logout):

```ini
[Unit]
Description=AgentGraphed
After=network-online.target

[Service]
ExecStart=/usr/bin/env npx agentgraphed --no-open
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

> **Node version note:** the bundled `better-sqlite3` ships prebuilt binaries
> for current LTS releases. If `npx agentgraphed` fails to install on a very new
> Node with a `node-gyp`/compile error, install and run under the latest LTS
> (e.g. Node 22).

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

---

Built and maintained by [@ushercakes](https://x.com/ushercakes).
