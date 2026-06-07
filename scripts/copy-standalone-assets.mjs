#!/usr/bin/env node
// Next.js standalone mode emits a self-contained server at
// .next/standalone/server.js, but it expects static assets to live at
// .next/standalone/.next/static and .next/standalone/public. Next doesn't
// copy them itself — that's our job. Run this after `next build`.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const standalone = join(ROOT, '.next', 'standalone');

if (!existsSync(standalone)) {
  console.error('[standalone-assets] .next/standalone not found — did `next build` run with output:"standalone"?');
  process.exit(1);
}

// .next/static
const src = join(ROOT, '.next', 'static');
const dst = join(standalone, '.next', 'static');
if (existsSync(src)) {
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true });
  console.log(`[standalone-assets] copied .next/static → ${dst}`);
}

// public/ (only if it exists; we don't have any static files yet)
const publicSrc = join(ROOT, 'public');
if (existsSync(publicSrc)) {
  cpSync(publicSrc, join(standalone, 'public'), { recursive: true });
  console.log('[standalone-assets] copied public/');
}

// The standalone bundle doesn't include the LiteLLM pricing data because we
// load it via fs.readFileSync at runtime. Copy it alongside the server so the
// pricing module's fallback path can find it.
const pricingSrc = join(ROOT, 'src', 'lib', 'pricing-data');
if (existsSync(pricingSrc)) {
  cpSync(pricingSrc, join(standalone, 'src', 'lib', 'pricing-data'), { recursive: true });
  console.log('[standalone-assets] copied pricing-data');
}

// Next.js tracing pulls some packages into the standalone bundle that are
// dev-only or only needed by Next features we don't use. Drop them to keep
// the published npm tarball lean — saves ~13 MB on disk for users of `npx
// agentgraphed`. Wrapped in try/catch so a missing path on a future Next
// version doesn't break the build.
const prunePaths = [
  // TypeScript ships ~9 MB but is never loaded at runtime by the standalone
  // server — it's only needed if you import .ts files directly, which a
  // built bundle does not.
  'node_modules/typescript',
  // AMP validator is only used by Next's AMP pages, which AgentGraphed does
  // not use.
  'node_modules/next/dist/compiled/amphtml-validator',
];
for (const rel of prunePaths) {
  const abs = join(standalone, rel);
  if (!existsSync(abs)) continue;
  const sizeMb = (dirSize(abs) / (1024 * 1024)).toFixed(1);
  rmSync(abs, { recursive: true, force: true });
  console.log(`[standalone-assets] pruned ${rel} (~${sizeMb} MB)`);
}

function dirSize(p) {
  let total = 0;
  const stack = [p];
  while (stack.length) {
    const cur = stack.pop();
    const s = statSync(cur);
    if (s.isDirectory()) {
      for (const e of readdirSync(cur)) stack.push(join(cur, e));
    } else {
      total += s.size;
    }
  }
  return total;
}
