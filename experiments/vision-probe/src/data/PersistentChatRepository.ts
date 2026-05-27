import type { ISQLiteDriver } from '../adapters/NodeSQLiteDriver.js';
import type { PersistentChatMessage, PersistentChatRole, PersistentChatStatus } from '../types.js';

interface ChatMessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  status: string;
  created_at: number;
}

export class PersistentChatRepository {
  constructor(private readonly driver: ISQLiteDriver) {}

  async saveMessage(message: PersistentChatMessage): Promise<void> {
    await this.driver.execute(
      `INSERT OR REPLACE INTO chat_messages (id, session_id, role, content, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [message.id, message.sessionId, message.role, message.content, message.status, message.createdAt],
    );
  }

  async getMessages(sessionId: string): Promise<PersistentChatMessage[]> {
    const rows = await this.driver.query<ChatMessageRow>(
      `SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC`,
      [sessionId],
    );
    return rows.map((row) => this.mapRow(row));
  }

  async getMessageRange(sessionId: string, offset: number, limit: number): Promise<PersistentChatMessage[]> {
    const rows = await this.driver.query<ChatMessageRow>(
      `SELECT * FROM chat_messages
       WHERE session_id = ?
       ORDER BY created_at ASC
       LIMIT ? OFFSET ?`,
      [sessionId, limit, offset],
    );
    return rows.map((row) => this.mapRow(row));
  }

  async countMessages(sessionId: string): Promise<number> {
    const row = await this.driver.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM chat_messages WHERE session_id = ?`,
      [sessionId],
    );
    return row?.count ?? 0;
  }

  private mapRow(row: ChatMessageRow): PersistentChatMessage {
    return {
      id: row.id,
      sessionId: row.session_id,
      role: row.role as PersistentChatRole,
      content: row.content,
      status: row.status as PersistentChatStatus,
      createdAt: row.created_at,
    };
  }
}
