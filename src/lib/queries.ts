import { getSqlite } from './db/client';
import { dayKey } from './format';
import { normalizeModelName, estimateCost } from './pricing';
import { sessionCategories as _sessionCategories } from './sessionDisplay';
import { ttlMemo } from './cache';

// 5-second TTL keeps fast click-around feeling instant while staying short
// enough that auto-ingest results land on the very next interaction after the
// scan completes. Pure heuristic; tune if needed.
const READ_TTL_MS = 5_000;

export type SessionRow = {
  id: string;
  provider: string;
  project_id: string;
  project_name: string;
  cwd: string;
  started_at: number;
  ended_at: number;
  duration_ms: number;
  model: string | null;
  message_count: number;
  user_message_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  est_cost_usd: number;
  first_prompt: string | null;
  summary: string | null;
  heuristic_title: string | null;
  category: string | null;
  categories: string | null;  // JSON array as text; use sessionCategories() to parse
  keywords: string | null;
  git_branch: string | null;
};

const SESSION_FIELDS = `
  s.id, s.provider, s.project_id, p.name AS project_name, s.cwd,
  s.started_at, s.ended_at, s.duration_ms, s.model,
  s.message_count, s.user_message_count,
  s.input_tokens, s.output_tokens, s.cache_read_tokens, s.cache_write_tokens,
  s.est_cost_usd, s.first_prompt, s.summary,
  s.heuristic_title, s.category, s.categories, s.keywords,
  s.git_branch
`;

export const sessionCategories = _sessionCategories;

export function todayBounds(): { start: number; end: number } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return { start, end: start + 24 * 60 * 60 * 1000 };
}

// "Today" = any session that was active today (started today OR ended today OR spans today).
// Translates to: started_at < end_of_day AND ended_at >= start_of_day.
export function getTodaySessions(projectId?: string | null, modelFamily?: string | null): SessionRow[] {
  const { start, end } = todayBounds();
  const projClause = projectId ? ' AND s.project_id = ?' : '';
  const projParam: unknown[] = projectId ? [projectId] : [];
  const mc = modelClause(modelFamily ?? null, 's');
  return getSqlite()
    .prepare(
      `SELECT ${SESSION_FIELDS} FROM sessions s JOIN projects p ON p.id = s.project_id
       WHERE s.started_at < ? AND s.ended_at >= ?${projClause}${mc.sql} ORDER BY s.started_at DESC`,
    )
    .all(end, start, ...projParam, ...mc.params) as SessionRow[];
}

export function getTodaySummary() {
  const { start, end } = todayBounds();
  const row = getSqlite()
    .prepare(
      `SELECT
         COUNT(*) AS sessions,
         COUNT(DISTINCT project_id) AS projects,
         COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0) AS tokens,
         COALESCE(SUM(est_cost_usd), 0) AS cost
       FROM sessions WHERE started_at < ? AND ended_at >= ?`,
    )
    .get(end, start) as { sessions: number; projects: number; tokens: number; cost: number };
  return row;
}

export type SessionDayRole = 'single' | 'started' | 'continued' | 'closed';

export type TimelineEntry = {
  session: SessionRow;
  role: SessionDayRole;
  spanDays: number;
};

export type DayGroup = {
  day: string;
  dayMs: number;
  entries: TimelineEntry[];
  totalTokens: number;
  totalCost: number;
  providers: Record<string, number>;
};

