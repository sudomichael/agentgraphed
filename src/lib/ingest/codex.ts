import { readdirSync, statSync, createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { getSqlite } from '../db/client';
import { resolveProject, upsertProject } from '../projects';
import { estimateCost } from '../pricing';
import { getSetting } from '../queries';
import { dataDir } from '../db/paths';
import type { IngestStats } from './claude';

type CodexLine = {
  timestamp?: string;
  type?: string;
  payload?: any;
};

function walkSessions(base: string): string[] {
  if (!existsSync(base)) return [];
  const out: string[] = [];
  const stack = [base];
  while (stack.length) {
    const d = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
    }
  }
  return out;
}

function flattenCodexContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c;
        if (c && typeof c === 'object') {
          const o = c as { type?: string; text?: string };
          if ((o.type === 'input_text' || o.type === 'output_text' || o.type === 'text') && o.text) return o.text;
        }
        return '';
      })
      .join('\n')
      .trim();
  }
  return '';
}

export async function ingestCodex(opts: { onProgress?: (msg: string) => void } = {}): Promise<IngestStats> {
  const base =
    getSetting('codex_log_dir') ||
    process.env.AGENTGRAPHED_CODEX_DIR ||
    process.env.AGENTGRAPH_CODEX_DIR ||
    join(homedir(), '.codex', 'sessions');
  const stats: IngestStats = { filesScanned: 0, filesIngested: 0, sessions: 0, messages: 0 };
  const files = [...walkSessions(base), ...walkSessions(join(dataDir(), 'uploads', 'codex'))];
  stats.filesScanned = files.length;

  const db = getSqlite();
  const getIngestState = db.prepare('SELECT mtime, size FROM ingest_state WHERE source_path = ?');
  const upsertIngestState = db.prepare(
    'INSERT OR REPLACE INTO ingest_state (source_path, mtime, size, session_id, ingested_at) VALUES (?, ?, ?, ?, ?)',
  );

  for (const file of files) {
    const st = statSync(file);
    const cached = getIngestState.get(file) as { mtime: number; size: number } | undefined;
    if (cached && cached.mtime === Math.floor(st.mtimeMs) && cached.size === st.size) continue;

    try {
      const result = await ingestOneCodexFile(file);
      if (result) {
        upsertIngestState.run(file, Math.floor(st.mtimeMs), st.size, result.sessionId, Date.now());
        stats.filesIngested += 1;
        stats.sessions += 1;
        stats.messages += result.messageCount;
        opts.onProgress?.(`Codex: ${stats.filesIngested}/${files.length}`);
      }
    } catch (e) {
      opts.onProgress?.(`Codex: skipped ${file} (${(e as Error).message})`);
    }
  }
  return stats;
}

