import type { ISQLiteDriver } from './schema.js';

export async function initializeCaseSchema(driver: ISQLiteDriver): Promise<void> {
  await driver.execute(`
    CREATE TABLE IF NOT EXISTS doc_chunks (
      id TEXT PRIMARY KEY,
      dataset TEXT NOT NULL,
      source_file TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  await driver.execute(`
    CREATE INDEX IF NOT EXISTS idx_doc_chunks_dataset ON doc_chunks(dataset, source_file, chunk_index);
  `);
}
