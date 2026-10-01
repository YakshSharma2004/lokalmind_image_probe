import type { ProbeMessage, ProbeRequestConfig, ProbeResponse } from './types.js';

export interface CaseLlmClient {
  generateResponse(messages: ProbeMessage[], config: ProbeRequestConfig): Promise<ProbeResponse>;
}

export interface CaseEmbeddingClient {
  isReady(): boolean;
  embed(text: string, timeoutMs?: number): Promise<number[]>;
}

export interface DocChunk {
  id: string;
  dataset: string;
  sourceFile: string;
  chunkIndex: number;
  content: string;
  embedding: string | null;
  createdAt: number;
}

export interface RetrievedChunk {
  chunk: DocChunk;
  similarity: number;
  method: 'embedding' | 'keyword';
}

export interface DatasetSummary {
  dataset: string;
  chunkCount: number;
  embeddedCount: number;
}

export interface ChunkOptions {
  maxChars: number;
  overlap: number;
}

export interface IDocumentChunkRepository {
  insertChunk(chunk: DocChunk): Promise<void>;
  deleteDataset(dataset: string): Promise<void>;
  countChunks(dataset: string): Promise<number>;
  getChunksByDataset(dataset: string): Promise<DocChunk[]>;
  listDatasets(): Promise<DatasetSummary[]>;
}
