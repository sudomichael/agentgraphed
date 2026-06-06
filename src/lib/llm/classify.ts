import { getSqlite } from '../db/client';
import { getLlmConfig, complete } from './client';
import { findModel, estimateLlmCost } from './models';

export const CATEGORIES = [
  'Planning',
  'Debugging',
  'Refactor',
  'Feature',
  'Styling',
  'SEO/Content',
  'DevOps',
  'Data',
  'Payments',
  'Docs',
  'Unknown',
] as const;

export type ClassifyRow = { id: string; first_prompt: string };

// One denser sample per session: up to ~8 user prompts spread evenly across
// the conversation. Lets the model see the planning→building arc instead of
// only the opening prompt.
type SampledRow = {
  id: string;
  prompts: string[];
};

const MAX_SAMPLED_PROMPTS = 8;
const MAX_PROMPT_CHARS = 400;

const SYSTEM_PROMPT = `You categorize AI coding sessions and write short, concrete titles for them.

For each session you receive a list of the user's prompts in order ("prompts": [...]).
The first prompt is the opening goal; later prompts show how the session evolved
(e.g. "let's plan this" → "now add the route" → "fix this bug"). Sessions
often span multiple kinds of work.

Return JSON only:
{
  "results": [
    { "id": "...", "categories": ["Primary", "Secondary?"], "title": "..." }
  ]
}

Categories (pick 1–3, ordered by how much of the session they represent,
most-significant first; only include a label if it materially appears):
- Planning — brainstorming, PRDs, deciding whether to build something, product strategy
- Debugging — fixing bugs, errors, broken things, failing tests
- Refactor — restructuring or renaming existing code without behavior change
- Feature — building or adding new functionality
- Styling — UI, CSS, layout, design, theme
- SEO/Content — SEO, blog content, headlines, meta tags
- DevOps — deploy, CI/CD, env vars, infrastructure, DNS
- Data — databases, schemas, migrations, scraping, ETL
- Payments — Stripe, checkout, billing, invoices, subscriptions
- Docs — README, documentation, changelog
- Unknown — when you genuinely can't tell (prefer this over guessing)

When in doubt, prefer fewer labels. A session that's 90% Feature with a tiny
bug fix at the end is just Feature.

Title rules:
- 4-9 words, past tense ("Added", "Fixed", "Drafted")
- Capture the dominant outcome of the session, not just the opening prompt
- Concrete object ("Stripe checkout reminder" not "payments stuff")
- No quotes, no period
- Keep acronyms (PRD, API, CLI) and proper nouns (Stripe, Drizzle, Next.js) capitalized
- Never repeat a category in the title

Return the JSON only, no prose.`;

function buildBatchPrompt(rows: SampledRow[]): string {
  const payload = {
    sessions: rows.map((r) => ({
      id: r.id,
      prompts: r.prompts.map((p) => p.slice(0, MAX_PROMPT_CHARS)),
    })),
  };
  return `Sessions to classify:\n${JSON.stringify(payload, null, 2)}`;
}

type LlmResult = {
  id: string;
  categories?: string[];
  category?: string;  // legacy shape — models occasionally still emit single string
  title: string;
};

function parseResults(text: string): LlmResult[] {
  // Tolerate code fences and stray prose.
  let body = text.trim();
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) body = fence[1].trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1) return [];
  try {
    const obj = JSON.parse(body.slice(start, end + 1));
    if (Array.isArray(obj?.results)) return obj.results as LlmResult[];
  } catch {
    return [];
  }
  return [];
}

export async function estimateClassifyCost(rowCount: number): Promise<{
  totalUsd: number;
  perSessionUsd: number;
  modelId: string;
  modelLabel: string;
}> {
  const cfg = getLlmConfig();
  if (!cfg) throw new Error('No LLM provider configured');
  const model = findModel(cfg.classifierModel)!;
  // Multi-prompt sampling pushes input ~5x higher than the single-prompt era.
  // Output stays small (compact JSON). Real cost still pennies per 100 sessions.
  const input = rowCount * 600;
  const output = rowCount * 50;
  const total = estimateLlmCost(model, input, output);
  return {
    totalUsd: total,
    perSessionUsd: rowCount === 0 ? 0 : total / rowCount,
    modelId: model.id,
    modelLabel: model.label,
  };
}

