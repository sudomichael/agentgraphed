#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const MARKER = 'agentgraphed-capture';
const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

if (!fs.existsSync(settingsPath)) {
  console.log('Nothing to remove (no ~/.claude/settings.json).');
  process.exit(0);
}

let s;
try {
  s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
} catch (e) {
  console.error(`× could not parse settings: ${e.message}`);
  process.exit(1);
}

if (!s.hooks?.SessionEnd) {
  console.log('No SessionEnd hooks configured. Nothing to remove.');
  process.exit(0);
}

const before = JSON.stringify(s.hooks.SessionEnd);
s.hooks.SessionEnd = s.hooks.SessionEnd
  .map((group) => {
    if (!group || !Array.isArray(group.hooks)) return group;
    const kept = group.hooks.filter(
      (h) => !(h && typeof h.command === 'string' && h.command.includes(MARKER)),
    );
    if (kept.length === 0) return null;
    return { ...group, hooks: kept };
  })
  .filter(Boolean);

if (s.hooks.SessionEnd.length === 0) delete s.hooks.SessionEnd;
if (Object.keys(s.hooks).length === 0) delete s.hooks;

const after = JSON.stringify(s.hooks?.SessionEnd ?? []);
if (before === after) {
  console.log('AgentGraphed hook not found. Nothing to remove.');
  process.exit(0);
}

fs.copyFileSync(settingsPath, `${settingsPath}.agentgraphed.bak`);
fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2) + '\n', 'utf8');
console.log('✓ AgentGraphed capture hook removed.');
console.log(`  backup: ${settingsPath}.agentgraphed.bak`);
