import type { ISQLiteDriver } from '../adapters/NodeSQLiteDriver.js';

export async function initializeSchema(driver: ISQLiteDriver): Promise<void> {
  await driver.execute(`
    CREATE TABLE IF NOT EXISTS probe_runs (
      id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL,
      model_label TEXT NOT NULL,
      server_url TEXT NOT NULL,
      server_command TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      status TEXT NOT NULL,
      notes TEXT
    );
  `);

  await driver.execute(`
    CREATE TABLE IF NOT EXISTS probe_results (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      test_id TEXT NOT NULL,
      image_path TEXT NOT NULL,
      prompt TEXT NOT NULL,
      with_image INTEGER NOT NULL,
      response_text TEXT,
      expected_signals TEXT NOT NULL,
      forbidden_signals TEXT NOT NULL,
      score TEXT NOT NULL,
      latency_ms INTEGER,
      error TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES probe_runs(id) ON DELETE CASCADE
    );
  `);

  await driver.execute(`
    CREATE INDEX IF NOT EXISTS idx_probe_results_run ON probe_results(run_id, test_id, with_image);
  `);

  await driver.execute(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'done',
      created_at INTEGER NOT NULL
    );
  `);

  await driver.execute(`
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);
  `);

  await driver.execute(`
    CREATE TABLE IF NOT EXISTS session_summaries (
      id            TEXT PRIMARY KEY,
      session_id    TEXT NOT NULL,
      bucket_index  INTEGER NOT NULL,
      summary       TEXT NOT NULL,
      turn_start    INTEGER NOT NULL,
      turn_end      INTEGER NOT NULL,
      created_at    INTEGER NOT NULL
    );
  `);

  await driver.execute(`
    CREATE INDEX IF NOT EXISTS idx_summaries_session ON session_summaries(session_id, bucket_index);
  `);

  await driver.execute(`
    CREATE TABLE IF NOT EXISTS session_memories (
      id             TEXT PRIMARY KEY,
      session_id     TEXT NOT NULL,
      session_title  TEXT NOT NULL,
      summary        TEXT NOT NULL,
      embedding      TEXT,
      score          REAL NOT NULL DEFAULT 0.0,
      is_pinned      INTEGER NOT NULL DEFAULT 0,
      is_user_edited INTEGER NOT NULL DEFAULT 0,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    );
  `);

  await driver.execute(`
    CREATE INDEX IF NOT EXISTS idx_session_memories_rank ON session_memories(is_pinned, score, created_at);
  `);
}
