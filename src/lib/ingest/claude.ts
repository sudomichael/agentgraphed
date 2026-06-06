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

function walkJsonl(dir: string, out: string[]) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkJsonl(p, out);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
  }
}

type ClaudeLine = {
  type: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  message?: {
    role?: string;
    content?: unknown;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
};

function flattenContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c;
        if (c && typeof c === 'object') {
          const o = c as { type?: string; text?: string; content?: unknown };
          if (o.type === 'text' && typeof o.text === 'string') return o.text;
          if (o.type === 'tool_use') return '';
          if (o.type === 'tool_result' && typeof o.content === 'string') return '';
          return '';
        }
        return '';
      })
      .join('\n')
      .trim();
  }
  return '';
}

// Limit-reached events appear in two shapes:
//   1) system message with content like "Claude AI usage limit reached|1780687599"
//   2) tool_result inside a user message with the same string
// Returns the unix epoch reset time, or null if not present.
// (Note: the substring "limit reached" also appears legitimately inside our own
// code/transcripts when discussing rate limits — we *only* match the pipe form
// that carries an explicit timestamp, which Claude uses for real limit events.)
function extractLimitResetTimestamp(text: string): number | null {
  const m = text.match(/limit reached\|(\d{9,11})/);
  if (!m) return null;
  const ts = parseInt(m[1], 10);
  if (!Number.isFinite(ts) || ts < 1_600_000_000) return null;
  return ts;
}

function scanContentForLimit(content: unknown): number | null {
  if (typeof content === 'string') return extractLimitResetTimestamp(content);
  if (Array.isArray(content)) {
    for (const c of content) {
      if (typeof c === 'string') {
        const r = extractLimitResetTimestamp(c);
        if (r) return r;
      } else if (c && typeof c === 'object') {
        const o = c as { type?: string; text?: string; content?: unknown };
        if (typeof o.text === 'string') {
          const r = extractLimitResetTimestamp(o.text);
          if (r) return r;
        }
        // tool_result.content can itself be a string or an array of text parts.
        if (o.type === 'tool_result') {
          const r = scanContentForLimit(o.content);
          if (r) return r;
        }
      }
    }
  }
  return null;
}

export type IngestStats = {
  filesScanned: number;
  filesIngested: number;
  sessions: number;
  messages: number;
};

export async function ingestClaude(opts: { onProgress?: (msg: string) => void } = {}): Promise<IngestStats> {
  const base =
    getSetting('claude_log_dir') ||
    process.env.AGENTGRAPHED_CLAUDE_DIR ||
    process.env.AGENTGRAPH_CLAUDE_DIR ||
    join(homedir(), '.claude', 'projects');
  const stats: IngestStats = { filesScanned: 0, filesIngested: 0, sessions: 0, messages: 0 };

  const files: string[] = [];
  const roots: string[] = [base, join(dataDir(), 'uploads', 'claude')];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    // Each root has a layout of <user-or-cwd>/<encoded-cwd-or-session>/<file.jsonl>
    // For the local Claude root, that's <encoded-cwd>/<session-uuid>.jsonl
    // For the uploads root, that's <user@host>/<encoded-cwd>/<session-uuid>.jsonl
    for (const dirent of readdirSync(root, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      walkJsonl(join(root, dirent.name), files);
    }
  }
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
      const result = await ingestOneFile(file);
      if (result) {
        upsertIngestState.run(file, Math.floor(st.mtimeMs), st.size, result.sessionId, Date.now());
        stats.filesIngested += 1;
        stats.sessions += 1;
        stats.messages += result.messageCount;
        opts.onProgress?.(`Claude: ${stats.filesIngested}/${files.length}`);
      }
    } catch (e) {
      // skip malformed file
      opts.onProgress?.(`Claude: skipped ${file} (${(e as Error).message})`);
    }
  }
  return stats;
}

