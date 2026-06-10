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
import { getSetting, setSetting } from '../queries';
import { clearMemo } from '../cache';
import { classifyBatch, getUnclassifiedRows } from '../llm/classify';
import { getLlmConfig } from '../llm/client';

const DEBOUNCE_MS = 10_000;
const TICK_MS = 5 * 60_000;
const AUTO_CLASSIFY_THRESHOLD = 5;
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

// For pages that want to know how stale the data might be (e.g. for a small
// "updated 3s ago" hint).
export function lastIngestedAt(): number {
  const raw = getSetting('dashboard_last_auto_ingest_ms');
  return raw ? parseInt(raw, 10) : 0;
}
