# Changelog

All notable changes to this project will be documented here.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0] — 2026-06-08

### Added
- **Project filter on the dashboard.** New dropdown next to the title (`?project=<id>`) refilters every dashboard widget — Range Summary, Usage chart, Today's Activity, Top Projects, Work Type, Daily Summary, share image. "All projects" by default.
- **Model filter on the dashboard.** Second dropdown next to the project filter (`?model=<family>`) filters by **model family** (rolled up: `claude-opus-4-7` + `claude-opus-4-6` → "Claude Opus 4"). Threads through the same widgets as the project filter.
- **By Model breakdown card** on the dashboard (under Daily Summary), on project detail pages, and on session detail pages when a session bounces between models. Sessions × tokens × cost per family, ranked by cost.
- **Resume panel on session detail.** Replaces the cryptic "Resume → ✓ Copied" button with a visible command preview (`cd "<cwd>" && claude --resume <id>`) in a mono code chip with a Copy button on the right. GitHub-clone-URL pattern — what gets copied is the thing you're looking at.
- **Auto-classify new sessions** (default on, opt-out in Settings). Background ingest now batches unclassified sessions through the LLM classifier when ≥5 are pending, so titles and categories appear without a manual trigger.
- **"N unclassified · classify" chip** on the dashboard header — shown only when auto-classify is off and there's a backlog. Two-step confirm with the dollar estimate so the click never feels surprising.

### Changed
- **Share image is now a graph.** Dropped the "Top projects" + "Mostly" text rows. The share PNG now renders the dashboard's actual usage chart as an SVG area chart, respecting the current range, metric (tokens/sessions/cost), scale (lin/log), and project filter. The headline metric card matching the active metric gets the accent color.
- **Usage chart toggles are URL-driven.** Metric (`?metric=`) and scale (`?scale=`) now live in the URL, so dashboard links carry the view and the share image always matches what you're looking at.
- **Share button is icon-only.** Dropped "Share stats" copy in favor of the system share glyph (matches iOS/macOS/GitHub/Linear convention). Cyan-tinted button with a hover glow and a brief checkmark on success.
- **Session detail header redesigned.** Title is now the AI-derived session title (not the raw cwd path); buttons sit in a single row; helper text moves below as a tooltip-style line. "Generate context" relabeled to **"Summarize for new chat"** → **"Copy summary"**.
- **Freshness pill is rock-steady.** Fixed-width slot + zero-padded tick text (`04s` / `15s` / `03m`) — no horizontal shift on hover, no oscillation. Refresh icon + label on hover make it an obvious button.
- **Project filter sits with the title**, not the action bar. Treated as "what you're viewing," coupled with Dashboard + date.
- **Heuristic session titles are cleaner.** Strips `<command-name>` tags, leading slash commands, URLs, absolute paths, code-fence noise; trims to a sentence boundary. Unclassified rows in the timeline no longer leak command markers or path strings.
- **Codex quota reset label.** No longer says "resetting" for the per-minute window that's constantly rolling — shows `<1m` instead.

### Fixed
- Project filter, model filter, range, freshness, and share button now share one tight cluster with subtle dividers — no more floating-island layout in the dashboard header.

## [0.2.2] — 2026-06-07

### Changed
- **Live quota moved to the sidebar.** Replaces the (briefly shipped) dashboard quota cards with a hover-to-probe widget in the sidebar. Idle UI is a tiny `○ Live quota` line; on hover, a popover slides out showing both providers' rate-limit windows with bars and reset countdowns. Results cache in-component for 60s so re-hover is instant. Zero probes fire on page load — only when you actually look. Dot color reflects the binding %.
- Page navigation got significantly faster: background fire-and-forget ingest (no longer awaited), plus a 5-second TTL memo on the heavy aggregate queries (`getDailySeries`, `getProjectBreakdown`, `getCategoryBreakdown`, `getRangeSummary`, `getOverview`, `getProviderBreakdown`, `getModelBreakdown`, `getProjects`). Warm-cache nav now consistently sub-100ms; rapid clicking lands at ~57ms.
- Dashboard header now shows "updated Xs ago · refresh" — a small freshness indicator that doubles as an explicit force-rescan button if you want the latest right now.

