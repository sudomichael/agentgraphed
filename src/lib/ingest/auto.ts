// Fire-and-forget background ingest, debounced.
//
// The dashboard wants to reflect what's on disk, but waiting for a 200-700ms
// scan on every page render makes navigation feel sluggish. Instead we kick
// the scan off in the background — page rendering proceeds with whatever's
// in the DB, and the freshly-scanned data is ready on the next render.
//
// Debounced via the settings table so multiple pages calling this within the
// same window only trigger one scan. In-process mutex so concurrent renders
// don't race to start two scans either.
//
// COST NOTE: this is all local file IO. No API calls, no tokens, no money.

import { runIngest } from './run';
import { getSetting, setSetting, getSessionsForLeaderboard } from '../queries';
import { clearMemo } from '../cache';
import { classifyBatch, getUnclassifiedRows } from '../llm/classify';
import { getLlmConfig } from '../llm/client';

const DEBOUNCE_MS = 10_000;
const TICK_MS = 5 * 60_000;
const AUTO_CLASSIFY_THRESHOLD = 5;
// Leaderboard: send at most every 6 hours, but a fresh ingest with new
// session activity bypasses the cooldown so the leaderboard stays lively.
const LEADERBOARD_SUBMIT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const LEADERBOARD_ENDPOINT = 'https://agentgraphed.com/api/leaderboard/submit';
const LEADERBOARD_TIMEOUT_MS = 8_000;
const LEADERBOARD_SCHEMA_VERSION = 2;
// Look back this far when picking sessions to include in a submission.
// Sessions whose data updated within the window get re-sent (cheap; the
// server UPSERTs on session_uuid).
const LEADERBOARD_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
let inFlight: Promise<void> | null = null;

// Boot a single global setInterval that keeps re-triggering the ingest even
// when no dashboard tab is open. Idempotent via a globalThis-keyed Symbol so
// per-render calls + dev hot-reloads don't pile up duplicate timers. We hang
// the bootstrap off the first per-render trigger (rather than Next's
// instrumentation hook) because instrumentation pulled the better-sqlite3
// import chain into the edge bundle and the workarounds for that were nasty.
const SCHEDULER_KEY = Symbol.for('agentgraphed.periodic-ingest');
type SchedulerGlobal = typeof globalThis & { [SCHEDULER_KEY]?: NodeJS.Timeout };
function ensurePeriodicScheduler(): void {
  const g = globalThis as SchedulerGlobal;
  if (g[SCHEDULER_KEY]) return;
  g[SCHEDULER_KEY] = setInterval(() => {
    triggerBackgroundIngest();
  }, TICK_MS);
  // Don't keep the event loop alive solely for this timer.
  if (typeof g[SCHEDULER_KEY]?.unref === 'function') g[SCHEDULER_KEY]!.unref();
}

export function triggerBackgroundIngest(): void {
  // First call boots the global 5-minute timer so we keep scanning even when
  // no tab is open. Idempotent — subsequent calls are a single cheap check.
  ensurePeriodicScheduler();

  // If a scan is already running, don't start another.
  if (inFlight) return;

  // Cheap setting read; bail if we scanned recently.
  const lastRaw = getSetting('dashboard_last_auto_ingest_ms');
  const lastMs = lastRaw ? parseInt(lastRaw, 10) : 0;
  if (Date.now() - lastMs < DEBOUNCE_MS) return;

  // Mark the timestamp *before* we await so a flood of concurrent renders
  // converges on a single scan rather than each starting one.
  setSetting('dashboard_last_auto_ingest_ms', String(Date.now()));

  inFlight = (async () => {
    try {
      const result = await runIngest();
      // If anything actually changed on disk, drop the read cache so the next
      // page render shows the new data. No-op when nothing new was ingested.
      if (result.claude.filesIngested > 0 || result.codex.filesIngested > 0) {
        clearMemo();
      }
      await maybeAutoClassify();
      await maybeSubmitLeaderboard();
    } catch {
      // Best-effort; never block the user on a transient failure.
    } finally {
      inFlight = null;
    }
  })();
  // Intentionally NOT awaited.
}

