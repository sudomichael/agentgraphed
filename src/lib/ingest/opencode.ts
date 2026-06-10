import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { getSqlite } from '../db/client';
import { resolveProject, upsertProject } from '../projects';
import { estimateCost } from '../pricing';
import { getSetting } from '../queries';
import type { IngestStats } from './claude';

const OPENCODE_DB_PATH = join(homedir(), '.local', 'share', 'opencode', 'opencode.db');

type OpenCodeSession = {
  id: string;
  project_id: string;
  title: string;
  model: string | null;
  cost: number;
  tokens_input: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  time_created: number;
  time_updated: number;
  agent: string | null;
};

type OpenCodeMessage = {
  id: string;
  session_id: string;
  time_created: number;
  data: string;
};

type MessageData = {
  role?: string;
  modelID?: string;
  providerID?: string;
  cost?: number;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
  text?: string;
  content?: unknown;
  error?: { name?: string; data?: { message?: string } };
  finish?: string;
};

function parseModelId(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const modelId = parsed?.id || null;
    const providerId = parsed?.providerID || null;
    if (modelId && providerId === 'opencode-go') return `opencode-go/${modelId}`;
    return modelId || raw;
  } catch {
    return raw;
  }
}

function getMessageContent(msgData: MessageData): string {
  if (msgData.text) return msgData.text;
  if (typeof msgData.content === 'string') return msgData.content;
  if (Array.isArray(msgData.content)) {
    return msgData.content
      .map((c: unknown) => {
        if (typeof c === 'string') return c;
        if (c && typeof c === 'object') {
          const o = c as { type?: string; text?: string };
          if (o.type === 'text' && o.text) return o.text;
        }
        return '';
      })
      .join('\n')
      .trim();
  }

  // OpenCode stores message metadata without full content in its local DB.
  // Generate a descriptive placeholder so conversations aren't empty bubbles.
  if (msgData.role === 'assistant') {
    const parts: string[] = [];
    if (msgData.finish === 'tool-calls') parts.push('tool calls');
    if (msgData.error) {
      const errMsg = msgData.error?.data?.message || msgData.error?.name || 'error';
      parts.push(errMsg);
    }
    const t = msgData.tokens;
    if (t && (t.input || t.output)) {
      parts.push(`${(t.input ?? 0) + (t.output ?? 0)} tokens`);
    }
    const detail = parts.length ? ` · ${parts.join(' · ')}` : '';
    return `[Assistant response${detail}]`;
  }
  if (msgData.role === 'user') {
    return '[User message]';
  }
  return '';
}

function getOpendb(): Database.Database | null {
  const base = getSetting('opencode_db_path') || process.env.AGENTGRAPHED_OPENCODE_DB_PATH || OPENCODE_DB_PATH;
  if (!existsSync(base)) return null;
  const db = new Database(base, { readonly: true });
  db.pragma('journal_mode = WAL');
  return db;
}

