import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate the DB to a throwaway dir BEFORE importing anything that opens it.
// `dataDir()` honors AGENTGRAPHED_DATA_DIR (src/lib/db/paths.ts).
process.env.AGENTGRAPHED_DATA_DIR = mkdtempSync(join(tmpdir(), 'ag-getsources-'));
delete process.env.AGENTGRAPHED_CLAUDE_DIR;
delete process.env.AGENTGRAPH_CLAUDE_DIR;

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log('ok   -', name);
  } catch (e) {
    failures += 1;
    console.error('FAIL -', name, '\n     ', (e as Error).message);
  }
}

// Wrapped in an async function: this project transpiles to CommonJS, which
// does not allow top-level await for the dynamic imports below.
async function main() {
  const { setSetting } = await import('../queries');
  const { getSources } = await import('./sources');

  function reset() {
    setSetting('claude_sources', '');
    setSetting('claude_log_dir', '');
    delete process.env.AGENTGRAPHED_CLAUDE_DIR;
    delete process.env.AGENTGRAPH_CLAUDE_DIR;
  }

  check('nothing set → single default source at ~/.claude/projects', () => {
    reset();
    const s = getSources('claude');
    assert.equal(s.length, 1);
    assert.equal(s[0].tag, 'default');
    assert.ok(s[0].path.endsWith(join('.claude', 'projects')), `got ${s[0].path}`);
  });

  check('legacy claude_log_dir → that path tagged default', () => {
    reset();
    setSetting('claude_log_dir', '/legacy/claude/projects');
    assert.deepEqual(getSources('claude'), [{ path: '/legacy/claude/projects', tag: 'default' }]);
  });

  check('env AGENTGRAPHED_CLAUDE_DIR used when no setting', () => {
    reset();
    process.env.AGENTGRAPHED_CLAUDE_DIR = '/env/claude/projects';
    assert.deepEqual(getSources('claude'), [{ path: '/env/claude/projects', tag: 'default' }]);
  });

  check('legacy setting beats env var', () => {
    reset();
    setSetting('claude_log_dir', '/legacy/wins');
    process.env.AGENTGRAPHED_CLAUDE_DIR = '/env/loses';
    assert.deepEqual(getSources('claude'), [{ path: '/legacy/wins', tag: 'default' }]);
  });

  check('claude_sources JSON takes precedence and preserves order', () => {
    reset();
    setSetting('claude_log_dir', '/legacy/ignored');
    setSetting('claude_sources', JSON.stringify([
      { path: '/a', tag: 'work' },
      { path: '/b', tag: 'home' },
    ]));
    assert.deepEqual(getSources('claude'), [
      { path: '/a', tag: 'work' },
      { path: '/b', tag: 'home' },
    ]);
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log('\nall getSources tests passed');
}

void main();