// Local midnight ms for a given timestamp.
function startOfDayMs(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function getTimeline(opts: {
  limit?: number;
  before?: number;
  projectId?: string;
  provider?: string;
  search?: string;
} = {}): DayGroup[] {
  const limit = opts.limit ?? 60;
  const before = opts.before ?? Date.now() + 1;

  const where: string[] = ['s.started_at < ?'];
  const params: unknown[] = [before];
  if (opts.projectId) { where.push('s.project_id = ?'); params.push(opts.projectId); }
  if (opts.provider)  { where.push('s.provider = ?');   params.push(opts.provider); }
  if (opts.search) {
    where.push('(s.first_prompt LIKE ? OR s.summary LIKE ?)');
    const q = `%${opts.search}%`;
    params.push(q, q);
  }

  const rows = getSqlite()
    .prepare(
      `SELECT ${SESSION_FIELDS} FROM sessions s JOIN projects p ON p.id = s.project_id
       WHERE ${where.join(' AND ')}
       ORDER BY s.started_at DESC LIMIT ?`,
    )
    .all(...params, limit) as SessionRow[];

  const groups = new Map<string, DayGroup>();
  const getOrCreate = (dayMsLocal: number): DayGroup => {
    const key = dayKey(dayMsLocal);
    let g = groups.get(key);
    if (!g) {
      g = { day: key, dayMs: dayMsLocal, entries: [], totalTokens: 0, totalCost: 0, providers: {} };
      groups.set(key, g);
    }
    return g;
  };

  const DAY = 86_400_000;
  for (const s of rows) {
    const startDay = startOfDayMs(s.started_at);
    const endDay = startOfDayMs(s.ended_at);
    const spanDays = Math.max(1, Math.round((endDay - startDay) / DAY) + 1);
    const sessionTokens = s.input_tokens + s.output_tokens + s.cache_read_tokens + s.cache_write_tokens;

    if (startDay === endDay) {
      const g = getOrCreate(startDay);
      g.entries.push({ session: s, role: 'single', spanDays: 1 });
      g.totalTokens += sessionTokens;
      g.totalCost += s.est_cost_usd;
      g.providers[s.provider] = (g.providers[s.provider] || 0) + 1;
      continue;
    }

    for (let d = startDay; d <= endDay; d += DAY) {
      const g = getOrCreate(d);
      const role: SessionDayRole =
        d === startDay ? 'started' : d === endDay ? 'closed' : 'continued';
      g.entries.push({ session: s, role, spanDays });
      // Attribute tokens/cost only to the day the session closed — avoids
      // multiplying a multi-day session across N day totals.
      if (role === 'closed') {
        g.totalTokens += sessionTokens;
        g.totalCost += s.est_cost_usd;
        g.providers[s.provider] = (g.providers[s.provider] || 0) + 1;
      }
    }
  }

  // Within each day, show sessions in chronological-of-day order (newest first
  // by the session's started_at, same as before).
  for (const g of groups.values()) {
    g.entries.sort((a, b) => b.session.started_at - a.session.started_at);
  }
  return [...groups.values()].sort((a, b) => b.dayMs - a.dayMs);
}

export type ProjectRow = {
  id: string;
  name: string;
  root_path: string;
  git_remote: string | null;
  first_seen: number;
  last_active: number;
  sessions: number;
  tokens: number;
  cost: number;
};

export function getProjects(): ProjectRow[] {
  return ttlMemo('getProjects', READ_TTL_MS, () =>
    getSqlite()
      .prepare(
        `SELECT p.id, p.name, p.root_path, p.git_remote, p.first_seen, p.last_active,
                COUNT(s.id) AS sessions,
                COALESCE(SUM(s.input_tokens + s.output_tokens + s.cache_read_tokens + s.cache_write_tokens), 0) AS tokens,
                COALESCE(SUM(s.est_cost_usd), 0) AS cost
         FROM projects p LEFT JOIN sessions s ON s.project_id = p.id
         GROUP BY p.id ORDER BY p.last_active DESC`,
      )
      .all() as ProjectRow[],
  );
}

export function getProject(id: string): ProjectRow | null {
  const row = getSqlite()
    .prepare(
      `SELECT p.id, p.name, p.root_path, p.git_remote, p.first_seen, p.last_active,
              COUNT(s.id) AS sessions,
              COALESCE(SUM(s.input_tokens + s.output_tokens + s.cache_read_tokens + s.cache_write_tokens), 0) AS tokens,
              COALESCE(SUM(s.est_cost_usd), 0) AS cost
       FROM projects p LEFT JOIN sessions s ON s.project_id = p.id
       WHERE p.id = ? GROUP BY p.id`,
    )
    .get(id) as ProjectRow | undefined;
  return row ?? null;
}

export function getSessionsForProject(projectId: string, limit = 100): SessionRow[] {
  return getSqlite()
    .prepare(
      `SELECT ${SESSION_FIELDS} FROM sessions s JOIN projects p ON p.id = s.project_id
       WHERE s.project_id = ? ORDER BY s.started_at DESC LIMIT ?`,
    )
    .all(projectId, limit) as SessionRow[];
}

export function getSession(id: string): SessionRow | null {
  return (
    (getSqlite()
      .prepare(
        `SELECT ${SESSION_FIELDS} FROM sessions s JOIN projects p ON p.id = s.project_id WHERE s.id = ?`,
      )
      .get(id) as SessionRow | undefined) ?? null
  );
}

// Per-session content-source breakdown. Aggregates rows from the tool_io
// table into the buckets the session-detail card renders: tool result text
// (the big input contributor), tool call arguments (output), Claude's text
// replies (output), and user prompts (input). Returns [] if the session
// pre-dates the v4 schema and was never re-ingested with breakdown data.
export type SessionTokenBreakdownRow = {
  kind: 'user_text' | 'assistant_text' | 'tool_use' | 'tool_result';
  source: string | null;
  bytes: number;
  est_tokens: number;
  items: number;
};
export function getSessionTokenBreakdown(sessionId: string): SessionTokenBreakdownRow[] {
  return getSqlite()
    .prepare(
      `SELECT kind, source,
              SUM(bytes) AS bytes,
              SUM(est_tokens) AS est_tokens,
              COUNT(*) AS items
       FROM tool_io WHERE session_id = ?
       GROUP BY kind, source
       ORDER BY est_tokens DESC`,
    )
    .all(sessionId) as SessionTokenBreakdownRow[];
}

// Pro-rated cost-aware breakdown. Each tool_io row carries a literal byte
// count of unique content. We attribute the *session's* actual est_cost_usd
// to those rows by share of bytes — input-side cost split among
// tool_result/user_text rows weighted by bytes, output-side cost split among
// tool_use/assistant_text rows weighted by bytes. That way the sum of
// per-source costs equals the session's headline cost: nothing made up,
// nothing left over. The big asymmetry between "what bytes flowed" vs "what
// was billed" (cache replay multiplying input tokens 50-100x on long
// sessions) is *already inside* est_cost_usd, so when we pro-rate it we
// implicitly distribute the cache-replay cost across the same sources that
// caused the cacheable content in the first place. Honest tradeoff: we
// assume each byte of a given kind contributed equally to that kind's cost,
// which understates the cost of content that happened to land in fresh
// input vs cache_read. That's the limit of what we can know without
// per-item billing data.
export type TokenBreakdownRow = SessionTokenBreakdownRow & {
  est_cost_usd: number;
};

export type TokenBreakdownSummary = {
  rows: TokenBreakdownRow[];
  // Headline-friendly totals computed from sessions, NOT from tool_io.
  // billed_tokens = input + output + cache_read + cache_write across sessions
  // in the window — matches the metric card. unique_bytes is the literal
  // sum of tool_io bytes (no multiplication for cache replay). The ratio
  // is the punchline of the "why don't these numbers match" question:
  // most billed input is cache replay of the same unique content.
  billed_tokens: number;
  unique_bytes: number;
  total_cost_usd: number;
  // Subdivide billed_tokens so the UI can show the cache mix that costs
  // dollars: fresh input, cache_creation (premium), cache_read (cheap),
  // output. The user's lever to reduce cost is mostly moving fresh-input
  // share down by keeping conversation context stable.
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};

// Time-series version of getTokenBreakdown: returns one bucket per time
// unit (same hourly-vs-daily granularity rule as getDailySeries) with one
// numeric field per source. Pre-stacked so Recharts can render it as N
// stacked Area/Bar series. Same pro-rating rules as getTokenBreakdown so
// the per-bucket SUM(over sources) lines up with the dashboard's existing
// cost series. `sources` is the resolved column list ranked by total cost
// in the window — top 6 source labels + an "other" bucket so chart legends
// stay readable.
export type TokenBreakdownPoint = { day: string } & Record<string, number | string>;
export type TokenBreakdownSeries = {
  buckets: TokenBreakdownPoint[];
  sources: string[]; // ordered: top by total cost, then "other"
};
export function getTokenBreakdownSeries(
  days: number | null = 30,
  projectId?: string | null,
  modelFamily?: string | null,
): TokenBreakdownSeries {
  return ttlMemo(
    `getTokenBreakdownSeries:${days ?? 'all'}:${projectId ?? ''}:${modelFamily ?? ''}`,
    READ_TTL_MS,
    () => _getTokenBreakdownSeries(days, projectId ?? null, modelFamily ?? null),
  );
}

function _getTokenBreakdownSeries(
  days: number | null,
  projectId: string | null,
  modelFamily: string | null,
): TokenBreakdownSeries {
  const db = getSqlite();
  const conds: string[] = [];
  const params: unknown[] = [];
  if (days !== null) {
    conds.push('t.timestamp >= ?');
    params.push(Date.now() - days * 86_400_000);
  }
  if (projectId) {
    conds.push('s.project_id = ?');
    params.push(projectId);
  }
  const mc = modelClause(modelFamily, 's');
  const baseWhere = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  const where = mc.sql
    ? (baseWhere ? `${baseWhere}${mc.sql}` : `WHERE 1=1${mc.sql}`)
    : baseWhere;

  // Per-session in-window byte totals for pro-rating. Same approach as the
  // headline query — pro-rated cost per byte equals in_cost / in_bytes_total
  // (or out_cost / out_bytes_total).
  const tWindowCond = days !== null ? 't.timestamp >= ?' : '1=1';
  const tWindowParam = days !== null ? [Date.now() - days * 86_400_000] : [];

  type Row = {
    timestamp: number;
    session_id: string;
    kind: SessionTokenBreakdownRow['kind'];
    source: string | null;
    bytes: number;
    s_input_tokens: number;
    s_output_tokens: number;
    s_cache_read_tokens: number;
    s_cache_write_tokens: number;
    s_model: string | null;
    s_in_bytes_total: number;
    s_out_bytes_total: number;
  };
  const rows = db
    .prepare(
      `WITH session_bytes_in_window AS (
         SELECT t.session_id,
                SUM(CASE WHEN t.kind IN ('tool_result','user_text') THEN t.bytes ELSE 0 END) AS in_bytes,
                SUM(CASE WHEN t.kind IN ('tool_use','assistant_text') THEN t.bytes ELSE 0 END) AS out_bytes
         FROM tool_io t
         WHERE ${tWindowCond}
         GROUP BY t.session_id
       )
       SELECT t.timestamp, t.session_id, t.kind, t.source, t.bytes,
              s.input_tokens AS s_input_tokens,
              s.output_tokens AS s_output_tokens,
              s.cache_read_tokens AS s_cache_read_tokens,
              s.cache_write_tokens AS s_cache_write_tokens,
              s.model AS s_model,
              sb.in_bytes AS s_in_bytes_total,
              sb.out_bytes AS s_out_bytes_total
       FROM tool_io t
         JOIN sessions s ON s.id = t.session_id
         JOIN session_bytes_in_window sb ON sb.session_id = t.session_id
       ${where}`,
    )
    .all(...tWindowParam, ...params, ...mc.params) as Row[];

  if (rows.length === 0) return { buckets: [], sources: [] };

  // Same bucketing as getDailySeries: hourly for days < 2, daily otherwise.
  const hourly = days !== null && days < 2;
  const bucketMs = hourly ? 3_600_000 : 86_400_000;
  const now = Date.now();
  let since: number;
  let bucketCount: number;
  if (days === null) {
    const earliest = Math.min(...rows.map((r) => r.timestamp));
    since = earliest;
    bucketCount = Math.max(1, Math.ceil((now - since) / bucketMs) + 1);
  } else {
    since = now - days * 86_400_000;
    bucketCount = Math.ceil((days * 86_400_000) / bucketMs) + 1;
  }

  const bucketKeyOf = (ms: number): string => {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    if (!hourly) return `${y}-${m}-${day}`;
    const h = String(d.getHours()).padStart(2, '0');
    return `${y}-${m}-${day} ${h}:00`;
  };

  // Pre-seed empty buckets so the chart shows continuous time even if a
  // source has zero spend in a bucket.
  const buckets = new Map<string, TokenBreakdownPoint>();
  for (let i = 0; i < bucketCount; i++) {
    const d = new Date();
    if (hourly) d.setHours(d.getHours() - i, 0, 0, 0);
    else { d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0); }
    const k = bucketKeyOf(d.getTime());
    buckets.set(k, { day: k });
  }

  const sourceLabel = (kind: SessionTokenBreakdownRow['kind'], source: string | null): string => {
    if (kind === 'user_text') return 'Your prompts';
    if (kind === 'assistant_text') return 'Claude reply';
    const name = source ?? 'unknown';
    if (name.startsWith('mcp__')) {
      const parts = name.slice(5).split('__');
      if (parts.length >= 2) return `${parts[0]} · ${parts.slice(1).join('__')}`;
      return parts.join('__');
    }
    // For tool_use the same name as tool_result; collapse so legend stays short
    return name;
  };

  // First pass: compute per-source totals to pick top-N for the legend.
  const sourceTotals = new Map<string, number>();
  const perBucketContribs: Array<{ k: string; label: string; cost: number }> = [];
  for (const r of rows) {
    const k = bucketKeyOf(r.timestamp);
    if (!buckets.has(k)) continue;
    const inCost = estimateCost({
      model: r.s_model,
      inputTokens: r.s_input_tokens,
      outputTokens: 0,
      cacheReadTokens: r.s_cache_read_tokens,
      cacheWriteTokens: r.s_cache_write_tokens,
    });
    const outCost = estimateCost({
      model: r.s_model,
      inputTokens: 0,
      outputTokens: r.s_output_tokens,
    });
    let cost = 0;
    if (r.kind === 'tool_result' || r.kind === 'user_text') {
      cost = r.s_in_bytes_total > 0 ? (r.bytes / r.s_in_bytes_total) * inCost : 0;
    } else {
      cost = r.s_out_bytes_total > 0 ? (r.bytes / r.s_out_bytes_total) * outCost : 0;
    }
    const label = sourceLabel(r.kind, r.source);
    sourceTotals.set(label, (sourceTotals.get(label) || 0) + cost);
    perBucketContribs.push({ k, label, cost });
  }

  // Top 6 sources by total cost; rest collapse into "other".
  const TOP = 6;
  const ranked = [...sourceTotals.entries()].sort((a, b) => b[1] - a[1]);
  const topSources = new Set(ranked.slice(0, TOP).map(([s]) => s));
  const orderedSources = ranked.slice(0, TOP).map(([s]) => s);
  const hasOther = ranked.length > TOP;
  if (hasOther) orderedSources.push('other');

  // Initialize bucket fields so Recharts gets a proper stacked render.
  for (const b of buckets.values()) {
    for (const s of orderedSources) b[s] = 0;
  }

  // Second pass: deposit each contribution into its bucket+source column.
  for (const c of perBucketContribs) {
    const bucket = buckets.get(c.k);
    if (!bucket) continue;
    const col = topSources.has(c.label) ? c.label : 'other';
    if (!hasOther && col === 'other') continue;
    bucket[col] = ((bucket[col] as number) || 0) + c.cost;
  }

  return {
    buckets: [...buckets.values()].sort((a, b) => String(a.day).localeCompare(String(b.day))),
    sources: orderedSources,
  };
}