// Pull up to MAX_SAMPLED_PROMPTS user prompts spread evenly across the
// session. Always includes the first prompt; if the session has more than
// MAX, we take an even stride through the rest so the model sees the arc.
function sampleSessionPrompts(sessionId: string, firstPrompt: string): string[] {
  const db = getSqlite();
  const rows = db
    .prepare(
      "SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY timestamp ASC",
    )
    .all(sessionId) as { content: string }[];

  if (rows.length === 0) return [firstPrompt];
  if (rows.length <= MAX_SAMPLED_PROMPTS) return rows.map((r) => r.content);

  // Always keep first and last; evenly stride the middle.
  const picks: string[] = [rows[0].content];
  const middleSlots = MAX_SAMPLED_PROMPTS - 2;
  const stride = (rows.length - 2) / (middleSlots + 1);
  for (let i = 1; i <= middleSlots; i++) {
    picks.push(rows[Math.round(i * stride)].content);
  }
  picks.push(rows[rows.length - 1].content);
  return picks;
}

function normalizeResultCategories(r: LlmResult): string[] {
  const raw = r.categories ?? (r.category ? [r.category] : []);
  const valid = raw
    .filter((c): c is string => typeof c === 'string')
    .map((c) => c.trim())
    .filter((c) => CATEGORIES.includes(c as (typeof CATEGORIES)[number]));
  // De-dupe while preserving order (LLM's order = priority).
  return [...new Set(valid)].slice(0, 3);
}

export async function classifyBatch(opts: {
  rows: ClassifyRow[];
  batchSize?: number;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ classified: number; costUsd: number; firstError?: string; batchesFailed: number }> {
  const cfg = getLlmConfig();
  if (!cfg) throw new Error('No LLM provider configured');
  const model = findModel(cfg.classifierModel)!;
  const batchSize = opts.batchSize ?? 20;
  const db = getSqlite();
  // Keep legacy `category` updated to the primary label for backwards-compat
  // with any code path or index still reading the singular column.
  const update = db.prepare(
    'UPDATE sessions SET heuristic_title = ?, category = ?, categories = ? WHERE id = ?',
  );

  let totalCost = 0;
  let classified = 0;
  let firstError: string | undefined;
  let batchesFailed = 0;

  for (let i = 0; i < opts.rows.length; i += batchSize) {
    const batch = opts.rows.slice(i, i + batchSize);
    const sampled: SampledRow[] = batch.map((r) => ({
      id: r.id,
      prompts: sampleSessionPrompts(r.id, r.first_prompt),
    }));
    const userPrompt = buildBatchPrompt(sampled);

    // Token budget scales with how much content we're sending now.
    const approxInputTokens = sampled.reduce(
      (s, r) => s + r.prompts.reduce((a, p) => a + Math.ceil(p.length / 4), 0),
      0,
    );
    const outputBudget = Math.min(3000, Math.max(800, batch.length * 100));

    try {
      const { text, inputTokens, outputTokens } = await complete({
        model: cfg.classifierModel,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        maxTokens: outputBudget,
        responseFormat: 'json',
      });
      void approxInputTokens; // (used only for sizing decisions earlier)
      totalCost += estimateLlmCost(model, inputTokens, outputTokens);
      const results = parseResults(text);

      if (results.length === 0 && text.length > 0) {
        batchesFailed += 1;
        if (!firstError) firstError = `Could not parse model response. First 200 chars: ${text.slice(0, 200)}`;
        continue;
      }

      const tx = db.transaction((rs: LlmResult[]) => {
        for (const r of rs) {
          if (!r.id) continue;
          const cats = normalizeResultCategories(r);
          if (cats.length === 0) continue;
          const title = (r.title || '').trim().replace(/[.\s]+$/, '').slice(0, 120);
          if (!title) continue;
          update.run(title, cats[0], JSON.stringify(cats), r.id);
          classified += 1;
        }
      });
      tx(results);
    } catch (e) {
      batchesFailed += 1;
      const msg = (e as Error).message;
      console.error('classify batch failed', msg);
      if (!firstError) firstError = msg;
    }
    opts.onProgress?.(Math.min(i + batchSize, opts.rows.length), opts.rows.length);
  }

  return { classified, costUsd: totalCost, firstError, batchesFailed };
}

export function getUnclassifiedRows(limit?: number): ClassifyRow[] {
  const db = getSqlite();
  const sql = `SELECT id, first_prompt FROM sessions
    WHERE category IS NULL AND first_prompt IS NOT NULL AND length(first_prompt) > 0
    ORDER BY started_at DESC${limit ? ` LIMIT ${limit}` : ''}`;
  return db.prepare(sql).all() as ClassifyRow[];
}

export function getAllClassifiableRows(limit?: number): ClassifyRow[] {
  const db = getSqlite();
  const sql = `SELECT id, first_prompt FROM sessions
    WHERE first_prompt IS NOT NULL AND length(first_prompt) > 0
    ORDER BY started_at DESC${limit ? ` LIMIT ${limit}` : ''}`;
  return db.prepare(sql).all() as ClassifyRow[];
}
