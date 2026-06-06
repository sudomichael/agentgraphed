import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { dbPath } from './paths';
import * as schema from './schema';

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

export function getDb() {
  if (_db) return _db;
  _sqlite = new Database(dbPath());
  _sqlite.pragma('journal_mode = WAL');
  _sqlite.pragma('synchronous = NORMAL');
  ensureSchema(_sqlite);
  _db = drizzle(_sqlite, { schema });
  return _db;
}

export function getSqlite(): Database.Database {
  if (!_sqlite) getDb();
  return _sqlite!;
}

function ensureSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL,
      git_remote TEXT,
      first_seen INTEGER NOT NULL,
      last_active INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS projects_root_idx ON projects(root_path);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      project_id TEXT NOT NULL,
      cwd TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      model TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      user_message_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      est_cost_usd REAL NOT NULL DEFAULT 0,
      first_prompt TEXT,
      summary TEXT,
      summary_generated INTEGER NOT NULL DEFAULT 0,
      heuristic_title TEXT,
      category TEXT,
      keywords TEXT,
      git_branch TEXT,
      source_path TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_project_idx ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS sessions_started_idx ON sessions(started_at);
    CREATE INDEX IF NOT EXISTS sessions_provider_idx ON sessions(provider);
    CREATE INDEX IF NOT EXISTS sessions_model_idx ON sessions(model);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      model TEXT
    );
    CREATE INDEX IF NOT EXISTS messages_session_idx ON messages(session_id);
    CREATE INDEX IF NOT EXISTS messages_timestamp_idx ON messages(timestamp);

    CREATE TABLE IF NOT EXISTS ingest_state (
      source_path TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      ingested_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS day_summaries (
      day TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      generated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_summaries (
      project_id TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      generated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_contexts (
      session_id TEXT PRIMARY KEY,
      context TEXT NOT NULL,
      generated_at INTEGER NOT NULL,
      model TEXT
    );

    CREATE TABLE IF NOT EXISTS quota_snapshots (
      provider TEXT PRIMARY KEY,
      observed_at INTEGER NOT NULL,
      plan_type TEXT,
      primary_pct REAL,
      primary_window_minutes INTEGER,
      primary_resets_at INTEGER,
      secondary_pct REAL,
      secondary_window_minutes INTEGER,
      secondary_resets_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS claude_limit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      observed_at INTEGER NOT NULL,
      reset_at INTEGER,
      kind TEXT NOT NULL,
      raw TEXT
    );
    CREATE INDEX IF NOT EXISTS claude_limit_events_observed_idx ON claude_limit_events(observed_at);
    CREATE INDEX IF NOT EXISTS claude_limit_events_session_idx ON claude_limit_events(session_id);
  `);

  // Lightweight migrations for existing DBs from earlier versions.
  const cols = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has('heuristic_title')) db.exec('ALTER TABLE sessions ADD COLUMN heuristic_title TEXT');
  if (!colNames.has('category')) db.exec('ALTER TABLE sessions ADD COLUMN category TEXT');
  if (!colNames.has('keywords')) db.exec('ALTER TABLE sessions ADD COLUMN keywords TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS sessions_category_idx ON sessions(category)');

  // categories: JSON array of labels. Backfill from the single-string `category`
  // column so existing classifications survive the migration.
  if (!colNames.has('categories')) {
    db.exec('ALTER TABLE sessions ADD COLUMN categories TEXT');
    db.exec(`UPDATE sessions
             SET categories = json_array(category)
             WHERE category IS NOT NULL AND categories IS NULL`);
  }
}