export function getTokenBreakdown(
  days: number | null = 30,
  projectId?: string | null,
  modelFamily?: string | null,
): TokenBreakdownSummary {
  return ttlMemo(
    `getTokenBreakdown:${days ?? 'all'}:${projectId ?? ''}:${modelFamily ?? ''}`,
    READ_TTL_MS,
    () => _getTokenBreakdown(days, projectId ?? null, modelFamily ?? null),
  );
}

function _getTokenBreakdown(
  days: number | null,
  projectId: string | null,
  modelFamily: string | null,
): TokenBreakdownSummary {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (days !== null) {
    conds.push('t.timestamp >= ?');
    params.push(Date.now() - days * 86_400_000);
  }
  if (projectId) {
    conds.push('s.project_id = ?');
    params.push(projectId);
  }
  const mc = modelClause(modelFamily ?? null, 's');
  const baseWhere = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  const where = mc.sql
    ? (baseWhere ? `${baseWhere}${mc.sql}` : `WHERE 1=1${mc.sql}`)
    : baseWhere;

  const db = getSqlite();

  // Per-session per-(kind,source) breakdown PLUS the session's own
  // input/output cost split. We pro-rate in JS rather than SQL because the
  // ratio depends on dynamic per-row sums.
  //
  // CRITICAL: session_bytes is computed *over the same filtered slice* as
  // the breakdown rows, not over all of the session's tool_io rows. That
  // way every dollar in the per-row sum corresponds to a windowed byte,
  // and the per-row totals add up to the same total_cost_usd headline
  // (which we also restrict to the windowed slice — see further down).
  const tWindowCond = days !== null ? 't.timestamp >= ?' : '1=1';
  const tWindowParam = days !== null ? [Date.now() - days * 86_400_000] : [];
  type Row = {
    session_id: string;
    kind: SessionTokenBreakdownRow['kind'];
    source: string | null;
    bytes: number;
    est_tokens: number;
    items: number;
    s_in_bytes_total: number;
    s_out_bytes_total: number;
  };
  const rows = db
    .prepare(
      `WITH session_bytes_in_window AS (
         SELECT t.session_id,
                SUM(CASE WHEN t.kind IN ('tool_result', 'user_text') THEN t.bytes ELSE 0 END) AS in_bytes,
                SUM(CASE WHEN t.kind IN ('tool_use', 'assistant_text') THEN t.bytes ELSE 0 END) AS out_bytes
         FROM tool_io t
         WHERE ${tWindowCond}
         GROUP BY t.session_id
       )
       SELECT t.session_id, t.kind, t.source,
              SUM(t.bytes) AS bytes,
              SUM(t.est_tokens) AS est_tokens,
              COUNT(*) AS items,
              s.input_tokens AS s_input_tokens,
              s.output_tokens AS s_output_tokens,
              s.cache_read_tokens AS s_cache_read_tokens,
              s.cache_write_tokens AS s_cache_write_tokens,
              s.model AS s_model,
              s.est_cost_usd AS s_est_cost,
              sb.in_bytes AS s_in_bytes_total,
              sb.out_bytes AS s_out_bytes_total
       FROM tool_io t
         JOIN sessions s ON s.id = t.session_id
         JOIN session_bytes_in_window sb ON sb.session_id = t.session_id
       ${where}
       GROUP BY t.session_id, t.kind, t.source`,
    )
    .all(...tWindowParam, ...params, ...mc.params) as Array<Row & {
      s_input_tokens: number;
      s_output_tokens: number;
      s_cache_read_tokens: number;
      s_cache_write_tokens: number;
      s_model: string | null;
      s_est_cost: number;
    }>;

  // Aggregate per (kind, source), summing pro-rated cost across sessions.
  // Also track per-session total cost attributed (in + out) so the headline
  // total_cost_usd below is restricted to the windowed slice — otherwise the
  // per-row sum and the headline diverge whenever a session straddles the
  // window boundary.
  const acc = new Map<string, TokenBreakdownRow>();
  const sessionCostInWindow = new Map<string, number>();
  for (const r of rows) {
    // Split the session's est_cost_usd into input-side and output-side using
    // the pricing module on the session's actual token mix. More accurate
    // than treating input/output as the same per-token price.
    const inCost = estimateCost({
      model: r.s_model,
      inputTokens: r.s_input_tokens,
      outputTokens: 0,
      cacheReadTokens: r.s_cache_read_tokens,
      cacheWriteTokens: r.s_cache_write_tokens,
    });
    const outCost = estimateCost({
      model: r.s_model,
      inputTokens: 0,
      outputTokens: r.s_output_tokens,
    });
    let share = 0;
    if (r.kind === 'tool_result' || r.kind === 'user_text') {
      share = r.s_in_bytes_total > 0 ? (r.bytes / r.s_in_bytes_total) * inCost : 0;
    } else {
      share = r.s_out_bytes_total > 0 ? (r.bytes / r.s_out_bytes_total) * outCost : 0;
    }
    sessionCostInWindow.set(r.session_id, (sessionCostInWindow.get(r.session_id) || 0) + share);
    const key = `${r.kind}|${r.source ?? ''}`;
    const cur = acc.get(key);
    if (cur) {
      cur.bytes += r.bytes;
      cur.est_tokens += r.est_tokens;
      cur.items += r.items;
      cur.est_cost_usd += share;
    } else {
      acc.set(key, {
        kind: r.kind,
        source: r.source,
        bytes: r.bytes,
        est_tokens: r.est_tokens,
        items: r.items,
        est_cost_usd: share,
      });
    }
  }
  const headlineCost = [...sessionCostInWindow.values()].reduce((s, c) => s + c, 0);

  // Pro-rate the billed-token totals (input/output/cache_*) by the same
  // in-window byte ratio per session, so the headline cache mix percentages
  // also reflect "just the slice the user is looking at" rather than the
  // whole session. Without this, picking range=24h on a session that's been
  // running for 3 days would show 3 days of cache_read on the dashboard.
  let inputT = 0;
  let outputT = 0;
  let cacheRT = 0;
  let cacheWT = 0;
  let uniqueB = 0;
  type SessionRollup = {
    in_bytes_total: number;
    out_bytes_total: number;
    s_in_window_bytes: number; // in-window in-side bytes for this session
    s_out_window_bytes: number;
    s_input_tokens: number;
    s_output_tokens: number;
    s_cache_read_tokens: number;
    s_cache_write_tokens: number;
  };
  const perSession = new Map<string, SessionRollup>();
  for (const r of rows) {
    let agg = perSession.get(r.session_id);
    if (!agg) {
      agg = {
        in_bytes_total: r.s_in_bytes_total,
        out_bytes_total: r.s_out_bytes_total,
        s_in_window_bytes: 0,
        s_out_window_bytes: 0,
        s_input_tokens: r.s_input_tokens,
        s_output_tokens: r.s_output_tokens,
        s_cache_read_tokens: r.s_cache_read_tokens,
        s_cache_write_tokens: r.s_cache_write_tokens,
      };
      perSession.set(r.session_id, agg);
    }
    if (r.kind === 'tool_result' || r.kind === 'user_text') {
      agg.s_in_window_bytes += r.bytes;
    } else {
      agg.s_out_window_bytes += r.bytes;
    }
    uniqueB += r.bytes;
  }
  for (const agg of perSession.values()) {
    const inShare = agg.in_bytes_total > 0 ? agg.s_in_window_bytes / agg.in_bytes_total : 0;
    const outShare = agg.out_bytes_total > 0 ? agg.s_out_window_bytes / agg.out_bytes_total : 0;
    inputT += agg.s_input_tokens * inShare;
    cacheRT += agg.s_cache_read_tokens * inShare;
    cacheWT += agg.s_cache_write_tokens * inShare;
    outputT += agg.s_output_tokens * outShare;
  }
  const billed = inputT + outputT + cacheRT + cacheWT;

  const sortedRows = [...acc.values()].sort((a, b) => b.est_cost_usd - a.est_cost_usd);

  return {
    rows: sortedRows,
    billed_tokens: Math.round(billed),
    unique_bytes: uniqueB,
    total_cost_usd: headlineCost,
    input_tokens: Math.round(inputT),
    output_tokens: Math.round(outputT),
    cache_read_tokens: Math.round(cacheRT),
    cache_write_tokens: Math.round(cacheWT),
  };
}

