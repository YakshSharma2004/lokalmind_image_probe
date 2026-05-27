import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type SQLiteBindValue = string | number | bigint | null | Uint8Array;

export interface ISQLiteDriver {
  execute(sql: string, params?: SQLiteBindValue[]): Promise<void>;
  query<T>(sql: string, params?: SQLiteBindValue[]): Promise<T[]>;
  get<T>(sql: string, params?: SQLiteBindValue[]): Promise<T | null>;
  transaction<T>(fn: (driver: ISQLiteDriver) => Promise<T>): Promise<T>;
  close(): void;
}

export class NodeSQLiteDriver implements ISQLiteDriver {
  private db: DatabaseSync | null = null;

  constructor(private readonly dbPath: string) {}

  async initialize(): Promise<void> {
    await mkdir(dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');
  }

  async execute(sql: string, params: SQLiteBindValue[] = []): Promise<void> {
    const db = this.requireDb();
    db.prepare(sql).run(...params);
  }

  async query<T>(sql: string, params: SQLiteBindValue[] = []): Promise<T[]> {
    const db = this.requireDb();
    return db.prepare(sql).all(...params) as T[];
  }

  async get<T>(sql: string, params: SQLiteBindValue[] = []): Promise<T | null> {
    const db = this.requireDb();
    return (db.prepare(sql).get(...params) as T | undefined) ?? null;
  }

  async transaction<T>(fn: (driver: ISQLiteDriver) => Promise<T>): Promise<T> {
    const db = this.requireDb();
    db.exec('BEGIN IMMEDIATE;');
    try {
      const result = await fn(this);
      db.exec('COMMIT;');
      return result;
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private requireDb(): DatabaseSync {
    if (!this.db) {
      throw new Error('NodeSQLiteDriver not initialized. Call initialize() first.');
    }
    return this.db;
  }
}
