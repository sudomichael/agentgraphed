# Changelog

All notable changes to this project will be documented here.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.6] — 2026-06-10

### Added
- **Share the cost-breakdown view.** New share-icon button in the analytics "Where your cost went" card generates a 1200×630 PNG via `/api/share/cost-breakdown` and copies it to your clipboard. AgentGraphed brand bar, headline cost, billing-mix bar with legend, two-column source breakdown matching the on-page layout, honest pro-rating footer. Same range param as the dashboard share so the PNG matches whatever window you're viewing.
- **Collapsible per-side source lists** on the analytics card. Top 5 rows visible by default per side ("What Claude read" / "What Claude said"), with a `▾ show N more` toggle that expands each column independently. Keeps the headline-relevant entries above the fold; deep tail is one click away.

## [0.3.5] — 2026-06-09

### Added
- **Token breakdown by source.** New schema (v4) captures per-content-item bytes from every Claude Code session: tool results (Bash output, Read contents, MCP responses, …), tool calls (Edit/Write/Bash/MCP arguments), Claude's text replies, and user prompts. Stored per-message with timestamps so it windows the same way the rest of the dashboard does.
- **"Breakdown" toggle on the usage chart.** Fourth metric option next to Tokens / Sessions / Est. Cost. Renders a stacked area (or bar) over time showing pro-rated cost per source — Read, Edit, Bash, MCP, your prompts, Claude's text, and an "other" rollup for the long tail. Per-bucket sum equals the headline cost exactly; honest pro-rating uses each session's input-side and output-side byte share to split actual billed cost across content items. Lin/log auto-disables in breakdown mode because log of a sum isn't the sum of logs.
- **"Where the tokens came from" card on session detail.** Per-session view of the same data — two stacked groupings ("What Claude read" / "What Claude said"), per-source rows with bars, est. tokens, raw bytes, and percent. MCP tools render as `MCP · <server> · <tool>` with the prefix stripped.
- **Full detail card on Analytics.** Cross-window view with input/output split, billing-mix subdivision (fresh input / cache creation / cache read / output), per-source rows with pro-rated cost, and an honest pro-rating footer.

### Fixed
- **Sub-2-day windows show hourly buckets.** 24h was rendering as a 2-bucket day-shaped chart; now shows ~25 hourly bars. The chart label formatter discriminates on bucket key length so the X-axis reads `HH:00` when hourly and `MM-DD` when daily.
- **Claude subagent files no longer overwrite tool_io.** Subagent files for the same session use `ON CONFLICT(message_id, idx) DO UPDATE` keyed on Claude's stable per-message UUID — same lesson as the messages-table fix in 0.3.0.
- **Codex "resetting" quota label** shows `<1m` for the rolling per-minute window.

### Changed
- **Codex sessions don't contribute to the token breakdown** — Codex's JSONL is event-streamed rather than per-turn content arrays, which needs a real second adapter. Tracked as a follow-up; Codex sessions still appear in every other view.

## [0.3.4] — 2026-06-09

### Added
- **24h range preset.** `24h | 7d | 30d | 90d | All`. Rolling last 24 hours from now. Range summary cards, prev-period delta, share-image subtitle, daily series all wire up automatically.
- **Hourly bucket granularity for sub-2-day windows.** The 24h chart now shows ~25 hourly bars/areas — the shape of your day — instead of a two-bucket day-shaped curve. X-axis reads `14:00`, `15:00`; tooltip says "Hour 14:00 — 32M tokens." Granularity follows window size: <2 days hourly, otherwise daily. No new setting; the right thing is the default.
- **Area / bar chart toggle** on the dashboard usage chart. New `?chart=` URL param next to `?metric=` and `?scale=` — same pattern, shareable, persists across reloads. Bar mode helps the eye separate adjacent quiet hours from surrounding peaks. Share PNG respects it too.

### Fixed
- **Daily series was silently dropping the leading edge** of fixed-range windows. A rolling N-day window crosses N midnights = N+1 calendar buckets, but the bucket loop was seeding only N. Messages near the leading edge landed in an unseeded bucket and never made it to the chart. Most visible on 24h (one whole bucket missing) but quietly affected 7d / 30d / 90d too. Now seeds `Math.ceil(window / bucketSize) + 1` buckets in both daily and hourly modes.