// Per-session assistant-message counts by model family. Useful when Claude
// Code or Codex bounces between models mid-session (e.g. sub-agents) — surfaces
// otherwise-invisible model mix. Returns [] if every message used the same
// model or none have a model recorded.
export function getSessionModelMix(sessionId: string): { family: string; messages: number }[] {
  const rows = getSqlite()
    .prepare(
      `SELECT COALESCE(model, '') AS model, COUNT(*) AS n
       FROM messages WHERE session_id = ? AND role = 'assistant' GROUP BY model`,
    )
    .all(sessionId) as { model: string; n: number }[];
  const families = new Map<string, number>();
  for (const r of rows) {
    if (!r.model) continue;
    const family = normalizeModelName(r.model);
    families.set(family, (families.get(family) || 0) + r.n);
  }
  if (families.size <= 1) return [];
  return [...families.entries()]
    .map(([family, messages]) => ({ family, messages }))
    .sort((a, b) => b.messages - a.messages);
}

export function getSessionMessages(sessionId: string) {
  return getSqlite()
    .prepare(
      `SELECT id, role, content, timestamp, model FROM messages WHERE session_id = ? ORDER BY timestamp ASC LIMIT 200`,
    )
    .all(sessionId) as { id: string; role: string; content: string; timestamp: number; model: string | null }[];
}

