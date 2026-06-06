#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
// agentgraphed onboard <endpoint> <token>
//
// Idempotently patches ~/.claude/settings.json (and ~/.codex/config.toml when
// supported) to add a SessionEnd hook that POSTs the session transcript to a
// remote AgentGraphed instance. Safe to re-run.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function usage() {
  console.log(`usage: agentgraphed onboard <endpoint> <token>

  endpoint   Base URL of the AgentGraphed instance, e.g. https://team.example.com
  token      Ingest token (visible at <endpoint>/api/ingest via GET when local)

This will edit:
  ~/.claude/settings.json   (adds a SessionEnd hook)

Existing hooks are preserved. Re-running replaces the AgentGraphed entry only.`);
  process.exit(1);
}

// argv could be either:
//   node bin/onboard.js <url> <token>                        (direct)
//   node bin/agentgraphed.js onboard <url> <token>           (subcommand)
// We accept whichever form is in use.
const argv = process.argv.slice(2);
const startIdx = argv[0] === 'onboard' ? 1 : 0;
const endpointArg = argv[startIdx];
const tokenArg = argv[startIdx + 1];
if (!endpointArg || !tokenArg) usage();
const endpoint = endpointArg.replace(/\/+$/, '');
const token = tokenArg.trim();

const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');

// The marker string lets us find and replace our hook on re-onboard without
// trampling unrelated hooks the user might have configured.
const MARKER = 'agentgraphed-capture';

// Hook command: read JSON event from stdin (Claude pipes it), pull session_id
// and cwd, locate the transcript JSONL, POST it. Self-contained shell so it
// works without any agentgraphed binary on PATH. Sequenced with ';' (not &&)
// so a no-op early-return doesn't kill the chain. ': # marker' lets the script
// carry a comment Claude's settings.json can keep around.
function buildHookCommand() {
  // Single-line python -c (newlines inside the script would be interpreted as
  // shell statement separators after the JSON command is joined with ';').
  const py = `/usr/bin/python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get(sys.argv[1],""))'`;
  // We carry the marker in an env var assignment instead of a '#' comment,
  // because '#...; cmd' makes the rest of the line a comment and swallows
  // the entire chain. The var is unused at runtime but findable in settings.
  return [
    `AGENTGRAPHED_MARKER="${MARKER}"`,
    'AG_EVT=$(cat)',
    `AG_SID=$(printf "%s" "$AG_EVT" | ${py} session_id 2>/dev/null)`,
    `AG_CWD=$(printf "%s" "$AG_EVT" | ${py} cwd 2>/dev/null)`,
    'if [ -z "$AG_SID" ]; then exit 0; fi',
    'AG_ENC=$(printf "%s" "$AG_CWD" | /usr/bin/sed "s|/|-|g")',
    'AG_FILE="$HOME/.claude/projects/$AG_ENC/$AG_SID.jsonl"',
    'if [ ! -f "$AG_FILE" ]; then exit 0; fi',
    `/usr/bin/curl -sS --max-time 15 -X POST "${endpoint}/api/ingest" ` +
      `-H "x-ingest-token: ${token}" ` +
      '-H "x-provider: claude" ' +
      '-H "x-session-id: $AG_SID" ' +
      '-H "x-cwd: $AG_CWD" ' +
      '-H "x-user: $USER" ' +
      '-H "x-host: $(hostname -s)" ' +
      '-H "content-type: application/x-ndjson" ' +
      '--data-binary "@$AG_FILE" >/dev/null 2>&1 || true',
  ].join('; ');
}

function readSettings() {
  if (!fs.existsSync(claudeSettingsPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf8'));
  } catch (e) {
    console.error(`× could not parse ${claudeSettingsPath}: ${e.message}`);
    console.error('  fix or remove the file and re-run.');
    process.exit(1);
  }
}

function writeSettings(obj) {
  const dir = path.dirname(claudeSettingsPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(claudeSettingsPath)) {
    fs.copyFileSync(claudeSettingsPath, `${claudeSettingsPath}.agentgraphed.bak`);
  }
  fs.writeFileSync(claudeSettingsPath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

const settings = readSettings();
settings.hooks = settings.hooks || {};
const existing = Array.isArray(settings.hooks.SessionEnd) ? settings.hooks.SessionEnd : [];

// Strip any prior AgentGraphed entry (so re-onboard updates endpoint/token cleanly).
const filtered = existing
  .map((group) => {
    if (!group || !Array.isArray(group.hooks)) return group;
    const kept = group.hooks.filter(
      (h) => !(h && typeof h.command === 'string' && h.command.includes(MARKER)),
    );
    if (kept.length === 0) return null;
    return { ...group, hooks: kept };
  })
  .filter(Boolean);

filtered.push({
  hooks: [
    {
      type: 'command',
      command: buildHookCommand(),
      timeout: 30,
    },
  ],
});
settings.hooks.SessionEnd = filtered;
writeSettings(settings);

console.log('✓ AgentGraphed capture hook installed');
console.log(`  config:   ${claudeSettingsPath}`);
console.log(`  backup:   ${claudeSettingsPath}.agentgraphed.bak`);
console.log(`  endpoint: ${endpoint}/api/ingest`);
console.log('');
console.log('Test it: run a Claude Code session, exit, then check the dashboard.');
console.log('Remove:  agentgraphed offboard');
