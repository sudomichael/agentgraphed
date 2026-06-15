#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
//
// Entry point for `npx agentgraphed`.
//
// Boots the prebuilt Next.js standalone server, triggers an ingest of any
// local Claude / Codex sessions, then opens the dashboard in the user's
// browser. Designed so a fresh install has zero setup steps.
//

const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const path = require('node:path');
const { existsSync } = require('node:fs');

const ROOT = path.resolve(__dirname, '..');

// --- Subcommands (handled inline, no server boot) ---
const argv = process.argv.slice(2);
const subcommand = argv[0];
switch (subcommand) {
  case 'help':
  case '--help':
  case '-h':
    printHelp();
    process.exit(0);
  case 'version':
  case '--version':
  case '-v':
    console.log(require('../package.json').version);
    process.exit(0);
}

// --join is a flag, not a subcommand — the user runs the SAME boot
// flow but the browser opens directly on the leaderboard opt-in
// section instead of the dashboard root. Lets the centerpiece
// "npx agentgraphed --join" CTA on agentgraphed.com/leaderboard
// drop people one click from being on the board.
const wantsJoin = argv.includes('--join');

// --no-open (or AGENTGRAPHED_NO_OPEN=1) runs the SAME boot flow but skips the
// browser launch. Lets you run AgentGraphed headlessly — as a background
// service (launchd / systemd), in a container, or over SSH — where popping a
// browser is impossible or unwanted. The server still prints its URL.
const noOpen =
  argv.includes('--no-open') ||
  process.env.AGENTGRAPHED_NO_OPEN === '1' ||
  process.env.AGENTGRAPHED_NO_OPEN === 'true';

function printHelp() {
  const version = require('../package.json').version;
  console.log(`AgentGraphed v${version} — local-first analytics for AI coding sessions

Usage:
  agentgraphed              Start the dashboard (default)
  agentgraphed --join       Start the dashboard, opening the leaderboard
                            opt-in page so you can put yourself on the
                            public board at agentgraphed.com/leaderboard
  agentgraphed --no-open    Start without opening a browser (headless /
                            services / SSH). Just prints the URL.
  agentgraphed --help       Show this message
  agentgraphed --version    Print the installed version

Environment:
  AGENTGRAPHED_DATA_DIR     Where to store the SQLite DB (default: ~/.agentgraphed)
  AGENTGRAPHED_PORT         Starting port to try (default: 3737)
  AGENTGRAPHED_NO_OPEN      Set to 1 to never open a browser (same as --no-open)
`);
}

async function findFreePort(start) {
  for (let p = start; p < start + 100; p++) {
    const ok = await new Promise((res) => {
      const srv = createServer()
        .once('error', () => res(false))
        .once('listening', () => srv.close(() => res(true)));
      srv.listen(p, '127.0.0.1');
    });
    if (ok) return p;
  }
  throw new Error('no free port found');
}

function locateStandaloneServer() {
  const candidates = [
    path.join(ROOT, '.next', 'standalone', 'server.js'),
    path.join(ROOT, 'standalone', 'server.js'),
  ];
  return candidates.find(existsSync) ?? null;
}

async function pingUntilReady(port, timeoutMs = 15_000) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { method: 'HEAD' });
      if (res.ok || res.status < 500) return;
    } catch {
      // server still booting
    }
    if (Date.now() - start > timeoutMs) throw new Error('server failed to start in time');
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function triggerIngest(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/ingest-local`, { method: 'POST' });
    if (!res.ok) {
      console.warn(`  (ingest endpoint returned ${res.status})`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn(`  (ingest failed: ${e.message})`);
    return null;
  }
}

async function main() {
  const standalone = locateStandaloneServer();
  if (!standalone) {
    console.error(
      'AgentGraphed build not found. If you cloned this repo, run `npm run build` first.',
    );
    console.error('If you installed via npm/npx, this is a packaging bug — please file an issue.');
    process.exit(1);
  }

  const startPort = parseInt(process.env.AGENTGRAPHED_PORT || '3737', 10);
  const port = await findFreePort(startPort);

  console.log(`› Starting AgentGraphed on http://localhost:${port}`);
  const server = spawn(process.execPath, [standalone], {
    cwd: path.dirname(standalone),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
    },
  });

  // Surface server errors but stay quiet on normal stdout chatter.
  server.stderr.on('data', (d) => process.stderr.write(d));
  server.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`Server exited unexpectedly (code ${code})`);
      process.exit(1);
    }
  });

  try {
    await pingUntilReady(port);
  } catch (e) {
    console.error(e.message);
    server.kill('SIGTERM');
    process.exit(1);
  }

  console.log('› Scanning local AI coding sessions…');
  const result = await triggerIngest(port);
  if (result?.ok) {
    const c = result.claude || {};
    const x = result.codex || {};
    console.log(
      `  Found ${c.sessions ?? 0} Claude + ${x.sessions ?? 0} Codex sessions ` +
        `(${(c.messages ?? 0) + (x.messages ?? 0)} messages indexed in ${result.durationMs}ms)`,
    );
  }

  // Open the browser after the page is reachable. With --join we
  // land directly on the local leaderboard opt-in page (which also
  // has the rename / social-links flow) instead of the dashboard.
  const startPath = wantsJoin ? '/leaderboard?join=1' : '/';
  const startUrl = `http://localhost:${port}${startPath}`;
  if (noOpen) {
    console.log(`  (browser auto-open disabled — open ${startUrl})`);
  } else {
    try {
      const { default: open } = await import('open');
      await open(startUrl);
    } catch {
      console.log(`  (open ${startUrl} in your browser)`);
    }
  }

  if (wantsJoin) {
    console.log('› Opt-in form opened — pick a handle and click Join to add yourself to the public board.');
  }
  console.log('› Ready. Press Ctrl+C to stop.');

  const cleanup = () => {
    server.kill('SIGTERM');
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
