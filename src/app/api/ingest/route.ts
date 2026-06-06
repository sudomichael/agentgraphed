// Remote-capture endpoint. Receives one Claude/Codex session JSONL file from a
// SessionEnd hook running on a dev's machine and writes it to a directory the
// ingester will read on its next scan.
//
// Intentionally dumb: just writes the file. The existing ingester does the work
// on the next pass. This keeps the endpoint fast and reuses all parsing logic.

import { NextRequest } from 'next/server';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDir } from '@/lib/db/paths';
import { getSetting, setSetting } from '@/lib/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function unauthorized(reason: string) {
  return new Response(JSON.stringify({ ok: false, error: reason }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}

function bad(reason: string) {
  return new Response(JSON.stringify({ ok: false, error: reason }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(req: NextRequest) {
  // Soft auth: a shared token persisted in the local DB. Single-user OSS
  // build means the token is mostly there to keep random network scans out.
  // In an agency-tier hosted build this would resolve to a workspace + user.
  let expected = getSetting('ingest_token');
  if (!expected) {
    expected = randomUUID();
    setSetting('ingest_token', expected);
  }
  const provided = req.headers.get('x-ingest-token');
  if (!provided || provided !== expected) return unauthorized('bad token');

  const provider = req.headers.get('x-provider') || 'claude';
  if (provider !== 'claude' && provider !== 'codex') return bad('unknown provider');

  const sessionId = req.headers.get('x-session-id') || randomUUID();
  const cwd = req.headers.get('x-cwd') || '';
  const username = req.headers.get('x-user') || 'unknown';
  const hostname = req.headers.get('x-host') || 'unknown';

  let body: string;
  try {
    body = await req.text();
  } catch (e) {
    return bad(`failed to read body: ${(e as Error).message}`);
  }
  if (!body.trim()) return bad('empty body');
  if (body.length > 50_000_000) return bad('payload too large');

  // Mirror the on-disk layout the ingester already knows how to read.
  // For Claude: ~/.agentgraphed/uploads/claude/<userhost>/<encoded-cwd>/<session>.jsonl
  // For Codex:  ~/.agentgraphed/uploads/codex/<userhost>/<session>.jsonl
  const safeUser = `${username}@${hostname}`.replace(/[^a-zA-Z0-9._@-]/g, '_').slice(0, 80);
  const base = join(dataDir(), 'uploads', provider, safeUser);

  let targetPath: string;
  if (provider === 'claude') {
    const encodedCwd = cwd.replace(/[\/\\]/g, '-').replace(/^-/, '') || 'unknown-cwd';
    const safeCwd = encodedCwd.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160);
    targetPath = join(base, safeCwd, `${sessionId}.jsonl`);
  } else {
    targetPath = join(base, `${sessionId}.jsonl`);
  }

  try {
    await mkdir(join(targetPath, '..'), { recursive: true });
    await writeFile(targetPath, body, 'utf8');
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: `write failed: ${(e as Error).message}` }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  return new Response(
    JSON.stringify({ ok: true, stored: targetPath, bytes: body.length }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

export async function GET() {
  // Health check + token bootstrap for the onboard script. Returns the token
  // so the local user can hand it to the onboard command without copy-pasting
  // SQL. In a hosted product this would not exist; the token would come from
  // signup/login.
  let token = getSetting('ingest_token');
  if (!token) {
    token = randomUUID();
    setSetting('ingest_token', token);
  }
  return new Response(JSON.stringify({ ok: true, token }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
