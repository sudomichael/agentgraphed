import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    rootPath: text('root_path').notNull(),
    gitRemote: text('git_remote'),
    firstSeen: integer('first_seen').notNull(),
    lastActive: integer('last_active').notNull(),
  },
  (t) => ({
    rootIdx: uniqueIndex('projects_root_idx').on(t.rootPath),
  }),
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    projectId: text('project_id').notNull(),
    cwd: text('cwd').notNull(),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at').notNull(),
    durationMs: integer('duration_ms').notNull(),
    model: text('model'),
    messageCount: integer('message_count').notNull().default(0),
    userMessageCount: integer('user_message_count').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    estCostUsd: real('est_cost_usd').notNull().default(0),
    firstPrompt: text('first_prompt'),
    summary: text('summary'),
    summaryGenerated: integer('summary_generated').notNull().default(0),
    heuristicTitle: text('heuristic_title'),
    category: text('category'),
    keywords: text('keywords'),
    gitBranch: text('git_branch'),
    sourcePath: text('source_path').notNull(),
  },
  (t) => ({
    projectIdx: index('sessions_project_idx').on(t.projectId),
    startedIdx: index('sessions_started_idx').on(t.startedAt),
    providerIdx: index('sessions_provider_idx').on(t.provider),
    modelIdx: index('sessions_model_idx').on(t.model),
  }),
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    timestamp: integer('timestamp').notNull(),
    model: text('model'),
  },
  (t) => ({
    sessionIdx: index('messages_session_idx').on(t.sessionId),
    timestampIdx: index('messages_timestamp_idx').on(t.timestamp),
  }),
);

export const ingestState = sqliteTable('ingest_state', {
  sourcePath: text('source_path').primaryKey(),
  mtime: integer('mtime').notNull(),
  size: integer('size').notNull(),
  sessionId: text('session_id').notNull(),
  ingestedAt: integer('ingested_at').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const daySummaries = sqliteTable(
  'day_summaries',
  {
    day: text('day').primaryKey(),
    summary: text('summary').notNull(),
    generatedAt: integer('generated_at').notNull(),
  },
);

export const projectSummaries = sqliteTable('project_summaries', {
  projectId: text('project_id').primaryKey(),
  summary: text('summary').notNull(),
  generatedAt: integer('generated_at').notNull(),
});
