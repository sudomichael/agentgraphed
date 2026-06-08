// Probe Anthropic for live quota state.
//
// Sends a 1-token request to /v1/messages and reads the rate-limit headers
// from the response. Anthropic returns these on every authenticated call,
// so this costs the minimum possible (~1 input + 1 output token; well under
// a tenth of a cent). Same approach Clawdmeter uses; the API surface is
// public for any authenticated caller.
//
// On 401 the caller can refresh the token and retry. We do not retry here —
// the route handler decides whether to chain a refresh.

import { readClaudeCredentials } from './credentials';
import { refreshClaudeCredentials, isExpired } from './refresh';

const API_URL = 'https://api.anthropic.com/v1/messages';

// User-Agent must look like the CLI; Anthropic's gateway gates some headers on it.
const PROBE_HEADERS = {
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'oauth-2025-04-20',
  'content-type': 'application/json',
  'user-agent': 'claude-code/2.1.5',
};

const PROBE_BODY = JSON.stringify({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 1,
  messages: [{ role: 'user', content: 'hi' }],
});

export type QuotaProbeResult =
  | {
      ok: true;
      observedAt: number;
      planType: string | null;          // e.g. "max", "pro", or null
      primary: { utilization: number; resetsAt: number; status: string | null } | null;
      secondary: { utilization: number; resetsAt: number; status: string | null } | null;
      tokenWasRefreshed: boolean;
    }
  | { ok: false; error: string; httpStatus?: number };

function parseUtilization(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseUnixSecondsHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n * 1000) : null; // -> ms epoch
}

async function probeWithToken(accessToken: string): Promise<{ status: number; headers: Headers }> {
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { ...PROBE_HEADERS, authorization: `Bearer ${accessToken}` },
    body: PROBE_BODY,
  });
  // Drain the body so the socket can be reused — we don't care about the
  // content, only the headers.
  try { await resp.text(); } catch { /* ignore */ }
  return { status: resp.status, headers: resp.headers };
}

export async function probeClaudeQuota(): Promise<QuotaProbeResult> {
  const credsResult = await readClaudeCredentials();
  if (!credsResult.ok) return { ok: false, error: credsResult.error };
  let creds = credsResult.creds;
  let source = credsResult.source;
  let tokenWasRefreshed = false;

  // Proactively refresh if expired or near-expiry.
  if (isExpired(creds.expiresAt)) {
    const r = await refreshClaudeCredentials(creds, source);
    if (!r.ok) {
      const isStale = r.httpStatus === 429 || r.httpStatus === 400 || r.httpStatus === 401;
      const hint = isStale
        ? 'Stored token cannot be refreshed. Run `claude /login` in your terminal, then try again.'
        : r.error;
      return { ok: false, error: hint };
    }
    const reread = await readClaudeCredentials();
    if (!reread.ok) return { ok: false, error: reread.error };
    creds = reread.creds;
    source = reread.source;
    tokenWasRefreshed = true;
  }

  let result: { status: number; headers: Headers };
  try {
    result = await probeWithToken(creds.accessToken);
  } catch (e) {
    return { ok: false, error: `Probe request failed: ${(e as Error).message}` };
  }

  // 401 → refresh once then retry.
  if (result.status === 401 && !tokenWasRefreshed) {
    const r = await refreshClaudeCredentials(creds, source);
    if (!r.ok) return { ok: false, error: `401 from API: ${r.error}`, httpStatus: 401 };
    const reread = await readClaudeCredentials();
    if (!reread.ok) return { ok: false, error: reread.error };
    creds = reread.creds;
    source = reread.source;
    tokenWasRefreshed = true;
    try {
      result = await probeWithToken(creds.accessToken);
    } catch (e) {
      return { ok: false, error: `Retry probe failed: ${(e as Error).message}` };
    }
  }

  if (result.status === 401) {
    return { ok: false, error: 'Still unauthorized after refresh — re-login with `claude /login`', httpStatus: 401 };
  }
  if (result.status === 429) {
    return { ok: false, error: 'Rate-limited by Anthropic — slow down polling', httpStatus: 429 };
  }
  // 200, 400, 529, etc. all still include rate-limit headers — accept any 2xx/4xx
  // EXCEPT 401/429 we handled above.
  if (result.status >= 500) {
    return { ok: false, error: `Anthropic returned ${result.status}`, httpStatus: result.status };
  }

  const h = result.headers;
  const primary5h = parseUtilization(h, 'anthropic-ratelimit-unified-5h-utilization');
  const primary5hReset = parseUnixSecondsHeader(h, 'anthropic-ratelimit-unified-5h-reset');
  const primary5hStatus = h.get('anthropic-ratelimit-unified-5h-status');
  const secondary7d = parseUtilization(h, 'anthropic-ratelimit-unified-7d-utilization');
  const secondary7dReset = parseUnixSecondsHeader(h, 'anthropic-ratelimit-unified-7d-reset');
  const secondary7dStatus = h.get('anthropic-ratelimit-unified-7d-status');

  return {
    ok: true,
    observedAt: Date.now(),
    planType: creds.subscriptionType,
    primary: primary5h !== null && primary5hReset !== null
      ? { utilization: primary5h, resetsAt: primary5hReset, status: primary5hStatus }
      : null,
    secondary: secondary7d !== null && secondary7dReset !== null
      ? { utilization: secondary7d, resetsAt: secondary7dReset, status: secondary7dStatus }
      : null,
    tokenWasRefreshed,
  };
}
