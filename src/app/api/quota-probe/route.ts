// POST /api/quota-probe?provider=claude|codex — run one live probe and persist
// the resulting snapshot. Returns the snapshot for the UI to render.
//
// Solo-user, local-only: reads the user's own OAuth credentials (Claude) or
// stored API key (Codex/OpenAI). Never reached from any hosted code path.

import { NextRequest } from 'next/server';
import { probeClaudeQuota } from '@/lib/quota/probe';
import { probeCodexQuota } from '@/lib/quota/codex';
import { getSqlite } from '@/lib/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Snapshot = {
  observedAt: number;
  planType: string | null;
  primary: { pct: number; resetsAt: number; status: string | null } | null;
  secondary: { pct: number; resetsAt: number; status: string | null } | null;
  tokenWasRefreshed: boolean;
};

export async function POST(req: NextRequest) {
  const provider = (req.nextUrl.searchParams.get('provider') ?? 'claude').toLowerCase();
  if (provider !== 'claude' && provider !== 'codex') {
    return new Response(JSON.stringify({ ok: false, error: `Unknown provider: ${provider}` }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }

  const result = provider === 'claude' ? await probeClaudeQuota() : await probeCodexQuota();
  if (!result.ok) {
    return new Response(JSON.stringify({ ok: false, provider, error: result.error, httpStatus: result.httpStatus }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  const db = getSqlite();
  db.prepare(
    `INSERT OR REPLACE INTO quota_snapshots (
       provider, observed_at, plan_type,
       primary_pct, primary_window_minutes, primary_resets_at,
       secondary_pct, secondary_window_minutes, secondary_resets_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    provider,
    result.observedAt,
    result.planType,
    result.primary ? Math.round(result.primary.utilization * 1000) / 10 : null,
    result.primary ? (provider === 'claude' ? 300 : 1) : null,
    result.primary ? result.primary.resetsAt : null,
    result.secondary ? Math.round(result.secondary.utilization * 1000) / 10 : null,
    result.secondary ? 7 * 24 * 60 : null,
    result.secondary ? result.secondary.resetsAt : null,
  );

  const snapshot: Snapshot = {
    observedAt: result.observedAt,
    planType: result.planType,
    primary: result.primary
      ? { pct: result.primary.utilization * 100, resetsAt: result.primary.resetsAt, status: result.primary.status }
      : null,
    secondary: result.secondary
      ? { pct: result.secondary.utilization * 100, resetsAt: result.secondary.resetsAt, status: result.secondary.status }
      : null,
    tokenWasRefreshed: result.tokenWasRefreshed,
  };

  return new Response(JSON.stringify({ ok: true, provider, snapshot }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}
