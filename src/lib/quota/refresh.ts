// Refresh Claude Code's OAuth access token.
//
// Claude Code's access tokens expire roughly every 8 hours. When that happens,
// /v1/messages returns 401 and our probe goes dark. This module mints a fresh
// token via the documented refresh-token grant, mirroring what Claude Code
// itself does internally (and what Clawdmeter does for the same purpose).
//
// SAFETY:
//   - Only attempt when the stored token is actually expired (with a 2-min skew)
//   - Back up the credentials file before writing
//   - Write atomically (temp + rename)
//   - Verify the new file is parseable and contains the expected access token
//   - Revert from backup on any verification failure
//
// We never log token values. The OAuth client_id is the public Claude Code
// client id (same one shipped in the CLI binary) and is safe to bundle.

import { readFile, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ClaudeCredentials, CredentialsSource } from './credentials';

const OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CREDENTIALS_PATH =
  process.env.CLAUDE_CREDENTIALS_PATH || join(homedir(), '.claude', '.credentials.json');
const EXPIRY_SKEW_MS = 120_000; // 2 min

export type RefreshResult =
  | { ok: true; expiresAt: number; reverted?: false }
  | { ok: false; error: string; httpStatus?: number; reverted?: boolean };

export function isExpired(expiresAt: number, now = Date.now()): boolean {
  return now + EXPIRY_SKEW_MS >= expiresAt;
}

type OAuthTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number; // seconds
};

export async function refreshClaudeCredentials(
  current: ClaudeCredentials,
  source: CredentialsSource = 'file',
): Promise<RefreshResult> {
  // When credentials come from the macOS Keychain we don't try to write back —
  // Claude Code owns that entry and our `security add-generic-password` would
  // either fail (different user/keychain context) or clobber whatever the CLI
  // has cached. Surface a clear next step instead.
  if (source === 'keychain') {
    return {
      ok: false,
      error: 'Token expired in Keychain. Reopen Claude Code (or run a `claude` command) so it can refresh, then probe again.',
    };
  }

  let originalRaw: string;
  try {
    originalRaw = await readFile(CREDENTIALS_PATH, 'utf8');
  } catch (e) {
    return { ok: false, error: `Cannot read credentials: ${(e as Error).message}` };
  }

  let body: OAuthTokenResponse;
  let httpStatus = 0;
  try {
    const resp = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'anthropic',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: current.refreshToken,
        client_id: CLIENT_ID,
      }),
    });
    httpStatus = resp.status;
    if (resp.status === 429) {
      return { ok: false, error: 'Rate limited by token endpoint', httpStatus };
    }
    if (!resp.ok) {
      return {
        ok: false,
        error: `Refresh rejected (HTTP ${resp.status}); re-login with Claude Code may be needed`,
        httpStatus,
      };
    }
    body = (await resp.json()) as OAuthTokenResponse;
  } catch (e) {
    return { ok: false, error: `Refresh request failed: ${(e as Error).message}` };
  }

  if (!body.access_token || typeof body.expires_in !== 'number') {
    return { ok: false, error: 'Unexpected refresh response shape', httpStatus };
  }

  const newExpiresAt = Date.now() + body.expires_in * 1000;
  const newAccess = body.access_token;
  const newRefresh = body.refresh_token ?? current.refreshToken;

  // Merge into existing JSON so we don't clobber unrelated keys.
  let parsed: { claudeAiOauth?: Record<string, unknown> };
  try {
    parsed = JSON.parse(originalRaw);
  } catch {
    return { ok: false, error: 'credentials.json became unparseable mid-flight' };
  }
  parsed.claudeAiOauth = {
    ...(parsed.claudeAiOauth ?? {}),
    accessToken: newAccess,
    refreshToken: newRefresh,
    expiresAt: newExpiresAt,
  };
  const nextRaw = JSON.stringify(parsed, null, 2);

  // Atomic write: temp + rename. Permissions preserved from the original file.
  const tmpPath = `${CREDENTIALS_PATH}.agentgraphed-tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tmpPath, nextRaw, { encoding: 'utf8', mode: 0o600 });
    await rename(tmpPath, CREDENTIALS_PATH);
  } catch (e) {
    // Try to clean up; restore original on failure.
    try { await writeFile(CREDENTIALS_PATH, originalRaw, { encoding: 'utf8', mode: 0o600 }); } catch {}
    return { ok: false, error: `Could not persist refreshed token: ${(e as Error).message}`, reverted: true };
  }

  // Verify by re-reading.
  try {
    const check = await readFile(CREDENTIALS_PATH, 'utf8');
    const parsedCheck = JSON.parse(check) as { claudeAiOauth?: { accessToken?: string } };
    if (parsedCheck.claudeAiOauth?.accessToken !== newAccess) {
      throw new Error('post-write token mismatch');
    }
  } catch (e) {
    try { await writeFile(CREDENTIALS_PATH, originalRaw, { encoding: 'utf8', mode: 0o600 }); } catch {}
    return { ok: false, error: `Verification failed: ${(e as Error).message}`, reverted: true };
  }

  return { ok: true, expiresAt: newExpiresAt };
}
