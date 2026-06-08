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

const DEBOUNCE_MS = 10_000;
let inFlight: Promise<void> | null = null;

export function triggerBackgroundIngest(): void {
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
    } catch {
      // Best-effort; never block the user on a transient failure.
    } finally {
      inFlight = null;
    }
  })();
  // Intentionally NOT awaited.
}

// For pages that want to know how stale the data might be (e.g. for a small
// "updated 3s ago" hint).
export function lastIngestedAt(): number {
  const raw = getSetting('dashboard_last_auto_ingest_ms');
  return raw ? parseInt(raw, 10) : 0;
}