async function ingestOneFile(file: string): Promise<{ sessionId: string; messageCount: number } | null> {
  const db = getSqlite();
  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });

  let sessionId: string | null = null;
  let cwd: string | null = null;
  let gitBranch: string | null = null;
  let startedAt: number | null = null;
  let endedAt: number | null = null;
  let lastModel: string | null = null;
  let messageCount = 0;
  let userMessageCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let firstPrompt: string | null = null;
  const limitEvents: Array<{ observed_at: number; reset_at: number; kind: string; raw: string }> = [];
  const messages: Array<{ id: string; role: string; content: string; timestamp: number; model: string | null }> = [];

  for await (const raw of rl) {
    if (!raw.trim()) continue;
    let line: ClaudeLine;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    if (line.sessionId && !sessionId) sessionId = line.sessionId;
    if (line.cwd && !cwd) cwd = line.cwd;
    if (line.gitBranch && !gitBranch) gitBranch = line.gitBranch;

    const ts = line.timestamp ? Date.parse(line.timestamp) : NaN;
    if (!Number.isNaN(ts)) {
      if (startedAt === null || ts < startedAt) startedAt = ts;
      if (endedAt === null || ts > endedAt) endedAt = ts;
    }

    // Limit-reached scan applies to both 'user' (tool_result) and 'system' lines.
    if (line.type === 'user' || line.type === 'system') {
      const resetAt = scanContentForLimit(line.message?.content);
      if (resetAt) {
        const observedAt = Number.isNaN(ts) ? Date.now() : ts;
        limitEvents.push({
          observed_at: observedAt,
          reset_at: resetAt * 1000,
          kind: line.type,
          raw: flattenContent(line.message?.content).slice(0, 500),
        });
      }
    }

    if (line.type === 'user' && line.message?.role === 'user') {
      const text = flattenContent(line.message.content);
      if (text && !text.startsWith('<environment_context>') && !text.startsWith('<command-')) {
        if (!firstPrompt) firstPrompt = text.slice(0, 500);
        userMessageCount += 1;
        messages.push({
          id: line.uuid || randomUUID(),
          role: 'user',
          content: text,
          timestamp: Number.isNaN(ts) ? Date.now() : ts,
          model: null,
        });
        messageCount += 1;
      }
    } else if (line.type === 'assistant' && line.message) {
      if (line.message.model) lastModel = line.message.model;
      const u = line.message.usage;
      if (u) {
        inputTokens += u.input_tokens || 0;
        outputTokens += u.output_tokens || 0;
        cacheRead += u.cache_read_input_tokens || 0;
        cacheWrite += u.cache_creation_input_tokens || 0;
      }
      const text = flattenContent(line.message.content);
      if (text) {
        messages.push({
          id: line.uuid || randomUUID(),
          role: 'assistant',
          content: text.slice(0, 4000),
          timestamp: Number.isNaN(ts) ? Date.now() : ts,
          model: line.message.model || null,
        });
        messageCount += 1;
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
    cacheWriteTokens: cacheWrite,
  });

  // Preserve any LLM-generated title/category from a prior classification pass.
  const insertSession = db.prepare(`
    INSERT OR REPLACE INTO sessions (
      id, provider, project_id, cwd, started_at, ended_at, duration_ms, model,
      message_count, user_message_count, input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens, est_cost_usd, first_prompt,
      summary, summary_generated, heuristic_title, category, keywords,
      git_branch, source_path
    ) VALUES (?, 'claude', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      (SELECT summary FROM sessions WHERE id = ?),
      (SELECT summary_generated FROM sessions WHERE id = ?),
      (SELECT heuristic_title FROM sessions WHERE id = ?),
      (SELECT category FROM sessions WHERE id = ?),
      (SELECT keywords FROM sessions WHERE id = ?),
      ?, ?)
  `);
  insertSession.run(
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
    cacheWrite,
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

  // Persist any limit-reached events from this session. Wipe-and-rewrite per
  // session keeps it idempotent on re-ingest without needing a composite key.
  db.prepare('DELETE FROM claude_limit_events WHERE session_id = ?').run(sessionId);
  if (limitEvents.length > 0) {
    const insertLimit = db.prepare(
      'INSERT INTO claude_limit_events (session_id, observed_at, reset_at, kind, raw) VALUES (?, ?, ?, ?, ?)',
    );
    const limitTx = db.transaction((rows: typeof limitEvents) => {
      for (const e of rows) insertLimit.run(sessionId, e.observed_at, e.reset_at, e.kind, e.raw);
    });
    limitTx(limitEvents);
  }

  return { sessionId, messageCount };
}
