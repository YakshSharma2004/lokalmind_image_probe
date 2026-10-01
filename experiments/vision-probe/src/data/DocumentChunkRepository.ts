import type { ISQLiteDriver } from './schema.js';
import type { DatasetSummary, DocChunk, IDocumentChunkRepository } from '../caseTypes.js';

interface DocChunkRow {
  id: string;
  dataset: string;
  source_file: string;
  chunk_index: number;
  content: string;
  embedding: string | null;
  created_at: number;
}

export class DocumentChunkRepository implements IDocumentChunkRepository {
  constructor(private readonly driver: ISQLiteDriver) {}

  async insertChunk(chunk: DocChunk): Promise<void> {
    await this.driver.execute(
      `INSERT INTO doc_chunks (id, dataset, source_file, chunk_index, content, embedding, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        chunk.id,
        chunk.dataset,
        chunk.sourceFile,
        chunk.chunkIndex,
        chunk.content,
        chunk.embedding,
        chunk.createdAt,
      ],
    );
  }

  async deleteDataset(dataset: string): Promise<void> {
    await this.driver.execute(`DELETE FROM doc_chunks WHERE dataset = ?`, [dataset]);
  }

  async countChunks(dataset: string): Promise<number> {
    const row = await this.driver.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM doc_chunks WHERE dataset = ?`,
      [dataset],
    );
    return row?.count ?? 0;
  }

  async getChunksByDataset(dataset: string): Promise<DocChunk[]> {
    const rows = await this.driver.query<DocChunkRow>(
      `SELECT id, dataset, source_file, chunk_index, content, embedding, created_at
       FROM doc_chunks
       WHERE dataset = ?
       ORDER BY source_file ASC, chunk_index ASC`,
      [dataset],
    );
    return rows.map((r) => this.mapChunk(r));
  }

  async listDatasets(): Promise<DatasetSummary[]> {
    const rows = await this.driver.query<{ dataset: string; chunk_count: number; embedded_count: number }>(
      `SELECT dataset,
              COUNT(*) as chunk_count,
              SUM(CASE WHEN embedding IS NOT NULL AND embedding != '' THEN 1 ELSE 0 END) as embedded_count
       FROM doc_chunks
       GROUP BY dataset
       ORDER BY dataset ASC`,
    );
    return rows.map((r) => ({
      dataset: r.dataset,
      chunkCount: Number(r.chunk_count),
      embeddedCount: Number(r.embedded_count),
    }));
  }

  private mapChunk(row: DocChunkRow): DocChunk {
    return {
      id: row.id,
      dataset: row.dataset,
      sourceFile: row.source_file,
      chunkIndex: Number(row.chunk_index),
      content: row.content,
      embedding: row.embedding,
      createdAt: Number(row.created_at),
    };
  }
}
