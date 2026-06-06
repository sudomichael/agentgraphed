import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

export function dataDir(): string {
  const dir = process.env.AGENTGRAPHED_DATA_DIR || join(homedir(), '.agentgraphed');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbPath(): string {
  return join(dataDir(), 'agentgraphed.sqlite');
}
