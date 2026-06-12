'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { setSetting, getSetting, getSessionsForLeaderboard } from '@/lib/queries';
import { cleanSocialLinks } from '@/lib/social';

const SUBMIT_ENDPOINT = 'https://agentgraphed.com/api/leaderboard/submit';
const SUBMIT_TIMEOUT_MS = 8_000;
const SCHEMA_VERSION = 2;
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
// Stable per-install identifier. Generated once on first submit and
// persisted in the local settings table. Included in every submission
// so the server can compute identity-coherence heuristics (one handle
// from many installs = suspicious; many handles from one install =
// suspicious). It's a 16-byte random hex string with no link back to
// the user — losing it just costs a new identity, not access.
const INSTALL_ID_KEY = 'install_id';

function getOrCreateInstallId(): string {
  let id = getSetting(INSTALL_ID_KEY);
  if (id && /^[a-f0-9]{32}$/.test(id)) return id;
  id = randomBytes(16).toString('hex');
  setSetting(INSTALL_ID_KEY, id);
  return id;
}

// Client version, read once at module load. The server can use this
// to spot submissions from a curl-script that lies about its version,
// and to drop submissions from a client version known to be broken.
function readClientVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('../../../package.json') as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
const CLIENT_VERSION = readClientVersion();

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

// Server caps batches at 500 session rows per POST, so when we're
// seeding the user's full history we chunk client-side.
const SERVER_BATCH_CAP = 500;
// First time anyone submits, push everything (all-time). After that we
// only send the trailing 7 days because the server UPSERTs by
// session_uuid and old data doesn't change. The "seeded" flag is set
// only after the seed succeeds.
const SEEDED_FLAG = 'leaderboard_seeded_alltime';

async function submitNow(handle: string, socialLinks: string[]): Promise<{ ok: boolean; status: number; rowsWritten?: number } | null> {
  const seeded = getSetting(SEEDED_FLAG) === '1';
  const since = seeded ? Math.max(0, Date.now() - LOOKBACK_MS) : 0;
  const sessions = getSessionsForLeaderboard(since);
  // If the user has no sessions in the window, mark them as submitting
  // (so opt-in feedback succeeds) but there's nothing to send yet.
  if (sessions.length === 0) return { ok: true, status: 204, rowsWritten: 0 };

  // Chunk into batches the server can accept. social_links rides with
  // the first chunk only — it's a profile-level field, not per-batch.
  const installId = getOrCreateInstallId();
  let totalWritten = 0;
  let lastStatus = 0;
  for (let i = 0; i < sessions.length; i += SERVER_BATCH_CAP) {
    const chunk = sessions.slice(i, i + SERVER_BATCH_CAP);
    const payload = {
      handle,
      schema_version: SCHEMA_VERSION,
      // install_id is per-install stable; client_version is read from
      // package.json. Both go in every chunk — small, idempotent, and
      // the server uses them to compute identity-coherence heuristics.
      install_id: installId,
      client_version: CLIENT_VERSION,
      social_links: i === 0 ? socialLinks : undefined,
      sessions: chunk.map(toSessionRow),
    };
    const resp = await postBatch(payload);
    if (!resp) return null;
    lastStatus = resp.status;
    if (!resp.ok) {
      // Don't set the seeded flag on partial failure — the user will
      // retry on the next submit cycle.
      return resp;
    }
    totalWritten += resp.rowsWritten ?? 0;
  }
  // Mark the user as seeded only after every chunk lands.
  if (!seeded) setSetting(SEEDED_FLAG, '1');
  return { ok: true, status: lastStatus, rowsWritten: totalWritten };
}

type LeaderboardSessionInput = ReturnType<typeof getSessionsForLeaderboard>[number];
function toSessionRow(s: LeaderboardSessionInput) {
  return {
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
  };
}

// POST one batch. Returns null on network/abort failure so the caller
// can short-circuit; on HTTP response (success or otherwise) returns
// {ok, status, rowsWritten}.
async function postBatch(payload: unknown): Promise<{ ok: boolean; status: number; rowsWritten?: number } | null> {
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
      // server didn't return JSON; non-fatal
    }
    return { ok: resp.ok, status: resp.status, rowsWritten };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Change the handle the user submits under. Calls the server's
// /api/leaderboard/rename endpoint, which UPDATEs every row owned by the
// old handle to the new handle in a single transaction. This avoids the
// "now I'm on the leaderboard twice" bug that the previous local-only
// rename + resubmit approach produced.
//
// We only mutate local state after the server has confirmed the rename
// landed. The collision case (new_handle already taken) bubbles up as a
// clear error string the UI surfaces inline.
const RENAME_ENDPOINT = 'https://agentgraphed.com/api/leaderboard/rename';
const RENAME_TIMEOUT_MS = 8_000;

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
    if (!old) {
      return { ok: false, error: 'No existing handle to rename from.' };
    }
    if (old === trimmed) {
      // Already there — keep the same local state, no server round-trip.
      return { ok: true, submitted: false };
    }

    // Server round-trip first. Only commit to the local setting if the
    // rename actually succeeded — otherwise the user would end up with a
    // local handle that doesn't match any server row.
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), RENAME_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(RENAME_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ old_handle: old, new_handle: trimmed }),
        signal: ctrl.signal,
      });
    } catch (e) {
      return { ok: false, error: `Couldn't reach the leaderboard server: ${(e as Error).message}` };
    } finally {
      clearTimeout(timeout);
    }
    let bodyJson: { ok?: boolean; error?: string; reason?: string; no_op?: boolean } = {};
    try {
      bodyJson = (await resp.json()) as typeof bodyJson;
    } catch {
      // ignore — leave bodyJson empty
    }
    if (!resp.ok) {
      return {
        ok: false,
        error: bodyJson.error ?? `Rename failed (HTTP ${resp.status}).`,
      };
    }

    // 404 not_found is a server "ok: false" but we can recover by treating
    // it as a fresh first-time submission — the user had a local handle
    // setting but never actually submitted under it. Above this point any
    // resp.ok=false already returned, so here we're definitely ok.
    setSetting('leaderboard_handle', trimmed);
    revalidatePath('/leaderboard');
    return { ok: true, submitted: !bodyJson.no_op };
  } catch (e) {
    return { ok: false, error: (e as Error).message || 'Unknown error' };
  }
}
