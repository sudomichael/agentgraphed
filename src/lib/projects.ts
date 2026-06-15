import { execSync } from 'node:child_process';
import { basename } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { getSqlite } from './db/client';

type ResolvedProject = {
  id: string;
  name: string;
  rootPath: string;
  gitRemote: string | null;
};

const cache = new Map<string, ResolvedProject>();

// Ingest runs these git calls synchronously on the single server thread, so a
// git invocation that blocks (no controlling TTY under a service manager, a
// credential/keychain helper waiting on a GUI, a slow network mount) would
// freeze the whole event loop and hang every request. The `timeout` bounds
// each call: on timeout execSync throws, we treat the repo as unresolved, and
// ingest continues. stdin is already /dev/null so git can't wait on input.
const GIT_TIMEOUT_MS = 5_000;

function gitRoot(cwd: string): { root: string; remote: string | null } | null {
  if (!existsSync(cwd)) return null;
  try {
    const root = execSync('git rev-parse --show-toplevel', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    }).trim();
    let remote: string | null = null;
    try {
      remote = execSync('git remote get-url origin', {
        cwd: root,
        stdio: ['ignore', 'pipe', 'ignore'],
        encoding: 'utf8',
        timeout: GIT_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      }).trim();
    } catch {
      // no origin
    }
    return { root, remote };
  } catch {
    return null;
  }
}

function makeId(rootPath: string): string {
  return createHash('sha1').update(rootPath).digest('hex').slice(0, 16);
}

export function resolveProject(cwd: string): ResolvedProject {
  if (cache.has(cwd)) return cache.get(cwd)!;

  let root = cwd;
  let remote: string | null = null;

  if (existsSync(cwd)) {
    const g = gitRoot(cwd);
    if (g) {
      root = g.root;
      remote = g.remote;
    }
  }

  const id = makeId(root);
  const name = remote ? deriveNameFromRemote(remote) : basename(root) || root;
  const resolved: ResolvedProject = { id, name, rootPath: root, gitRemote: remote };
  cache.set(cwd, resolved);
  return resolved;
}

function deriveNameFromRemote(remote: string): string {
  const m = remote.match(/[\/:]([^\/:]+?)(?:\.git)?$/);
  return m ? m[1] : remote;
}

export function upsertProject(p: ResolvedProject, timestamp: number) {
  const db = getSqlite();
  const existing = db
    .prepare('SELECT first_seen FROM projects WHERE id = ?')
    .get(p.id) as { first_seen: number } | undefined;

  if (existing) {
    db.prepare(
      'UPDATE projects SET last_active = MAX(last_active, ?), name = ?, root_path = ?, git_remote = ? WHERE id = ?',
    ).run(timestamp, p.name, p.rootPath, p.gitRemote, p.id);
  } else {
    db.prepare(
      'INSERT INTO projects (id, name, root_path, git_remote, first_seen, last_active) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(p.id, p.name, p.rootPath, p.gitRemote, timestamp, timestamp);
  }
}

// Suppress unused-warning for fs.statSync (used by callers later via dynamic checks)
void statSync;