export function getAllSessions(opts: {
  limit?: number;
  offset?: number;
  provider?: string;
  projectId?: string;
} = {}): SessionRow[] {
  const limit = opts.limit ?? 200;
  const offset = opts.offset ?? 0;
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.provider)  { where.push('s.provider = ?');   params.push(opts.provider); }
  if (opts.projectId) { where.push('s.project_id = ?'); params.push(opts.projectId); }
  const wsql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return getSqlite()
    .prepare(
      `SELECT ${SESSION_FIELDS} FROM sessions s JOIN projects p ON p.id = s.project_id ${wsql}
       ORDER BY s.started_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as SessionRow[];
}

export type DailyPoint = { day: string; sessions: number; tokens: number; cost: number };

export function getDailySeries(
  days: number | null = 30,
  projectId?: string | null,
  modelFamily?: string | null,
): DailyPoint[] {
  return ttlMemo(
    `getDailySeries:${days}:${projectId ?? ''}:${modelFamily ?? ''}`,
    READ_TTL_MS,
    () => _getDailySeries(days, projectId ?? null, modelFamily ?? null),
  );
}

// Bucket granularity follows window size. Sub-2-day windows get hourly
// buckets ("when did I spend tokens today"); everything else stays daily.
// The point's `day` field carries `YYYY-MM-DD` for daily mode and
// `YYYY-MM-DD HH:00` for hourly — both sort naturally and the chart's
// label formatter discriminates on string length.
function _getDailySeries(days: number | null, projectId: string | null, modelFamily: string | null): DailyPoint[] {
  const db = getSqlite();
  const projClause = projectId ? ' AND s.project_id = ?' : '';
  const projParam: unknown[] = projectId ? [projectId] : [];
  const mc = modelClause(modelFamily, 's');

  const hourly = days !== null && days < 2;
  const bucketMs = hourly ? 3_600_000 : 86_400_000;

  // Compute the window start and how many buckets to seed.
  let since: number;
  let bucketCount: number;
  if (days === null) {
    const earliest = db
      .prepare(
        `SELECT MIN(m.timestamp) AS min FROM messages m
         JOIN sessions s ON s.id = m.session_id WHERE 1=1${projClause}${mc.sql}`,
      )
      .get(...projParam, ...mc.params) as { min: number | null };
    if (!earliest.min) return [];
    since = earliest.min;
    bucketCount = Math.max(1, Math.ceil((Date.now() - since) / bucketMs) + 1);
  } else {
    since = Date.now() - days * 86_400_000;
    // Rolling N-unit window crosses N unit boundaries → N+1 buckets. Without
    // the +1, messages near the leading edge land in an unseeded bucket and
    // get silently dropped.
    bucketCount = Math.ceil((days * 86_400_000) / bucketMs) + 1;
  }

  const rows = db
    .prepare(
      `SELECT m.timestamp, m.session_id,
              m.input_tokens, m.output_tokens, m.cache_read_tokens, m.cache_write_tokens, m.est_cost_usd
       FROM messages m JOIN sessions s ON s.id = m.session_id
       WHERE m.timestamp >= ?${projClause}${mc.sql}`,
    )
    .all(since, ...projParam, ...mc.params) as Array<{
      timestamp: number;
      session_id: string;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      cache_write_tokens: number;
      est_cost_usd: number;
    }>;

  const map = new Map<string, DailyPoint>();
  const sessionsByBucket = new Map<string, Set<string>>();
  for (let i = 0; i < bucketCount; i++) {
    const d = new Date();
    if (hourly) {
      d.setHours(d.getHours() - i, 0, 0, 0);
    } else {
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
    }
    const k = bucketKey(d, hourly);
    map.set(k, { day: k, sessions: 0, tokens: 0, cost: 0 });
    sessionsByBucket.set(k, new Set());
  }
  for (const r of rows) {
    const k = bucketKey(new Date(r.timestamp), hourly);
    const p = map.get(k);
    if (!p) continue;
    p.tokens += r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens;
    p.cost += r.est_cost_usd;
    sessionsByBucket.get(k)!.add(r.session_id);
  }
  for (const [k, set] of sessionsByBucket) {
    const p = map.get(k);
    if (p) p.sessions = set.size;
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
}

function bucketKey(d: Date, hourly: boolean): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  if (!hourly) return `${y}-${m}-${day}`;
  const h = String(d.getHours()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:00`;
}

