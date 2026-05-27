import type { ISQLiteDriver, SQLiteBindValue } from '../adapters/NodeSQLiteDriver.js';
import type { SessionMemory, SessionSummary } from '../types.js';

interface SessionSummaryRow {
  id: string;
  session_id: string;
  bucket_index: number;
  summary: string;
  turn_start: number;
  turn_end: number;
  created_at: number;
}

interface SessionMemoryRow {
  id: string;
  session_id: string;
  session_title: string;
  summary: string;
  embedding: string | null;
  score: number;
  is_pinned: number;
  is_user_edited: number;
  created_at: number;
  updated_at: number;
}

export class DesktopMemoryRepository {
  constructor(private readonly driver: ISQLiteDriver) {}

  async saveSessionSummary(data: SessionSummary): Promise<void> {
    await this.driver.execute(
      `INSERT OR REPLACE INTO session_summaries
         (id, session_id, bucket_index, summary, turn_start, turn_end, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [data.id, data.sessionId, data.bucketIndex, data.summary, data.turnStart, data.turnEnd, data.createdAt],
    );
  }

  async getSessionSummaries(sessionId: string): Promise<SessionSummary[]> {
    const rows = await this.driver.query<SessionSummaryRow>(
      `SELECT * FROM session_summaries WHERE session_id = ? ORDER BY bucket_index ASC`,
      [sessionId],
    );
    return rows.map((row) => this.mapSummary(row));
  }

  async getSessionSummaryByBucket(sessionId: string, bucketIndex: number): Promise<SessionSummary | null> {
    const row = await this.driver.get<SessionSummaryRow>(
      `SELECT * FROM session_summaries WHERE session_id = ? AND bucket_index = ? LIMIT 1`,
      [sessionId, bucketIndex],
    );
    return row ? this.mapSummary(row) : null;
  }

  async saveSessionMemory(data: SessionMemory): Promise<void> {
    await this.driver.execute(
      `INSERT OR REPLACE INTO session_memories
         (id, session_id, session_title, summary, embedding, score, is_pinned, is_user_edited, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.id,
        data.sessionId,
        data.sessionTitle,
        data.summary,
        data.embedding,
        data.score,
        data.isPinned ? 1 : 0,
        data.isUserEdited ? 1 : 0,
        data.createdAt,
        data.updatedAt,
      ],
    );
  }

  async updateSessionMemory(
    id: string,
    fields: Partial<Pick<SessionMemory, 'summary' | 'embedding' | 'score' | 'isPinned' | 'isUserEdited'>>,
  ): Promise<void> {
    const setClauses: string[] = ['updated_at = ?'];
    const values: SQLiteBindValue[] = [Date.now()];

    if (fields.summary !== undefined) { setClauses.push('summary = ?'); values.push(fields.summary); }
    if (fields.embedding !== undefined) { setClauses.push('embedding = ?'); values.push(fields.embedding); }
    if (fields.score !== undefined) { setClauses.push('score = ?'); values.push(fields.score); }
    if (fields.isPinned !== undefined) { setClauses.push('is_pinned = ?'); values.push(fields.isPinned ? 1 : 0); }
    if (fields.isUserEdited !== undefined) { setClauses.push('is_user_edited = ?'); values.push(fields.isUserEdited ? 1 : 0); }

    values.push(id);
    await this.driver.execute(
      `UPDATE session_memories SET ${setClauses.join(', ')} WHERE id = ?`,
      values,
    );
  }

  async getSessionMemoryById(id: string): Promise<SessionMemory | null> {
    const row = await this.driver.get<SessionMemoryRow>(
      `SELECT * FROM session_memories WHERE id = ? LIMIT 1`,
      [id],
    );
    return row ? this.mapMemory(row) : null;
  }

  async deleteSessionMemory(id: string): Promise<void> {
    await this.driver.execute(`DELETE FROM session_memories WHERE id = ?`, [id]);
  }

  async getAllSessionMemories(): Promise<SessionMemory[]> {
    const rows = await this.driver.query<SessionMemoryRow>(
      `SELECT * FROM session_memories ORDER BY is_pinned DESC, created_at DESC`,
    );
    return rows.map((row) => this.mapMemory(row));
  }

  async deleteLowestScoredMemory(): Promise<void> {
    await this.driver.execute(
      `DELETE FROM session_memories
       WHERE id = (
         SELECT id FROM session_memories
         WHERE is_pinned = 0 AND is_user_edited = 0
         ORDER BY score ASC
         LIMIT 1
       )`,
    );
  }

  async countNonPinnedMemories(): Promise<number> {
    const row = await this.driver.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM session_memories WHERE is_pinned = 0 AND is_user_edited = 0`,
    );
    return row?.count ?? 0;
  }

  async countSessionSummaries(sessionId: string): Promise<number> {
    const row = await this.driver.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM session_summaries WHERE session_id = ?`,
      [sessionId],
    );
    return row?.count ?? 0;
  }

  async countSessionMemories(): Promise<number> {
    const row = await this.driver.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM session_memories`,
    );
    return row?.count ?? 0;
  }

  private mapSummary(row: SessionSummaryRow): SessionSummary {
    return {
      id: row.id,
      sessionId: row.session_id,
      bucketIndex: row.bucket_index,
      summary: row.summary,
      turnStart: row.turn_start,
      turnEnd: row.turn_end,
      createdAt: row.created_at,
    };
  }

  private mapMemory(row: SessionMemoryRow): SessionMemory {
    return {
      id: row.id,
      sessionId: row.session_id,
      sessionTitle: row.session_title,
      summary: row.summary,
      embedding: row.embedding,
      score: row.score,
      isPinned: row.is_pinned === 1,
      isUserEdited: row.is_user_edited === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
