// Read Claude Code's OAuth credentials.
//
// Recent Claude Code versions (on macOS) moved credentials out of the legacy
// ~/.claude/.credentials.json file and into the macOS Keychain under the
// service name "Claude Code-credentials". Older installs (and Linux/Windows)
// still use the file. We try Keychain first on macOS, then fall back to disk.
//
// Security: the Keychain entry is gated by the OS login session; the disk
// version is mode 0600. We never log either, never send the contents anywhere
// except api.anthropic.com over TLS, and never persist them — quota_snapshots
// stores only the derived percentages.

import { readFile, writeFile, stat, chmod } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const CREDENTIALS_PATH =
  process.env.CLAUDE_CREDENTIALS_PATH || join(homedir(), '.claude', '.credentials.json');
const KEYCHAIN_SERVICE = 'Claude Code-credentials';

export type ClaudeCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;            // ms epoch
  subscriptionType: string | null;
  rateLimitTier: string | null;
};

export type CredentialsSource = 'keychain' | 'file';

export type CredentialsResult =
  | { ok: true; creds: ClaudeCredentials; source: CredentialsSource; warning?: string }
  | { ok: false; error: string };

// Read the credentials blob from macOS Keychain. Returns null on any failure
// (entry missing, not on macOS, security cmd unavailable) so the caller can
// fall back to the disk path. Never throws.
function readKeychain(): Promise<string | null> {
  return new Promise((resolve) => {
    if (platform() !== 'darwin') return resolve(null);
    const child = spawn('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0) return resolve(null);
      const trimmed = out.trim();
      resolve(trimmed.length > 0 ? trimmed : null);
    });
  });
}

export async function readClaudeCredentials(): Promise<CredentialsResult> {
  // 1. Try macOS Keychain first — that's where modern Claude Code stores tokens.
  let raw: string | null = await readKeychain();
  let source: 'keychain' | 'file' = 'keychain';

  // 2. Fall back to ~/.claude/.credentials.json (legacy macOS, Linux/Windows).
  if (!raw) {
    source = 'file';
    try {
      raw = await readFile(CREDENTIALS_PATH, 'utf8');
    } catch (e) {
      const msg = (e as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'Claude Code credentials not found. Sign into Claude Code first with `claude /login`.'
        : `Could not read credentials: ${(e as Error).message}`;
      return { ok: false, error: msg };
    }
  }

  let parsed: { claudeAiOauth?: Partial<ClaudeCredentials> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'credentials.json is not valid JSON' };
  }

  const oauth = parsed.claudeAiOauth;
  if (!oauth?.accessToken || !oauth.refreshToken || !oauth.expiresAt) {
    return { ok: false, error: 'credentials.json is missing claudeAiOauth fields' };
  }

  // Warn (but don't block) if the *file* form isn't owner-only — surfaces
  // misconfigured installs. No warning for Keychain — the OS gates access.
  let warning: string | undefined;
  if (source === 'file') {
    try {
      const st = await stat(CREDENTIALS_PATH);
      const modeBits = st.mode & 0o777;
      if (modeBits !== 0o600 && process.platform !== 'win32') {
        warning = `~/.claude/.credentials.json has mode ${modeBits.toString(8)}; expected 600.`;
      }
    } catch {
      // ignore — we already have the contents
    }
  }

  return {
    ok: true,
    source,
    creds: {
      accessToken: oauth.accessToken,
      refreshToken: oauth.refreshToken,
      expiresAt: oauth.expiresAt,
      subscriptionType: oauth.subscriptionType ?? null,
      rateLimitTier: oauth.rateLimitTier ?? null,
    },
    warning,
  };
}

// Write refreshed tokens back, preserving 0600 permissions. Atomically by
// writing-then-renaming to avoid corrupting the file mid-write.
export async function writeClaudeCredentials(updated: ClaudeCredentials): Promise<void> {
  const raw = await readFile(CREDENTIALS_PATH, 'utf8');
  const parsed = JSON.parse(raw) as { claudeAiOauth?: Record<string, unknown> };
  const merged = {
    ...parsed,
    claudeAiOauth: {
      ...(parsed.claudeAiOauth ?? {}),
      accessToken: updated.accessToken,
      refreshToken: updated.refreshToken,
      expiresAt: updated.expiresAt,
    },
  };
  const next = JSON.stringify(merged, null, 2);
  const tmpPath = `${CREDENTIALS_PATH}.tmp-${Date.now()}`;
  await writeFile(tmpPath, next, { encoding: 'utf8', mode: 0o600 });
  await chmod(tmpPath, 0o600);
  // Rename is atomic on POSIX same-fs.
  const { rename } = await import('node:fs/promises');
  await rename(tmpPath, CREDENTIALS_PATH);
}