export function getProviderBreakdown(): { provider: string; sessions: number; tokens: number; cost: number }[] {
  return ttlMemo('getProviderBreakdown', READ_TTL_MS, () =>
    getSqlite()
      .prepare(
        `SELECT provider,
                COUNT(*) AS sessions,
                SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) AS tokens,
                SUM(est_cost_usd) AS cost
         FROM sessions GROUP BY provider ORDER BY tokens DESC`,
      )
      .all() as { provider: string; sessions: number; tokens: number; cost: number }[],
  );
}

export function getModelBreakdown(
  days: number | null = null,
  projectId?: string | null,
): { model: string; sessions: number; tokens: number; cost: number }[] {
  return ttlMemo(
    `getModelBreakdown:${days ?? 'all'}:${projectId ?? ''}`,
    READ_TTL_MS,
    () => _getModelBreakdown(days, projectId ?? null),
  );
}

function _getModelBreakdown(days: number | null, projectId: string | null): { model: string; sessions: number; tokens: number; cost: number }[] {
  // Aggregate from messages (which carry per-message model) so multi-model
  // sessions split across the right families and the day window is honest.
  // Sessions per model = distinct session_ids that ever used that model in
  // the window — by design, a multi-model session counts for each model.
  const conds: string[] = ['m.input_tokens + m.output_tokens + m.cache_read_tokens + m.cache_write_tokens > 0'];
  const params: unknown[] = [];
  if (days !== null) { conds.push('m.timestamp >= ?'); params.push(Date.now() - days * 86_400_000); }
  if (projectId) { conds.push('s.project_id = ?'); params.push(projectId); }
  const where = `WHERE ${conds.join(' AND ')}`;
  const raw = getSqlite()
    .prepare(
      `SELECT COALESCE(m.model, s.model, 'unknown') AS model,
              COUNT(DISTINCT m.session_id) AS sessions,
              SUM(m.input_tokens + m.output_tokens + m.cache_read_tokens + m.cache_write_tokens) AS tokens,
              SUM(m.est_cost_usd) AS cost
       FROM messages m JOIN sessions s ON s.id = m.session_id
       ${where} GROUP BY COALESCE(m.model, s.model, 'unknown')`,
    )
    .all(...params) as { model: string; sessions: number; tokens: number; cost: number }[];

  // Collapse model variants into family labels (Claude Opus 4-7 + Opus 4-6 → "Claude Opus 4").
  // Keep raw model_id in the DB; this is purely cosmetic for the breakdown chart.
  const grouped = new Map<string, { model: string; sessions: number; tokens: number; cost: number }>();
  for (const r of raw) {
    const label = normalizeModelName(r.model);
    const acc = grouped.get(label);
    if (acc) {
      acc.sessions += r.sessions;
      acc.tokens += r.tokens;
      acc.cost += r.cost;
    } else {
      grouped.set(label, { model: label, sessions: r.sessions, tokens: r.tokens, cost: r.cost });
    }
  }
  return [...grouped.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 12);
}

export function getOverview() {
  return ttlMemo('getOverview', READ_TTL_MS, () => _getOverview());
}

function _getOverview() {
  const row = getSqlite()
    .prepare(
      `SELECT
         COUNT(*) AS sessions,
         COUNT(DISTINCT project_id) AS projects,
         COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0) AS tokens,
         COALESCE(SUM(est_cost_usd), 0) AS cost,
         COUNT(DISTINCT strftime('%Y-%m', started_at/1000, 'unixepoch')) AS active_months,
         MIN(started_at) AS first_session,
         MAX(started_at) AS last_session
       FROM sessions`,
    )
    .get() as {
      sessions: number;
      projects: number;
      tokens: number;
      cost: number;
      active_months: number;
      first_session: number | null;
      last_session: number | null;
    };
  return row;
}

export function getRecentSessions(limit = 12, projectId?: string | null, modelFamily?: string | null): SessionRow[] {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (projectId) { conds.push('s.project_id = ?'); params.push(projectId); }
  const mc = modelClause(modelFamily ?? null, 's');
  // modelClause returns " AND ...". We're building the leading WHERE manually
  // here, so trim the leading " AND " when it's the first clause.
  const where = conds.length > 0
    ? ` WHERE ${conds.join(' AND ')}${mc.sql}`
    : (mc.sql ? ` WHERE 1=1${mc.sql}` : '');
  params.push(...mc.params, limit);
  return getSqlite()
    .prepare(
      `SELECT ${SESSION_FIELDS} FROM sessions s JOIN projects p ON p.id = s.project_id
       ${where} ORDER BY s.started_at DESC LIMIT ?`,
    )
    .all(...params) as SessionRow[];
}

export type ProjectBreakdown = {
  id: string;
  name: string;
  sessions: number;
  tokens: number;
  cost: number;
  last_active: number;
};

export function getProjectBreakdown(
  days: number | null = 30,
  topN = 6,
  modelFamily?: string | null,
): ProjectBreakdown[] {
  return ttlMemo(
    `getProjectBreakdown:${days}:${topN}:${modelFamily ?? ''}`,
    READ_TTL_MS,
    () => _getProjectBreakdown(days, topN, modelFamily ?? null),
  );
}

function _getProjectBreakdown(days: number | null, topN: number, modelFamily: string | null): ProjectBreakdown[] {
  const since = days === null ? 0 : Date.now() - days * 86_400_000;
  const mc = modelClause(modelFamily, 's');
  // Sum message-level tokens within the window so a multi-day session shows
  // up under its real day-of-activity, not just the day it was opened.
  return getSqlite()
    .prepare(
      `SELECT p.id, p.name, p.last_active,
              COUNT(DISTINCT s.id) AS sessions,
              COALESCE(SUM(m.input_tokens + m.output_tokens + m.cache_read_tokens + m.cache_write_tokens), 0) AS tokens,
              COALESCE(SUM(m.est_cost_usd), 0) AS cost
       FROM projects p
         JOIN sessions s ON s.project_id = p.id
         JOIN messages m ON m.session_id = s.id
       WHERE m.timestamp >= ?${mc.sql}
       GROUP BY p.id ORDER BY tokens DESC LIMIT ?`,
    )
    .all(since, ...mc.params, topN) as ProjectBreakdown[];
}

