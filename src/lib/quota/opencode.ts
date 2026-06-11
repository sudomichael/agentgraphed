import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { getSetting } from '@/lib/queries';

const DB_PATH = join(homedir(), '.local', 'share', 'opencode', 'opencode.db');
const AUTH_PATH = join(homedir(), '.local', 'share', 'opencode', 'auth.json');

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const LIMITS = { session: 12, weekly: 30, monthly: 60 };

const HISTORY_ROWS_SQL = `
  SELECT
    CAST(COALESCE(json_extract(data, '$.time.created'), time_created) AS INTEGER) AS createdMs,
    CAST(json_extract(data, '$.cost') AS REAL) AS cost
  FROM message
  WHERE json_valid(data)
    AND json_extract(data, '$.providerID') = 'opencode-go'
    AND json_extract(data, '$.role') = 'assistant'
    AND json_type(data, '$.cost') IN ('integer', 'real')
`;

export type OpencodeProbeResult =
  | {
      ok: true;
      observedAt: number;
      planType: string | null;
      primary: { utilization: number; resetsAt: number; status: string | null } | null;
      secondary: { utilization: number; resetsAt: number; status: string | null } | null;
      monthly: { utilization: number; resetsAt: number; status: string | null } | null;
      tokenWasRefreshed: false;
    }
  | { ok: false; error: string; httpStatus?: number };

function readGoApiKey(): string | null {
  try {
    if (!existsSync(AUTH_PATH)) return null;
    const auth = JSON.parse(readFileSync(AUTH_PATH, 'utf8'));
    return auth?.['opencode-go']?.key || null;
  } catch {
    return null;
  }
}

function getOpencodeDbPath(): string {
  return getSetting('opencode_db_path') || process.env.AGENTGRAPHED_OPENCODE_DB_PATH || DB_PATH;
}

function clampUtilization(cost: number, limit: number): number {
  if (!Number.isFinite(cost) || !Number.isFinite(limit) || limit <= 0) return 0;
  const ratio = cost / limit;
  if (!Number.isFinite(ratio)) return 0;
  return Math.max(0, Math.min(1, ratio));
}

function startOfUtcWeek(nowMs: number): number {
  const date = new Date(nowMs);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function shiftMonth(year: number, month: number, delta: number): [number, number] {
  const total = year * 12 + month + delta;
  return [Math.floor(total / 12), ((total % 12) + 12) % 12];
}

function anchorMonth(year: number, month: number, anchorDate: Date): number {
  const maxDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(
    year, month,
    Math.min(anchorDate.getUTCDate(), maxDay),
    anchorDate.getUTCHours(),
    anchorDate.getUTCMinutes(),
    anchorDate.getUTCSeconds(),
    anchorDate.getUTCMilliseconds(),
  );
}

function anchoredMonthBounds(nowMs: number, anchorMs: number): { startMs: number; endMs: number } {
  if (!Number.isFinite(anchorMs)) {
    const date = new Date(nowMs);
    const startMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    const endMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    return { startMs, endMs };
  }
  const nowDate = new Date(nowMs);
  const anchorDate = new Date(anchorMs);
  let year = nowDate.getUTCFullYear();
  let month = nowDate.getUTCMonth();
  let startMs = anchorMonth(year, month, anchorDate);
  if (startMs > nowMs) {
    [year, month] = shiftMonth(year, month, -1);
    startMs = anchorMonth(year, month, anchorDate);
  }
  const [nextYear, nextMonth] = shiftMonth(year, month, 1);
  return { startMs, endMs: anchorMonth(nextYear, nextMonth, anchorDate) };
}

function sumRange(rows: Array<{ createdMs: number; cost: number }>, startMs: number, endMs: number): number {
  let total = 0;
  for (const row of rows) {
    if (row.createdMs < startMs || row.createdMs >= endMs) continue;
    total += row.cost;
  }
  return Math.round(total * 10000) / 10000;
}

function nextRollingReset(rows: Array<{ createdMs: number; cost: number }>, nowMs: number): number {
  const startMs = nowMs - FIVE_HOURS_MS;
  let oldest: number | null = null;
  for (const row of rows) {
    if (row.createdMs < startMs || row.createdMs >= nowMs) continue;
    if (oldest === null || row.createdMs < oldest) oldest = row.createdMs;
  }
  return (oldest === null ? nowMs : oldest) + FIVE_HOURS_MS;
}

export async function probeOpencodeQuota(): Promise<OpencodeProbeResult> {
  const apiKey = readGoApiKey();
  if (!apiKey) {
    return {
      ok: false,
      error: 'No OpenCode Go API key found. Log in with `opencode auth login` first.',
    };
  }

  const dbPath = getOpencodeDbPath();
  if (!dbPath || !existsSync(dbPath)) {
    return {
      ok: false,
      error: 'OpenCode database not found. Use opencode first to generate session data.',
    };
  }

  let rows: Array<{ createdMs: number; cost: number }>;
  try {
    const ocDb = new Database(dbPath, { readonly: true });
    ocDb.pragma('journal_mode = WAL');
    const raw = ocDb.prepare(HISTORY_ROWS_SQL).all() as Array<{ createdMs: number | null; cost: number | null }>;
    ocDb.close();
    rows = [];
    for (const r of raw) {
      const ms = Number(r.createdMs);
      const c = Number(r.cost);
      if (Number.isFinite(ms) && ms > 0 && Number.isFinite(c) && c >= 0) {
        rows.push({ createdMs: ms, cost: c });
      }
    }
  } catch (e) {
    return { ok: false, error: `Failed to read OpenCode database: ${(e as Error).message}` };
  }

  if (rows.length === 0) {
    return {
      ok: true,
      observedAt: Date.now(),
      planType: 'Go',
      primary: null,
      secondary: null,
      monthly: null,
      tokenWasRefreshed: false,
    };
  }

  const nowMs = Date.now();
  const sessionStartMs = nowMs - FIVE_HOURS_MS;
  const weeklyStartMs = startOfUtcWeek(nowMs);
  const weeklyEndMs = weeklyStartMs + WEEK_MS;

  let earliestMs = rows[0].createdMs;
  for (const r of rows) {
    if (r.createdMs < earliestMs) earliestMs = r.createdMs;
  }
  const monthBounds = anchoredMonthBounds(nowMs, earliestMs);

  const sessionCost = sumRange(rows, sessionStartMs, nowMs);
  const weeklyCost = sumRange(rows, weeklyStartMs, weeklyEndMs);
  const monthlyCost = sumRange(rows, monthBounds.startMs, monthBounds.endMs);

  return {
    ok: true,
    observedAt: nowMs,
    planType: 'Go',
    primary: {
      utilization: clampUtilization(sessionCost, LIMITS.session),
      resetsAt: nextRollingReset(rows, nowMs),
      status: 'allowed',
    },
    secondary: {
      utilization: clampUtilization(weeklyCost, LIMITS.weekly),
      resetsAt: weeklyEndMs,
      status: 'allowed',
    },
    monthly: {
      utilization: clampUtilization(monthlyCost, LIMITS.monthly),
      resetsAt: monthBounds.endMs,
      status: 'allowed',
    },
    tokenWasRefreshed: false,
  };
}
