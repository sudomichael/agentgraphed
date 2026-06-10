import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';

const GO_API_URL = 'https://opencode.ai/zen/go/v1/chat/completions';
const AUTH_PATH = join(homedir(), '.local', 'share', 'opencode', 'auth.json');

const PROBE_BODY = JSON.stringify({
  model: 'deepseek-v4-flash',
  max_tokens: 1,
  messages: [{ role: 'user', content: 'hi' }],
});

export type OpencodeProbeResult =
  | {
      ok: true;
      observedAt: number;
      planType: string | null;
      primary: { utilization: number; resetsAt: number; status: string | null } | null;
      secondary: null;
      tokenWasRefreshed: false;
    }
  | { ok: false; error: string; httpStatus?: number };

function readGoApiKey(): string | null {
  try {
    if (!existsSync(AUTH_PATH)) return null;
    const auth = JSON.parse(readFileSync(AUTH_PATH, 'utf8'));
    return auth?.['opencode-go']?.key || null;
  } catch {
    return null;
  }
}

function parseReset(raw: string | null): number | null {
  if (!raw) return null;
  const re = /(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+)ms)?/;
  const m = raw.match(re);
  if (!m) return null;
  const h = parseInt(m[1] || '0', 10);
  const min = parseInt(m[2] || '0', 10);
  const s = parseFloat(m[3] || '0');
  const ms = parseInt(m[4] || '0', 10);
  const totalMs = h * 3_600_000 + min * 60_000 + Math.round(s * 1000) + ms;
  if (totalMs <= 0) return Date.now();
  return Date.now() + totalMs;
}

export async function probeOpencodeQuota(): Promise<OpencodeProbeResult> {
  const apiKey = readGoApiKey();
  if (!apiKey) {
    return {
      ok: false,
      error: 'No OpenCode Go API key found. Log in with `opencode auth login` first.',
    };
  }

  let resp: Response;
  try {
    resp = await fetch(GO_API_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: PROBE_BODY,
    });
    try { await resp.text(); } catch { /* ignore */ }
  } catch (e) {
    return { ok: false, error: `Probe request failed: ${(e as Error).message}` };
  }

  if (resp.status === 401) {
    return { ok: false, error: 'OpenCode Go returned 401 — check your API key.', httpStatus: 401 };
  }
  if (resp.status >= 500) {
    return { ok: false, error: `OpenCode Go returned ${resp.status}`, httpStatus: resp.status };
  }

  const h = resp.headers;
  const limitTokens = Number(h.get('x-ratelimit-limit-tokens') ?? '');
  const remainingTokens = Number(h.get('x-ratelimit-remaining-tokens') ?? '');
  const resetTokens = parseReset(h.get('x-ratelimit-reset-tokens'));

  // OpenCode Go uses dollar-value limits ($12/5h, $30/week, $60/month) which
  // aren't exposed via rate-limit headers. If headers are available, surface
  // them; otherwise report a healthy connection without utilization data.
  if (Number.isFinite(limitTokens) && Number.isFinite(remainingTokens) && resetTokens !== null) {
    const utilization = limitTokens > 0 ? (limitTokens - remainingTokens) / limitTokens : 0;
    return {
      ok: true,
      observedAt: Date.now(),
      planType: 'opencode-go',
      primary: {
        utilization,
        resetsAt: resetTokens,
        status: resp.status === 429 ? 'rate_limited' : 'allowed',
      },
      secondary: null,
      tokenWasRefreshed: false,
    };
  }

  return {
    ok: true,
    observedAt: Date.now(),
    planType: 'opencode-go',
    primary: null,
    secondary: null,
    tokenWasRefreshed: false,
  };
}