## [0.3.3] — 2026-06-09

### Changed
- **Every release is now boot-verified on macOS, Windows, and Linux before being declared good.** The CI publish workflow gained a `verify-platforms` matrix that pulls the freshly-published tarball from the npm registry and boots the dashboard on `macos-latest`, `windows-latest`, and `ubuntu-latest`. The 0.1.0–0.3.1 Apple Silicon dlopen bug would have died here — the previous in-job verification ran on the same Linux runner that built the bundle, so the platform mismatch never surfaced. No code changes; product behavior identical to 0.3.2.

## [0.3.2] — 2026-06-09

### Fixed
- **`npx agentgraphed` failed to start on macOS and Windows.** The CI runner is Linux, so `npm run build` left a Linux x64 `better-sqlite3` binary inside `.next/standalone/node_modules/better-sqlite3/`. On install, npm fetches the correct platform prebuild at the top level, but Node's standalone-bundle require resolution found the Linux binary first and dlopened it — failing with `slice is not valid mach-o file` on Apple Silicon (and the equivalent on Windows). Versions 0.1.0 through 0.3.1 were all affected. The post-build script now prunes `node_modules/better-sqlite3` from the standalone bundle so require falls through to the platform-correct copy installed alongside the package. Reproduced and verified on a clean install.

## [0.3.1] — 2026-06-09

### Fixed
- **Multi-day sessions now count tokens on the days they actually happened.** Previously a conversation opened Saturday and still active Tuesday attributed every token to Saturday, so the dashboard showed zero usage for Sunday/Monday/Tuesday even when 95% of the work happened then. The dashboard now sums tokens from per-message timestamps; the messages table gained per-message token + cost columns; the ingester writes them straight from each Claude `message.usage` block. Codex token attribution is best-effort — its log only reports running totals, not per-message — but lands tokens on the right calendar day in practice.
- **Sessions whose source JSONLs were rotated off disk by Claude Code keep their totals.** Added an idempotent backfill that reconciles message-level totals against the session row's totals on every boot. When messages.SUM lags sessions.row (because the source file is gone, or the migration only saw a subagent fragment), the gap is distributed evenly across the assistant messages we have, anchored on real timestamps. Orphaned sessions with no message rows at all get a synthetic placeholder so they still appear on the dashboard.
- **`?range=all` was silently rendering the last 30 days.** `rangeDays('all')` used `?? 30` as a missing-key fallback, but `??` doesn't distinguish "no match" from "match with value null" — so the All-time option collapsed to 30. Latent for the lifetime of the range picker; surfaced once historical message data started flowing through the new attribution path.
- **Claude subagent files no longer wipe their parent transcript's messages.** Claude Code emits one main JSONL plus one per-subagent under `<sessionId>/subagents/*.jsonl`, all sharing the same sessionId. The ingester's DELETE-then-INSERT-by-session meant whichever subagent finished last left only its own messages. Switched to upsert keyed on Claude's stable per-message UUID; subagent files now accumulate alongside the parent.
- **Codex "resetting" quota label.** OpenAI's per-minute rate-limit window resets continuously; by the time we render, the header has already elapsed. Now shows `<1m` for windows that just rolled.
- **Auto-log scale heuristic.** Switched the peak-vs-quiet ratio from peak/median (5× on a billion-token spike) to peak/p10 with a 50× threshold so long-tailed multi-month histories actually flip to log instead of squashing flat against the X-axis.

### Added
- **Server-side 5-minute scheduled ingest.** The dashboard's per-render trigger only fires when a tab is open; the scheduler keeps scanning your log directories whether or not anyone's looking. Bootstrapped from the first per-render `triggerBackgroundIngest()` call (globalThis-keyed for idempotency); `unref()`'d so it can't keep the process alive at shutdown. No instrumentation hook needed.
- **Schema versioning** with on-boot migrations + invalidated `ingest_state` so future ingest semantic changes ship cleanly.

### Changed
- **CI publish uses npm Trusted Publisher OIDC** instead of a long-lived `NPM_TOKEN`. The runner upgrades to `npm@latest` (≥11.5.1 is required for OIDC); `--provenance` still attaches a sigstore attestation tying the package to the workflow run.

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