export function getCategoryBreakdown(
  days: number | null = 30,
  projectId?: string | null,
  modelFamily?: string | null,
): { category: string; sessions: number; tokens: number }[] {
  return ttlMemo(
    `getCategoryBreakdown:${days}:${projectId ?? ''}:${modelFamily ?? ''}`,
    READ_TTL_MS,
    () => _getCategoryBreakdown(days, projectId ?? null, modelFamily ?? null),
  );
}

function _getCategoryBreakdown(days: number | null, projectId: string | null, modelFamily: string | null): { category: string; sessions: number; tokens: number }[] {
  const since = days === null ? 0 : Date.now() - days * 86_400_000;
  const projClause = projectId ? ' AND s.project_id = ?' : '';
  const projParam: unknown[] = projectId ? [projectId] : [];
  const mc = modelClause(modelFamily, 's');
  // Sum tokens per session from message rows inside the window, then attribute
  // by the session's category labels. Sessions whose messages don't reach into
  // the window naturally fall out (tokens = 0 → no row).
  const rows = getSqlite()
    .prepare(
      `SELECT s.category, s.categories,
              COALESCE(SUM(m.input_tokens + m.output_tokens + m.cache_read_tokens + m.cache_write_tokens), 0) AS tokens
       FROM messages m JOIN sessions s ON s.id = m.session_id
       WHERE m.timestamp >= ?${projClause}${mc.sql}
       GROUP BY s.id`,
    )
    .all(since, ...projParam, ...mc.params) as { category: string | null; categories: string | null; tokens: number }[];

  // A session with N labels contributes 1 to each label's session count and
  // its full token total to each. Slight double-count by design — the chart
  // measures "how much of my time involved X" not unique session count.
  const acc = new Map<string, { sessions: number; tokens: number }>();
  for (const r of rows) {
    const labels = _sessionCategories(r);
    const list = labels.length ? labels : ['Unknown'];
    for (const label of list) {
      const cur = acc.get(label) ?? { sessions: 0, tokens: 0 };
      cur.sessions += 1;
      cur.tokens += r.tokens;
      acc.set(label, cur);
    }
  }
  return [...acc.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.sessions - a.sessions);
}

export type RangeSummary = {
  sessions: number;
  projects: number;
  tokens: number;
  cost: number; // retail token-price sum
  active_months: number; // distinct YYYY-MM with ≥1 session in range
  sessions_prev: number;
  tokens_prev: number;
  cost_prev: number;
  active_months_prev: number;
};

export function getRangeSummary(
  days: number | null = 30,
  projectId?: string | null,
  modelFamily?: string | null,
): RangeSummary {
  return ttlMemo(
    `getRangeSummary:${days}:${projectId ?? ''}:${modelFamily ?? ''}`,
    READ_TTL_MS,
    () => _getRangeSummary(days, projectId ?? null, modelFamily ?? null),
  );
}

// Roll up token + cost from per-message rows, so multi-day sessions get
// attributed to the calendar days they actually touched. Sessions / projects
// counts are "had any activity in the window" — same logic, derived from
// distinct session_ids / project_ids in the message slice.
function _getRangeSummary(days: number | null, projectId: string | null, modelFamily: string | null): RangeSummary {
  const db = getSqlite();
  const now = Date.now();
  const start = days === null ? 0 : now - days * 86_400_000;
  const prevStart = days === null ? 0 : start - days * 86_400_000;
  const projClause = projectId ? ' AND s.project_id = ?' : '';
  const projParam: unknown[] = projectId ? [projectId] : [];
  const mc = modelClause(modelFamily, 's');

  const sql = (lo: string, hi: string | null) => `
    SELECT
      COUNT(DISTINCT m.session_id) AS sessions,
      COUNT(DISTINCT s.project_id) AS projects,
      COALESCE(SUM(m.input_tokens + m.output_tokens + m.cache_read_tokens + m.cache_write_tokens), 0) AS tokens,
      COALESCE(SUM(m.est_cost_usd), 0) AS cost,
      COUNT(DISTINCT strftime('%Y-%m', m.timestamp/1000, 'unixepoch')) AS active_months
    FROM messages m JOIN sessions s ON s.id = m.session_id
    WHERE m.timestamp >= ?${hi ? ' AND m.timestamp < ?' : ''}${projClause}${mc.sql}
  `;

  const cur = db
    .prepare(sql('m.timestamp >= ?', null))
    .get(start, ...projParam, ...mc.params) as {
      sessions: number;
      projects: number;
      tokens: number;
      cost: number;
      active_months: number;
    };

  if (days === null) {
    return { ...cur, sessions_prev: 0, tokens_prev: 0, cost_prev: 0, active_months_prev: 0 };
  }

  const prev = db
    .prepare(sql('m.timestamp >= ?', 'm.timestamp < ?'))
    .get(prevStart, start, ...projParam, ...mc.params) as {
      sessions: number;
      projects: number;
      tokens: number;
      cost: number;
      active_months: number;
    };

  return {
    ...cur,
    sessions_prev: prev.sessions,
    tokens_prev: prev.tokens,
    cost_prev: prev.cost,
    active_months_prev: prev.active_months,
  };
}

export function getDaySummary(day: string): string | null {
  const row = getSqlite().prepare('SELECT summary FROM day_summaries WHERE day = ?').get(day) as
    | { summary: string }
    | undefined;
  return row?.summary ?? null;
}

// List of distinct model families currently present in the DB, ranked by usage.
// Used to populate the model filter dropdown.
export function getModelFamilies(): { family: string; sessions: number }[] {
  return ttlMemo('getModelFamilies', READ_TTL_MS, () => _getModelFamilies());
}

function _getModelFamilies(): { family: string; sessions: number }[] {
  const rows = getSqlite()
    .prepare(
      `SELECT COALESCE(model, 'unknown') AS model, COUNT(*) AS sessions
       FROM sessions GROUP BY model`,
    )
    .all() as { model: string; sessions: number }[];
  const families = new Map<string, number>();
  for (const r of rows) {
    const label = normalizeModelName(r.model);
    families.set(label, (families.get(label) || 0) + r.sessions);
  }
  return [...families.entries()]
    .map(([family, sessions]) => ({ family, sessions }))
    .sort((a, b) => b.sessions - a.sessions);
}

