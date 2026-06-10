'use server';

import { revalidatePath } from 'next/cache';
import { setSetting, getRangeSummary, getModelBreakdown } from '@/lib/queries';

const SUBMIT_ENDPOINT = 'https://agentgraphed.com/api/leaderboard/submit';
const SUBMIT_TIMEOUT_MS = 5_000;

type Result =
  | { ok: true; submitted: boolean; serverStatus?: number }
  | { ok: false; error: string };

export async function setLeaderboardOptInAction(opts: {
  optIn: boolean;
  handle: string;
}): Promise<Result> {
  try {
    setSetting('leaderboard_opt_in', opts.optIn ? 'on' : 'off');
    if (opts.optIn) {
      setSetting('leaderboard_handle', opts.handle);
      // Best-effort immediate submission so the user sees their entry land
      // (or sees an error early). Server-side de-dupes by (handle, week_iso)
      // so re-runs in the same week just refresh the values.
      const submitted = await submitNow(opts.handle).catch(() => null);
      if (submitted && submitted.ok) {
        setSetting('leaderboard_last_submitted_ms', String(Date.now()));
      }
      revalidatePath('/leaderboard');
      return { ok: true, submitted: !!submitted?.ok, serverStatus: submitted?.status };
    }
    // Opting out — we deliberately KEEP the handle so users can opt back in
    // without retyping. We DO NOT keep an "active subscription" flag; the
    // server side reads the opt_in setting on each render.
    revalidatePath('/leaderboard');
    return { ok: true, submitted: false };
  } catch (e) {
    return { ok: false, error: (e as Error).message || 'Unknown error' };
  }
}

async function submitNow(handle: string): Promise<{ ok: boolean; status: number } | null> {
  const week = getRangeSummary(7);
  const modelMix = getModelBreakdown(7).reduce<Record<string, number>>((acc, row) => {
    acc[row.model] = (acc[row.model] || 0) + row.tokens;
    return acc;
  }, {});
  const payload = {
    handle,
    week_iso: weekIsoString(),
    tokens: week.tokens,
    sessions: week.sessions,
    projects: week.projects,
    est_cost_usd: Math.round(week.cost * 100) / 100,
    active_days: week.active_months,
    model_mix: Object.fromEntries(
      Object.entries(modelMix).slice(0, 5).map(([m, t]) => [m, t]),
    ),
    schema_version: 1,
  };
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), SUBMIT_TIMEOUT_MS);
  try {
    const resp = await fetch(SUBMIT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    // We intentionally don't await resp.text() — the endpoint acks with
    // a 200 and we don't need the body. Failure (non-2xx, timeout, network
    // error) leaves the last_submitted_ms timestamp untouched so the
    // periodic submitter in auto.ts retries on the next ingest tick.
    return { ok: resp.ok, status: resp.status };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function weekIsoString(): string {
  const d = new Date();
  const tmp = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  tmp.setDate(tmp.getDate() + 4 - (tmp.getDay() || 7));
  const yearStart = new Date(tmp.getFullYear(), 0, 1);
  const week = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${tmp.getFullYear()}-W${String(week).padStart(2, '0')}`;
}