export async function ingestOpencode(opts: { onProgress?: (msg: string) => void } = {}): Promise<IngestStats> {
  const stats: IngestStats = { filesScanned: 0, filesIngested: 0, sessions: 0, messages: 0 };

  const ocDb = getOpendb();
  if (!ocDb) return stats;

  try {
    const db = getSqlite();

    const lastIngested = db
      .prepare("SELECT value FROM settings WHERE key = 'opencode_last_ingested'")
      .get() as { value: string } | undefined;
    const lastTs = lastIngested ? Number(lastIngested.value) : 0;

    const sessions = ocDb
      .prepare(
        `SELECT id, project_id, title, model, cost,
                tokens_input, tokens_output, tokens_reasoning,
                tokens_cache_read, tokens_cache_write,
                time_created, time_updated, agent
         FROM session
         WHERE time_updated > ?
           AND (tokens_input + tokens_output + tokens_cache_read + tokens_cache_write) > 0
         ORDER BY time_updated ASC`,
      )
      .all(lastTs) as OpenCodeSession[];

    stats.filesScanned = sessions.length;

    for (const sess of sessions) {
      stats.filesIngested += 1;
      const modelId = parseModelId(sess.model);

      const projectRow = ocDb
        .prepare('SELECT worktree, name FROM project WHERE id = ?')
        .get(sess.project_id) as { worktree: string; name: string } | undefined;
      const cwd = projectRow?.worktree || process.cwd();
      const project = resolveProject(cwd);
      upsertProject(project, sess.time_updated);

      const inputTokens = sess.tokens_input;
      const outputTokens = sess.tokens_output + sess.tokens_reasoning;
      const cacheRead = sess.tokens_cache_read;
      const cacheWrite = sess.tokens_cache_write;
      const cost = sess.cost > 0 ? sess.cost : estimateCost({
        model: modelId,
        inputTokens,
        outputTokens,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
      });

      const messages: Array<{
        id: string;
        session_id: string;
        role: string;
        content: string;
        timestamp: number;
        model: string | null;
        input_tokens: number;
        output_tokens: number;
        cache_read_tokens: number;
        cache_write_tokens: number;
        est_cost_usd: number;
      }> = [];

      const rawMessages = ocDb
        .prepare(
          `SELECT id, session_id, time_created, data
           FROM message
           WHERE session_id = ?
           ORDER BY time_created ASC`,
        )
        .all(sess.id) as OpenCodeMessage[];

      for (const raw of rawMessages) {
        let msgData: MessageData = {};
        try {
          msgData = JSON.parse(raw.data);
        } catch {
          continue;
        }
        const role = msgData.role || 'assistant';
        const content = getMessageContent(msgData);
        const msgModelId = msgData.modelID || modelId;
        const msgProviderId = msgData.providerID || null;
        const fullModelId = msgProviderId === 'opencode-go' ? `opencode-go/${msgModelId}` : msgModelId;

        const mInput = msgData.tokens?.input ?? 0;
        const mOutput = (msgData.tokens?.output ?? 0) + (msgData.tokens?.reasoning ?? 0);
        const mCacheR = msgData.tokens?.cache?.read ?? 0;
        const mCacheW = msgData.tokens?.cache?.write ?? 0;
        const mCost = msgData.cost ?? estimateCost({
          model: fullModelId,
          inputTokens: mInput,
          outputTokens: mOutput,
          cacheReadTokens: mCacheR,
          cacheWriteTokens: mCacheW,
        });

        messages.push({
          id: raw.id,
          session_id: sess.id,
          role,
          content: content.slice(0, 4000),
          timestamp: raw.time_created,
          model: fullModelId,
          input_tokens: mInput,
          output_tokens: mOutput,
          cache_read_tokens: mCacheR,
          cache_write_tokens: mCacheW,
          est_cost_usd: mCost,
        });
      }

      const firstUserMsg = messages.find((m) => m.role === 'user');
      const userContent = firstUserMsg?.content;
      const firstPrompt = userContent && !userContent.startsWith('[')
        ? userContent.slice(0, 500)
        : sess.title.slice(0, 500) || null;

      db.prepare(`
        INSERT OR REPLACE INTO sessions (
          id, provider, project_id, cwd, started_at, ended_at, duration_ms, model,
          message_count, user_message_count, input_tokens, output_tokens,
          cache_read_tokens, cache_write_tokens, est_cost_usd, first_prompt,
          summary, summary_generated, heuristic_title, category, keywords,
          git_branch, source_path
        ) VALUES (?, 'opencode', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          (SELECT summary FROM sessions WHERE id = ?),
          (SELECT summary_generated FROM sessions WHERE id = ?),
          ?, ?, ?,
          NULL, ?)
      `).run(
        sess.id,
        project.id,
        cwd,
        sess.time_created,
        sess.time_updated,
        sess.time_updated - sess.time_created,
        modelId,
        messages.length,
        messages.filter((m) => m.role === 'user').length,
        inputTokens,
        outputTokens,
        cacheRead,
        cacheWrite,
        cost,
        firstPrompt,
        sess.id, sess.id,
        sess.title || null,
        null, null,
        `opencode://session/${sess.id}`,
      );

      db.prepare('DELETE FROM messages WHERE session_id = ?').run(sess.id);
      const insertMessage = db.prepare(
        `INSERT INTO messages (
           id, session_id, role, content, timestamp, model,
           input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, est_cost_usd
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const tx = db.transaction((rows: typeof messages) => {
        for (const m of rows) insertMessage.run(
          m.id, m.session_id, m.role, m.content, m.timestamp, m.model,
          m.input_tokens, m.output_tokens, m.cache_read_tokens, m.cache_write_tokens, m.est_cost_usd,
        );
      });
      tx(messages);

      stats.sessions += 1;
      stats.messages += messages.length;
      opts.onProgress?.(`OpenCode: ${stats.sessions}/${sessions.length}`);
    }

    if (sessions.length > 0) {
      const maxTs = sessions[sessions.length - 1].time_updated;
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
        'opencode_last_ingested',
        String(maxTs),
      );
    }
  } finally {
    ocDb.close();
  }

  return stats;
}