async function ingestOneCodexFile(file: string): Promise<{ sessionId: string; messageCount: number } | null> {
  const db = getSqlite();
  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });

  let sessionId: string | null = null;
  let cwd: string | null = null;
  let gitBranch: string | null = null;
  let lastModel: string | null = null;
  let startedAt: number | null = null;
  let endedAt: number | null = null;
  let messageCount = 0;
  let userMessageCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheRead = 0;
  let firstPrompt: string | null = null;
  let latestQuotaTs: number | null = null;
  let latestQuota: {
    plan_type: string | null;
    primary_pct: number | null;
    primary_window_minutes: number | null;
    primary_resets_at: number | null;
    secondary_pct: number | null;
    secondary_window_minutes: number | null;
    secondary_resets_at: number | null;
  } | null = null;
  const messages: Array<{ id: string; role: string; content: string; timestamp: number; model: string | null }> = [];

  for await (const raw of rl) {
    if (!raw.trim()) continue;
    let line: CodexLine;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    const ts = line.timestamp ? Date.parse(line.timestamp) : NaN;
    if (!Number.isNaN(ts)) {
      if (startedAt === null || ts < startedAt) startedAt = ts;
      if (endedAt === null || ts > endedAt) endedAt = ts;
    }

    if (line.type === 'session_meta' && line.payload) {
      sessionId = line.payload.id || sessionId;
      cwd = line.payload.cwd || cwd;
      gitBranch = line.payload.git?.branch || gitBranch;
    } else if (line.type === 'turn_context' && line.payload?.model) {
      lastModel = line.payload.model;
      if (line.payload.cwd && !cwd) cwd = line.payload.cwd;
    } else if (line.type === 'response_item' && line.payload?.type === 'message') {
      const role = line.payload.role;
      const text = flattenCodexContent(line.payload.content);
      if (!text) continue;
      // Skip Codex's injected system/developer prompts — they aren't user content.
      if (role === 'developer' || role === 'system') continue;
      if (role === 'user') {
        if (text.startsWith('<environment_context>') || text.startsWith('<user_instructions>')) continue;
        if (!firstPrompt) firstPrompt = text.slice(0, 500);
        userMessageCount += 1;
        messages.push({
          id: randomUUID(),
          role: 'user',
          content: text,
          timestamp: Number.isNaN(ts) ? Date.now() : ts,
          model: null,
        });
        messageCount += 1;
      } else if (role === 'assistant') {
        messages.push({
          id: randomUUID(),
          role: 'assistant',
          content: text.slice(0, 4000),
          timestamp: Number.isNaN(ts) ? Date.now() : ts,
          model: lastModel,
        });
        messageCount += 1;
      }
    } else if (line.type === 'event_msg' && line.payload?.type === 'token_count') {
      // Codex emits cumulative running totals in `total_token_usage`. Always
      // overwrite with the latest snapshot rather than summing.
      // `reasoning_output_tokens` is billed too, so fold it into output.
      const info = line.payload.info;
      if (info?.total_token_usage) {
        const t = info.total_token_usage;
        inputTokens = t.input_tokens ?? inputTokens;
        outputTokens = (t.output_tokens ?? 0) + (t.reasoning_output_tokens ?? 0);
        cacheRead = t.cached_input_tokens ?? cacheRead;
      } else if (info?.last_token_usage) {
        const t = info.last_token_usage;
        inputTokens += t.input_tokens ?? 0;
        outputTokens += (t.output_tokens ?? 0) + (t.reasoning_output_tokens ?? 0);
        cacheRead += t.cached_input_tokens ?? 0;
      }

      // Codex also ships rate-limit (quota) info inline — capture the freshest snapshot.
      const rl = line.payload.rate_limits;
      if (rl && !Number.isNaN(ts)) {
        if (latestQuotaTs === null || ts > latestQuotaTs) {
          latestQuotaTs = ts;
          latestQuota = {
            plan_type: rl.plan_type ?? null,
            primary_pct: rl.primary?.used_percent ?? null,
            primary_window_minutes: rl.primary?.window_minutes ?? null,
            primary_resets_at: rl.primary?.resets_at ?? null,
            secondary_pct: rl.secondary?.used_percent ?? null,
            secondary_window_minutes: rl.secondary?.window_minutes ?? null,
            secondary_resets_at: rl.secondary?.resets_at ?? null,
          };
        }
      }
    }
  }

  if (!sessionId || startedAt === null || endedAt === null) return null;
  if (!cwd) cwd = process.cwd();

  const project = resolveProject(cwd);
  upsertProject(project, endedAt);

  const cost = estimateCost({
    model: lastModel,
    inputTokens,
    outputTokens,
    cacheReadTokens: cacheRead,
  });

  db.prepare(`
    INSERT OR REPLACE INTO sessions (
      id, provider, project_id, cwd, started_at, ended_at, duration_ms, model,
      message_count, user_message_count, input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens, est_cost_usd, first_prompt,
      summary, summary_generated, heuristic_title, category, keywords,
      git_branch, source_path
    ) VALUES (?, 'codex', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?,
      (SELECT summary FROM sessions WHERE id = ?),
      (SELECT summary_generated FROM sessions WHERE id = ?),
      (SELECT heuristic_title FROM sessions WHERE id = ?),
      (SELECT category FROM sessions WHERE id = ?),
      (SELECT keywords FROM sessions WHERE id = ?),
      ?, ?)
  `).run(
    sessionId,
    project.id,
    cwd,
    startedAt,
    endedAt,
    endedAt - startedAt,
    lastModel,
    messageCount,
    userMessageCount,
    inputTokens,
    outputTokens,
    cacheRead,
    cost,
    firstPrompt,
    sessionId,
    sessionId,
    sessionId,
    sessionId,
    sessionId,
    gitBranch,
    file,
  );

  db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
  const insertMessage = db.prepare(
    'INSERT INTO messages (id, session_id, role, content, timestamp, model) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const tx = db.transaction((rows: typeof messages) => {
    for (const m of rows) insertMessage.run(m.id, sessionId, m.role, m.content, m.timestamp, m.model);
  });
  tx(messages);

  // Persist freshest quota snapshot for the codex provider.
  if (latestQuota && latestQuotaTs !== null) {
    const existing = db
      .prepare('SELECT observed_at FROM quota_snapshots WHERE provider = ?')
      .get('codex') as { observed_at: number } | undefined;
    if (!existing || latestQuotaTs > existing.observed_at) {
      db.prepare(
        `INSERT OR REPLACE INTO quota_snapshots (
          provider, observed_at, plan_type,
          primary_pct, primary_window_minutes, primary_resets_at,
          secondary_pct, secondary_window_minutes, secondary_resets_at
        ) VALUES ('codex', ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        latestQuotaTs,
        latestQuota.plan_type,
        latestQuota.primary_pct,
        latestQuota.primary_window_minutes,
        latestQuota.primary_resets_at,
        latestQuota.secondary_pct,
        latestQuota.secondary_window_minutes,
        latestQuota.secondary_resets_at,
      );
    }
  }

  return { sessionId, messageCount };
}
