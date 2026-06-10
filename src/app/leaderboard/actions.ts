'use server';

import { revalidatePath } from 'next/cache';
import { setSetting, getSetting, getSessionsForLeaderboard } from '@/lib/queries';
import { cleanSocialLinks } from '@/lib/social';

const SUBMIT_ENDPOINT = 'https://agentgraphed.com/api/leaderboard/submit';
const SUBMIT_TIMEOUT_MS = 8_000;
const SCHEMA_VERSION = 2;
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

type Result =
  | { ok: true; submitted: boolean; serverStatus?: number; rowsWritten?: number }
  | { ok: false; error: string };

export async function setLeaderboardOptInAction(opts: {
  optIn: boolean;
  handle: string;
  // Raw user-entered URL strings (one per slot). Cleaned + normalized
  // here before storage so the local setting holds the canonical form
  // and the wire payload sees the same URLs the server will accept.
  socialLinks: string[];
}): Promise<Result> {
  try {
    setSetting('leaderboard_opt_in', opts.optIn ? 'on' : 'off');
    if (opts.optIn) {
      setSetting('leaderboard_handle', opts.handle);
      // Pre-clean locally so anything detectSocial rejects (malformed,
      // http, > maxUrlLength) never even hits the setting. The server
      // will also clean on its side as a defense in depth.
      const cleaned = cleanSocialLinks(opts.socialLinks);
      setSetting('leaderboard_social_links', cleaned.map((l) => l.url).join('\n'));

      // Best-effort immediate submission so the user sees their entry land
      // (or sees an error early). Server-side de-dupes by (handle, session_uuid)
      // so re-runs just refresh values.
      const submitted = await submitNow(opts.handle, cleaned.map((l) => l.url)).catch(() => null);
      if (submitted && submitted.ok) {
        setSetting('leaderboard_last_submitted_ms', String(Date.now()));
      }
      revalidatePath('/leaderboard');
      return {
        ok: true,
        submitted: !!submitted?.ok,
        serverStatus: submitted?.status,
        rowsWritten: submitted?.rowsWritten,
      };
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

async function submitNow(handle: string, socialLinks: string[]): Promise<{ ok: boolean; status: number; rowsWritten?: number } | null> {
  const since = Math.max(0, Date.now() - LOOKBACK_MS);
  const sessions = getSessionsForLeaderboard(since);
  // If the user has no recent sessions, we still want to mark them as
  // submitting — but there's nothing to send yet. Treat as "success, 0 rows".
  if (sessions.length === 0) return { ok: true, status: 204, rowsWritten: 0 };

  const payload = {
    handle,
    schema_version: SCHEMA_VERSION,
    // Include social_links so the profile row is upserted in the same
    // request as the session batch. The server treats an explicit empty
    // array as "clear my links", so we always send it.
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
  const timeout = setTimeout(() => ctrl.abort(), SUBMIT_TIMEOUT_MS);
  try {
    const resp = await fetch(SUBMIT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    let rowsWritten: number | undefined;
    try {
      const body = (await resp.json()) as { rows_written?: number };
      rowsWritten = body?.rows_written;
    } catch {
      // ignore — server might not have responded with JSON
    }
    return { ok: resp.ok, status: resp.status, rowsWritten };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Change the handle the user submits under. Doesn't touch the old handle's
// rows on the server — those just stop being updated. The user can run the
// `my-data DELETE` curl from the privacy section if they want them gone.
// We immediately submit under the new handle so the leaderboard reflects
// the rename without waiting for the 6h cadence.
export async function renameLeaderboardHandleAction(opts: {
  newHandle: string;
}): Promise<Result> {
  try {
    const trimmed = opts.newHandle.trim();
    if (!/^[a-z0-9][a-z0-9_-]{1,23}$/i.test(trimmed)) {
      return { ok: false, error: 'Handle must be 2–24 chars: letters, numbers, dash or underscore.' };
    }
    if (getSetting('leaderboard_opt_in') !== 'on') {
      return { ok: false, error: 'Not opted in — pick a handle from the Join button instead.' };
    }
    const old = getSetting('leaderboard_handle') ?? '';
    if (old === trimmed) {
      return { ok: true, submitted: false };
    }
    setSetting('leaderboard_handle', trimmed);

    // Re-submit under the new handle. Read current social_links straight
    // from the setting; we don't accept new ones here — that's what the
    // "Save links" button on the opt-in component is for.
    const socialLinks = (getSetting('leaderboard_social_links') ?? '')
      .split('\n').map((s) => s.trim()).filter(Boolean);
    const submitted = await submitNow(trimmed, socialLinks).catch(() => null);
    if (submitted && submitted.ok) {
      setSetting('leaderboard_last_submitted_ms', String(Date.now()));
    }
    revalidatePath('/leaderboard');
    return {
      ok: true,
      submitted: !!submitted?.ok,
      serverStatus: submitted?.status,
      rowsWritten: submitted?.rowsWritten,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message || 'Unknown error' };
  }
}