// Resolve a family label ("Claude Opus 4") into the list of raw model_ids
// stored in the sessions table that roll up to it. Used to build the IN-clause
// for model-family filtering across the dashboard queries.
function modelIdsForFamily(family: string): string[] {
  const rows = getSqlite()
    .prepare(`SELECT DISTINCT model FROM sessions WHERE model IS NOT NULL`)
    .all() as { model: string }[];
  return rows.filter((r) => normalizeModelName(r.model) === family).map((r) => r.model);
}

// Build a (clause, params) pair for an optional model-family filter, plus the
// project-id filter from earlier callers. Centralized so every dashboard query
// applies the same predicate.
function modelClause(modelFamily: string | null, table = ''): { sql: string; params: unknown[] } {
  if (!modelFamily) return { sql: '', params: [] };
  const ids = modelIdsForFamily(modelFamily);
  if (ids.length === 0) {
    // Family no longer present (or never was). Force zero rows by binding 1=0
    // — saner than throwing and breaks no existing queries.
    return { sql: ' AND 1=0', params: [] };
  }
  const placeholders = ids.map(() => '?').join(',');
  const col = table ? `${table}.model` : 'model';
  return { sql: ` AND ${col} IN (${placeholders})`, params: ids };
}

export function getUnclassifiedCount(): number {
  const row = getSqlite()
    .prepare(
      `SELECT COUNT(*) AS n FROM sessions
       WHERE category IS NULL AND first_prompt IS NOT NULL AND length(first_prompt) > 0`,
    )
    .get() as { n: number };
  return row.n;
}

export type QuotaSnapshot = {
  provider: string;
  observed_at: number;
  plan_type: string | null;
  primary_pct: number | null;
  primary_window_minutes: number | null;
  primary_resets_at: number | null;
  secondary_pct: number | null;
  secondary_window_minutes: number | null;
  secondary_resets_at: number | null;
};

export function getQuotaSnapshot(provider: string): QuotaSnapshot | null {
  const row = getSqlite()
    .prepare('SELECT * FROM quota_snapshots WHERE provider = ?')
    .get(provider) as QuotaSnapshot | undefined;
  return row ?? null;
}

// Anthropic doesn't publish billable-token math for subscription quotas, so we
// avoid faking a "% of cap" number entirely. Instead we report raw tokens used
// in the current 5h window alongside the user's historical 5h peak as context.
// Cache reads are excluded from the sum — they're billed at ~10% on the API
// and almost certainly count for far less against subscription caps too.
function billableTokens(r: {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}): number {
  return r.input_tokens + r.output_tokens + r.cache_write_tokens;
}

// Claude Code stores some account state in ~/.claude.json. We can read it to
// detect whether the user is a subscriber vs. API-only.
export type ClaudeAccountInfo = {
  billingType: string | null;        // "stripe_subscription" or other
  hasExtraUsage: boolean;
  isSubscriber: boolean;
};

export function detectClaudeAccount(): ClaudeAccountInfo {
  // Read ~/.claude.json synchronously to grab the oauthAccount block.
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  let billingType: string | null = null;
  let hasExtraUsage = false;
  try {
    const raw = fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8');
    const cfg = JSON.parse(raw);
    billingType = cfg?.oauthAccount?.billingType ?? null;
    hasExtraUsage = Boolean(cfg?.oauthAccount?.hasExtraUsageEnabled);
  } catch {
    // file missing or unreadable — fall through with defaults
  }
  return {
    billingType,
    hasExtraUsage,
    isSubscriber: billingType === 'stripe_subscription',
  };
}

// Claude quota: report raw billable tokens used in the current 5h window plus
// the user's historical 5h peak as context. No fake "% of cap" — Anthropic
// doesn't publish billable-token math for subscription quotas.
export type ClaudeQuotaInfo = {
  isSubscriber: boolean;
  currentTokens: number;
  peakTokens: number;
  observedAt: number;
  windowStartsAt: number | null;
  resetsAt: number;            // unix seconds, ground truth when available
  resetIsGroundTruth: boolean;
};

export function getClaudeQuotaInfo(): ClaudeQuotaInfo | null {
  const account = detectClaudeAccount();
  const db = getSqlite();
  const now = Date.now();
  const fiveHourStart = now - 5 * 60 * 60 * 1000;
  const ninetyDayStart = now - 90 * 24 * 60 * 60 * 1000;

  // Tokens-in-current-5h-window, billable definition (no cache_read).
  const current = db
    .prepare(
      `SELECT COALESCE(SUM(input_tokens + output_tokens + cache_write_tokens), 0) AS tokens,
              MAX(started_at) AS latest,
              MIN(started_at) AS earliest
       FROM sessions WHERE provider = 'claude' AND started_at >= ?`,
    )
    .get(fiveHourStart) as { tokens: number; latest: number | null; earliest: number | null };

  if (!current.latest) return null;

  // Historical peak: highest billable-token sum over any 5h rolling window in
  // the last 90 days. Gives users a personal benchmark to compare against.
  const sessions = db
    .prepare(
      `SELECT started_at, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
       FROM sessions WHERE provider = 'claude' AND started_at >= ?
       ORDER BY started_at ASC`,
    )
    .all(ninetyDayStart) as Array<{
      started_at: number;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      cache_write_tokens: number;
    }>;

  let peak = 0;
  for (let i = 0; i < sessions.length; i++) {
    const windowEnd = sessions[i].started_at + 5 * 60 * 60 * 1000;
    let sum = 0;
    for (let j = i; j < sessions.length && sessions[j].started_at <= windowEnd; j++) {
      sum += billableTokens(sessions[j]);
    }
    if (sum > peak) peak = sum;
  }

  // Prefer ground-truth reset time from a real "limit reached" event if Claude
  // recorded one in the current 5h window. Otherwise estimate from window start.
  const groundTruth = db
    .prepare(
      `SELECT reset_at FROM claude_limit_events
       WHERE observed_at >= ? AND reset_at IS NOT NULL
       ORDER BY observed_at DESC LIMIT 1`,
    )
    .get(fiveHourStart) as { reset_at: number } | undefined;

  const resetsAt = groundTruth?.reset_at
    ? Math.floor(groundTruth.reset_at / 1000)
    : current.earliest
      ? Math.floor((current.earliest + 5 * 60 * 60 * 1000) / 1000)
      : Math.floor((now + 5 * 60 * 60 * 1000) / 1000);

  return {
    isSubscriber: account.isSubscriber,
    currentTokens: current.tokens,
    peakTokens: peak,
    observedAt: current.latest,
    windowStartsAt: current.earliest,
    resetsAt,
    resetIsGroundTruth: Boolean(groundTruth?.reset_at),
  };
}

export function setSetting(key: string, value: string) {
  getSqlite().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

export function getSetting(key: string): string | null {
  const row = getSqlite().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}
