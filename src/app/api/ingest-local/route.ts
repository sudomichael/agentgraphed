// Local ingest trigger. Called by bin/agentgraphed.js on boot so the standalone
// bundle does the parsing — keeps the binary thin (no tsx / Next runtime on
// the user's machine) and means anyone who wants to re-scan can also just hit
// this endpoint.

import { runIngest } from '@/lib/ingest/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const result = await runIngest();
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }
}

export async function GET() {
  return POST();
}
