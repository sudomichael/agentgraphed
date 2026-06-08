// Probe OpenAI for live quota state.
//
// Codex's own OAuth token has a narrow scope (its internal /v1/responses)
// and can't see general rate-limit headers. So we instead let the user
// supply an OPENAI_API_KEY (the same setting the optional LLM-classifier
// uses) and probe with that. OpenAI returns x-ratelimit-* headers on
// every authenticated call.
//
// Cost: 1 token on gpt-5-mini per probe (~$0.000001). Caller decides when
// to probe; nothing runs unless explicitly invoked.

import { getSetting } from '@/lib/queries';

const API_URL = 'https://api.openai.com/v1/chat/completions';

const PROBE_BODY = JSON.stringify({
  model: 'gpt-5-mini',
  max_tokens: 1,
  messages: [{ role: 'user', content: 'hi' }],
});

export type CodexProbeResult =
  | {
      ok: true;
      observedAt: number;
      planType: string | null;
      // OpenAI returns separate request and token limits, both per-minute. We
      // surface tokens (the binding constraint in practice).
      primary: { utilization: number; resetsAt: number; status: string | null } | null;
      // OpenAI doesn't expose a "7-day" / longer window header; we leave
      // secondary null. The card hides what isn't reported.
      secondary: null;
      tokenWasRefreshed: false;
    }
  | { ok: false; error: string; httpStatus?: number };

function parseReset(raw: string | null): number | null {
  if (!raw) return null;
  // OpenAI returns durations like "6ms", "0s", "1m30s", "2h"; convert to absolute ms.
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

export async function probeCodexQuota(): Promise<CodexProbeResult> {
  const apiKey = getSetting('openai_api_key');
  if (!apiKey) {
    return {
      ok: false,
      error: 'No OpenAI API key configured. Add one in Settings → LLM provider to enable Codex live quota.',
    };
  }

  let resp: Response;
  try {
    resp = await fetch(API_URL, {
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
    return { ok: false, error: 'OpenAI returned 401 — check the key in Settings.', httpStatus: 401 };
  }
  if (resp.status >= 500) {
    return { ok: false, error: `OpenAI returned ${resp.status}`, httpStatus: resp.status };
  }
  // 429 still includes rate-limit headers — fall through and read them, but
  // surface the status so the UI can warn.
  // For 4xx other than 401, we still read headers — the limit info is valid.

  const h = resp.headers;
  const limitTokens = Number(h.get('x-ratelimit-limit-tokens') ?? '');
  const remainingTokens = Number(h.get('x-ratelimit-remaining-tokens') ?? '');
  const resetTokens = parseReset(h.get('x-ratelimit-reset-tokens'));

  if (!Number.isFinite(limitTokens) || !Number.isFinite(remainingTokens) || resetTokens === null) {
    return {
      ok: false,
      error: `OpenAI did not return rate-limit headers (HTTP ${resp.status}). The key may be restricted.`,
      httpStatus: resp.status,
    };
  }

  const utilization = limitTokens > 0 ? (limitTokens - remainingTokens) / limitTokens : 0;

  return {
    ok: true,
    observedAt: Date.now(),
    planType: 'api',
    primary: {
      utilization,
      resetsAt: resetTokens,
      status: resp.status === 429 ? 'rate_limited' : 'allowed',
    },
    secondary: null,
    tokenWasRefreshed: false,
  };
}