// If the user opted into auto-classify AND has a provider key set AND there
// are enough unclassified rows to make a batch worthwhile, run the classifier.
// Silent no-op on any failure — never crashes the user's page.
async function maybeAutoClassify(): Promise<void> {
  try {
    // Default-on: only 'off' opts out. Anything else (unset, 'on') enables.
    if (getSetting('auto_classify') === 'off') return;
    if (!getLlmConfig()) return;
    const rows = getUnclassifiedRows();
    if (rows.length < AUTO_CLASSIFY_THRESHOLD) return;
    const result = await classifyBatch({ rows });
    if (result.classified > 0) clearMemo();
  } catch {
    // Auto-classify is best-effort; failures here are silent and the user
    // can still trigger classification manually from Settings.
  }
}

// If the user opted into the leaderboard, post a batch of session-level
// rows to the public endpoint. Cadence: at most every 6 hours, OR sooner
// if the just-finished ingest produced new session activity since the
// last submit. Best-effort: short network timeout, errors swallowed,
// failure leaves the last-submitted timestamp untouched so we retry on
// the next ingest tick. The server UPSERTs on (handle, session_uuid)
// so re-sending the same session within the lookback window is cheap
// and the latest values win.
async function maybeSubmitLeaderboard(): Promise<void> {
  try {
    if (getSetting('leaderboard_opt_in') !== 'on') return;
    const handle = getSetting('leaderboard_handle');
    if (!handle) return;

    const lastRaw = getSetting('leaderboard_last_submitted_ms');
    const lastMs = lastRaw ? parseInt(lastRaw, 10) : 0;

    // Build the batch: every session that ended within the lookback window.
    // The server UPSERTs by session_uuid, so previously-sent sessions just
    // get their totals refreshed (cheap, idempotent).
    const since = Math.max(0, Date.now() - LEADERBOARD_LOOKBACK_MS);
    const sessions = getSessionsForLeaderboard(since);
    if (sessions.length === 0) return;

    // Cadence gate: skip if cooldown not elapsed AND no session has ended
    // since the last submit. (i.e., only push early if there's new data.)
    const cooldownActive = Date.now() - lastMs < LEADERBOARD_SUBMIT_INTERVAL_MS;
    if (cooldownActive) {
      const hasNewActivity = sessions.some(
        (s) => s.started_at + s.duration_ms > lastMs,
      );
      if (!hasNewActivity) return;
    }

    // Self-asserted social links — newline-delimited URLs in the local
    // setting, sent up as a string[] so the server can re-validate and
    // upsert the profile row alongside the session batch. An explicit
    // empty array tells the server "user cleared their links."
    const socialLinks = (getSetting('leaderboard_social_links') ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const payload = {
      handle,
      schema_version: LEADERBOARD_SCHEMA_VERSION,
      social_links: socialLinks,
      sessions: sessions.map((s) => ({
        session_uuid: s.session_uuid,
        started_at: new Date(s.started_at).toISOString(),
        duration_ms: s.duration_ms,
        provider: s.provider,
        model: s.model,
        input_tokens: s.input_tokens,
        output_tokens: s.output_tokens,
        cache_read_tokens: s.cache_read_tokens,
        cache_write_tokens: s.cache_write_tokens,
        est_cost_usd: Math.round(s.est_cost_usd * 10000) / 10000,
        message_count: s.message_count,
      })),
    };

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), LEADERBOARD_TIMEOUT_MS);
    try {
      const resp = await fetch(LEADERBOARD_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (resp.ok) setSetting('leaderboard_last_submitted_ms', String(Date.now()));
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Best-effort; never block the user.
  }
}

// For pages that want to know how stale the data might be (e.g. for a small
// "updated 3s ago" hint).
export function lastIngestedAt(): number {
  const raw = getSetting('dashboard_last_auto_ingest_ms');
  return raw ? parseInt(raw, 10) : 0;
}
