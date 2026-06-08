// When AGENTGRAPHED_DEMO_HOME is set, rewrite the user's real home path to that
// value in any path rendered in the UI — used for demo screenshots/gifs so the
// macOS username doesn't appear. When the env var is unset (normal local use),
// paths are returned unchanged.

import { homedir } from 'node:os';

export function displayPath(p: string): string {
  if (!p) return p;
  const demo = process.env.AGENTGRAPHED_DEMO_HOME;
  if (!demo) return p;
  const home = homedir();
  if (p.startsWith(home)) return demo + p.slice(home.length);
  return p.replace(/^(\/Users|\/home)\/[^/]+/, demo);
}
