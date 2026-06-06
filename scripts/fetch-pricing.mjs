#!/usr/bin/env node
// Fetch LiteLLM's model pricing file and embed it in the build.
// Runs at install/build time. Falls back silently if offline; the runtime
// pricing module will use its hardcoded table when this file is missing.
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'src', 'lib', 'pricing-data');
const OUT_FILE = join(OUT_DIR, 'litellm.json');
const META_FILE = join(OUT_DIR, 'litellm.meta.json');
const URL = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

mkdirSync(OUT_DIR, { recursive: true });

// Skip if file is fresh (< 7 days old).
if (existsSync(OUT_FILE) && existsSync(META_FILE)) {
  try {
    const meta = JSON.parse(readFileSync(META_FILE, 'utf8'));
    const ageMs = Date.now() - new Date(meta.fetchedAt).getTime();
    if (ageMs < 7 * 24 * 60 * 60 * 1000) {
      console.log(`[pricing] cached LiteLLM data is ${Math.floor(ageMs / 86_400_000)}d old, skipping fetch`);
      process.exit(0);
    }
  } catch {
    // metadata corrupt — refetch
  }
}

try {
  console.log(`[pricing] fetching ${URL}`);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  const res = await fetch(URL, { signal: ctrl.signal });
  clearTimeout(t);
  if (!res.ok) throw new Error(`http ${res.status}`);
  const json = await res.text();
  // Sanity: must be valid JSON and contain at least one known model
  const parsed = JSON.parse(json);
  if (!parsed['claude-haiku-4-5']) throw new Error('LiteLLM payload missing expected models');
  writeFileSync(OUT_FILE, json, 'utf8');
  writeFileSync(
    META_FILE,
    JSON.stringify({ fetchedAt: new Date().toISOString(), modelCount: Object.keys(parsed).length }, null, 2),
    'utf8',
  );
  console.log(`[pricing] wrote ${Object.keys(parsed).length} models to ${OUT_FILE}`);
} catch (err) {
  console.warn(`[pricing] fetch failed (${err?.message ?? err}); runtime will use hardcoded fallback`);
  // Don't fail the build — the runtime pricing module handles a missing file.
  process.exit(0);
}
