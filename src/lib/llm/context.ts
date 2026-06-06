import { getSqlite } from '../db/client';
import { getLlmConfig, complete } from './client';
import { findModel, estimateLlmCost } from './models';

const SYSTEM_PROMPT = `You write context primers that let a fresh AI coding session pick up exactly where a previous one left off.

You will receive a structured dump of a past session: the project, the original goal, and the user's messages in order.

Write a primer using this template (markdown, ~250-350 words total):

## Project
<one line: project name + what it is>

## Goal
<2-3 sentences describing what the user was trying to accomplish>

## What got done
<bullet list of concrete things that were built, fixed, or decided. Be specific — name files, components, decisions, not vague verbs>

## What's open
<bullet list of unfinished work, known bugs, or pending decisions>

## How to continue
<one short paragraph the new session can use as a starting instruction>

Rules:
- Be specific. Mention file paths, library names, decisions made.
- Skip pleasantries and AI replies.
- If something is genuinely unknown from the transcript, omit it rather than inventing.
- Return only the markdown primer, no preamble.`;

type Msg = { role: string; content: string };

function buildUserPrompt(opts: {
  projectName: string;
  cwd: string;
  firstPrompt: string | null;
  messages: Msg[];
}): string {
  const userMessages = opts.messages.filter((m) => m.role === 'user');
  const trimmed = userMessages
    .slice(0, 20)
    .map((m, i) => `[user msg ${i + 1}]\n${m.content.slice(0, 1500)}`)
    .join('\n\n');

  return `Project: ${opts.projectName}\nWorking directory: ${opts.cwd}\n\nOriginal goal:\n${(opts.firstPrompt || '(not captured)').slice(0, 1500)}\n\nUser messages from the session:\n${trimmed}`;
}

export async function getSessionContext(sessionId: string): Promise<{ context: string; generatedAt: number; model: string | null } | null> {
  const db = getSqlite();
  const row = db
    .prepare('SELECT context, generated_at, model FROM session_contexts WHERE session_id = ?')
    .get(sessionId) as { context: string; generated_at: number; model: string | null } | undefined;
  return row ? { context: row.context, generatedAt: row.generated_at, model: row.model } : null;
}

export async function generateSessionContext(sessionId: string, force = false): Promise<{ context: string; costUsd: number } | null> {
  const cfg = getLlmConfig();
  if (!cfg) return null;
  const db = getSqlite();

  if (!force) {
    const cached = await getSessionContext(sessionId);
    if (cached) return { context: cached.context, costUsd: 0 };
  }

  const session = db
    .prepare(
      `SELECT s.cwd, s.first_prompt, p.name AS project_name
       FROM sessions s JOIN projects p ON p.id = s.project_id WHERE s.id = ?`,
    )
    .get(sessionId) as { cwd: string; first_prompt: string | null; project_name: string } | undefined;
  if (!session) return null;

  const messages = db
    .prepare(
      "SELECT role, content FROM messages WHERE session_id = ? ORDER BY timestamp ASC LIMIT 100",
    )
    .all(sessionId) as Msg[];

  const userPrompt = buildUserPrompt({
    projectName: session.project_name,
    cwd: session.cwd,
    firstPrompt: session.first_prompt,
    messages,
  });

  const model = findModel(cfg.summarizerModel)!;
  const { text, inputTokens, outputTokens } = await complete({
    model: cfg.summarizerModel,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 800,
  });

  const cost = estimateLlmCost(model, inputTokens, outputTokens);
  db.prepare(
    'INSERT OR REPLACE INTO session_contexts (session_id, context, generated_at, model) VALUES (?, ?, ?, ?)',
  ).run(sessionId, text, Date.now(), model.id);

  return { context: text, costUsd: cost };
}
