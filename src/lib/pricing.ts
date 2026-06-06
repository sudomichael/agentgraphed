// Pricing comes from LiteLLM's community-maintained pricing file
// (https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json),
// fetched at build time by scripts/fetch-pricing.mjs and embedded under
// src/lib/pricing-data/litellm.json. If that file is missing we fall back to a
// small hardcoded table so the app still functions offline / pre-build.
//
// LiteLLM stores prices as $/token. We multiply by 1e6 internally so the public
// helper still works in $/M tokens, the unit everyone discusses prices in.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

type LiteLlmEntry = {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_creation_input_token_cost?: number;
  cache_read_input_token_cost?: number;
};

type Price = {
  input: number;          // $/M tokens
  output: number;         // $/M tokens
  cacheRead?: number;     // $/M tokens
  cacheWrite?: number;    // $/M tokens
};

const FALLBACK: Price = { input: 3, output: 15 };

// Last-resort table, used only when the LiteLLM file is unavailable AND the
// model isn't in it (very rare). Kept minimal — LiteLLM covers ~2700 models.
const HARDCODED: Record<string, Price> = {
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'claude-3-5-sonnet': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'gpt-5.1': { input: 1.25, output: 10, cacheRead: 0.125 },
  'gpt-5': { input: 1.25, output: 10, cacheRead: 0.125 },
  'gpt-5-mini': { input: 0.25, output: 2, cacheRead: 0.025 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

// Build absolute path to embedded LiteLLM file at module load time.
function loadLiteLlmTable(): Record<string, LiteLlmEntry> {
  try {
    // tsx + Next.js: both expose __dirname for the compiled file.
    const here = typeof __dirname !== 'undefined'
      ? __dirname
      : dirname(fileURLToPath(import.meta.url));
    const candidates = [
      join(here, 'pricing-data', 'litellm.json'),
      join(process.cwd(), 'src', 'lib', 'pricing-data', 'litellm.json'),
    ];
    for (const p of candidates) {
      if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
    }
  } catch {
    // fall through
  }
  return {};
}

let _liteLlm: Record<string, LiteLlmEntry> | null = null;
function liteLlm(): Record<string, LiteLlmEntry> {
  if (_liteLlm !== null) return _liteLlm;
  _liteLlm = loadLiteLlmTable();
  return _liteLlm;
}

let _meta: { fetchedAt: string; modelCount: number } | null | undefined;
function liteLlmMeta() {
  if (_meta !== undefined) return _meta;
  try {
    const here = typeof __dirname !== 'undefined'
      ? __dirname
      : dirname(fileURLToPath(import.meta.url));
    const p = join(here, 'pricing-data', 'litellm.meta.json');
    _meta = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
  } catch {
    _meta = null;
  }
  return _meta;
}

export function pricesLastUpdated(): string {
  const m = liteLlmMeta();
  if (m?.fetchedAt) return m.fetchedAt.slice(0, 10);
  return '2026-06-05';
}

// Public, kept for backwards compat with components that import it directly.
export const PRICES_LAST_UPDATED = pricesLastUpdated();

// LiteLLM dated alias suffix is exactly 8 digits (YYYYMMDD) per their format.
// Strip it so a versioned id falls back to its undated family entry.
function stripDateSuffix(id: string): string {
  return id.replace(/-(\d{8})$/, '');
}

function fromLiteLlm(entry: LiteLlmEntry): Price | null {
  const input = entry.input_cost_per_token;
  const output = entry.output_cost_per_token;
  if (input == null || output == null) return null;
  return {
    input: input * 1_000_000,
    output: output * 1_000_000,
    cacheRead: entry.cache_read_input_token_cost != null
      ? entry.cache_read_input_token_cost * 1_000_000
      : undefined,
    cacheWrite: entry.cache_creation_input_token_cost != null
      ? entry.cache_creation_input_token_cost * 1_000_000
      : undefined,
  };
}

function lookup(model: string | null | undefined): Price {
  if (!model) return FALLBACK;
  const table = liteLlm();

  // 1) Exact match in LiteLLM
  const direct = table[model];
  if (direct) {
    const p = fromLiteLlm(direct);
    if (p) return p;
  }

  // 2) Strip date suffix and retry LiteLLM
  const undated = stripDateSuffix(model);
  if (undated !== model && table[undated]) {
    const p = fromLiteLlm(table[undated]);
    if (p) return p;
  }

  // 3) Hardcoded exact
  if (HARDCODED[model]) return HARDCODED[model];

  // 4) Hardcoded prefix match (handles "claude-opus-4-7" → "claude-opus-4-7")
  const prefixKey = Object.keys(HARDCODED).find((k) => model.startsWith(k));
  if (prefixKey) return HARDCODED[prefixKey];

  // 5) LiteLLM prefix match — last resort
  const litePrefix = Object.keys(table).find((k) => model.startsWith(k));
  if (litePrefix) {
    const p = fromLiteLlm(table[litePrefix]);
    if (p) return p;
  }

  return FALLBACK;
}

export function estimateCost(opts: {
  model: string | null | undefined;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): number {
  const p = lookup(opts.model);
  const cr = opts.cacheReadTokens ?? 0;
  const cw = opts.cacheWriteTokens ?? 0;
  return (
    (opts.inputTokens * p.input) / 1_000_000 +
    (opts.outputTokens * p.output) / 1_000_000 +
    (cr * (p.cacheRead ?? p.input)) / 1_000_000 +
    (cw * (p.cacheWrite ?? p.input)) / 1_000_000
  );
}

// Collapse model versions into a friendly family label for display.
// We keep the raw model_id in the DB; this is purely cosmetic.
//   claude-opus-4-7              → "Claude Opus 4"
//   claude-sonnet-4-6            → "Claude Sonnet 4"
//   claude-3-5-sonnet            → "Claude Sonnet 3.5"
//   claude-haiku-4-5-20251001    → "Claude Haiku 4"
//   gpt-5.1-codex-max            → "GPT-5"
//   gpt-4o-mini                  → "GPT-4o Mini"
//   gpt-5-mini                   → "GPT-5 Mini"
export function normalizeModelName(model: string | null | undefined): string {
  if (!model) return 'Unknown';
  const m = model.toLowerCase();

  // Anthropic — "claude-{family}-{major}[-minor][-dated suffix]"
  const claude = m.match(/^claude-(?:(\d+(?:-\d+)?)-)?(opus|sonnet|haiku)-?(\d+)?/);
  if (claude) {
    const familyCap = claude[2].charAt(0).toUpperCase() + claude[2].slice(1);
    if (claude[1]) {
      const ver = claude[1].replace('-', '.');
      return `Claude ${familyCap} ${ver}`;
    }
    if (claude[3]) return `Claude ${familyCap} ${claude[3]}`;
    return `Claude ${familyCap}`;
  }

  // GPT-4o family (must be checked before the generic gpt-N regex below,
  // which would consume only the "4" from "4o").
  if (m.startsWith('gpt-4o')) {
    return m.includes('mini') ? 'GPT-4o Mini' : 'GPT-4o';
  }
  // OpenAI / GPT — keep "mini" qualifier, drop dated/variant suffixes.
  const gpt = m.match(/^gpt-(\d+(?:\.\d+)?)(?:-(mini|nano|turbo))?/);
  if (gpt) {
    const base = `GPT-${gpt[1]}`;
    if (gpt[2]) return `${base} ${gpt[2].charAt(0).toUpperCase() + gpt[2].slice(1)}`;
    return base;
  }

  return model;
}
