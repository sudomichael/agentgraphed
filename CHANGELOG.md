# Changelog

All notable changes to this project will be documented here.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