## [0.2.1] — 2026-06-07

### Fixed
- Live quota now reads Claude credentials from the macOS Keychain entry (`Claude Code-credentials`) where recent Claude Code versions store them. Falls back to the legacy `~/.claude/.credentials.json` file when present. Keychain-sourced tokens are read-only — refresh is delegated to Claude Code itself with a clear next-step message.

### Added
- **Dashboard auto-ingest** — re-scans your CLI log directories on every dashboard render, debounced to once per 10s. Today's sessions appear without a manual rescan or re-running `npx agentgraphed`.
- **Codex tab on the live-quota strip** — uses your `OPENAI_API_KEY` (the same one used for optional title classification) to probe OpenAI for live rate-limit headers. Strip reports the per-minute token utilization and reset countdown.
- **Compact, collapsible quota strip** — replaces the old full-width card. Single horizontal row with provider tabs (`CLAUDE` / `CODEX`) on the left, two pills in the middle, and a hide (×) button on the right. Hidden state is restored from localStorage on next visit via a tiny "+ show live quota" link.

## [0.2.0] — 2026-06-07

### Added
- **Live Quota card on the dashboard** — opt-in probe against Anthropic that reports your real 5-hour and 7-day rate-limit utilization (read straight from `anthropic-ratelimit-unified-*` response headers). Off by default; click *Probe now* for a single check, or toggle *Poll every 60s* for continuous polling. Each probe is one token on Haiku 4.5 (~$0.00006).
- `agentgraphed --version` / `-v` flag.

### Changed
- README rewritten to be honest about the first run: expected download size, `npm warn deprecated` noise, Node 20+ requirement, global-install alternative.
- npm metadata: `description` now leads with the SEO target phrase; `homepage` points at agentgraphed.com instead of the GitHub README anchor; `keywords` sharpened toward the actual terms users search for.
- New `publish.yml` GitHub Actions workflow: pushing a `v*.*.*` tag triggers an automated build → install verification → `npm publish --provenance` → GitHub release. No more interactive 2FA dance.

## [0.1.1] — 2026-06-06

### Fixed
- Re-publish to attach README to the npm registry metadata (0.1.0 was published with an empty README field, causing npmjs.com to show "no README").

### Changed
- Timeline now shows multi-day sessions on every day they touched, tagged `STARTED · SPANS Nd` / `CONTINUED` / `CLOSED`. Day totals attribute tokens to the day a session closed to avoid double-counting.
- Trimmed ~13 MB of dead weight from the npm tarball (pruned TypeScript and Next's AMP validator from the standalone bundle).
- Removed the multi-machine `onboard`/`offboard` hook flow and the `/api/ingest` remote endpoint; AgentGraphed is single-user, local-only.

## [0.1.0] — 2026-06-06

Initial public release.

### Added
- Dashboard, Timeline, Projects, Sessions, Analytics, Settings pages
- Automatic ingest of Claude Code (`~/.claude/projects`) and Codex CLI (`~/.codex/sessions`) sessions
- Project resolution via git repo root with cwd-basename fallback
- LiteLLM-powered pricing for 2700+ models, refreshed at build time
- Optional LLM-powered multi-label session classification and titles (Anthropic or OpenAI, BYO key)
- Resume button — copies `cd <cwd> && claude --resume <id>`
- Copy-context button — generates a structured primer for a fresh chat
- 7d / 30d / 90d / all-time range picker on Dashboard + Analytics
- Auto-suggested log/linear chart scale when one day dwarfs the rest
- Dark "deep-tech" UI with sticky sidebar + header
