import { getSqlite } from './db/client';
import { dayKey } from './format';
import { normalizeModelName } from './pricing';
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

function _getDailySeries(days: number | null, projectId: string | null, modelFamily: string | null): DailyPoint[] {
  const db = getSqlite();
  let since: number;
  let bucketDays: number;
  const projClause = projectId ? ' AND s.project_id = ?' : '';
  const projParam: unknown[] = projectId ? [projectId] : [];
  const mc = modelClause(modelFamily, 's');
  if (days === null) {
    const earliest = db
      .prepare(
        `SELECT MIN(m.timestamp) AS min FROM messages m
         JOIN sessions s ON s.id = m.session_id WHERE 1=1${projClause}${mc.sql}`,
      )
      .get(...projParam, ...mc.params) as { min: number | null };
    if (!earliest.min) return [];
    since = earliest.min;
    bucketDays = Math.max(1, Math.ceil((Date.now() - since) / 86_400_000) + 1);
  } else {
    since = Date.now() - days * 86_400_000;
    // A rolling Nd window crosses N midnights, which is N+1 calendar-day
    // buckets. Without the +1, messages from "yesterday evening but within
    // the last 24h" land in yesterday's dayKey and get dropped because the
    // map only has today's bucket. The visible side effect is most obvious
    // on `days=1` (the 24h preset).
    bucketDays = days + 1;
  }
  // Pull one row per message in range, bucket by the day each message landed
  // on. "Sessions" per day = distinct session_ids that touched that day.
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
  const sessionsByDay = new Map<string, Set<string>>();
  for (let i = 0; i < bucketDays; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const k = dayKey(d.getTime());
    map.set(k, { day: k, sessions: 0, tokens: 0, cost: 0 });
    sessionsByDay.set(k, new Set());
  }
  for (const r of rows) {
    const k = dayKey(r.timestamp);
    const p = map.get(k);
    if (!p) continue;
    p.tokens += r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens;
    p.cost += r.est_cost_usd;
    sessionsByDay.get(k)!.add(r.session_id);
  }
  for (const [k, set] of sessionsByDay) {
    const p = map.get(k);
    if (p) p.sessions = set.size;
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
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
