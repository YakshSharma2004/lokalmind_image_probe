# Multi-Dataset Local RAG & Multi-Turn Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an offline, multi-dataset document ingestion and RAG-grounded multi-turn local chat CLI (`npm run ingest` and `npm run chat -- --dataset <name>`) running entirely on local GGUF models & MiniLM embeddings via `llama-server` and SQLite.

**Architecture:** Extend `experiments/vision-probe` with a SQLite schema for dataset document chunks (`doc_chunks`), a robust text & JSON document chunker/ingestor, vector cosine similarity / keyword search retrieval domain, RAG grounding context builder integrated into `appContext.ts`, and CLI command support for ingestion and interactive multi-turn REPL chat.

**Tech Stack:** Node.js 26 (ESM), TypeScript, `node:sqlite`, `tsx`, `llama-server` (OpenAI-compatible HTTP endpoints for LLM and embeddings), `pngjs`. Zero new npm dependencies.

---

## Global Constraints

- **Project Root**: `experiments/vision-probe`
- **Node & Typescript**: Node >= 26.0.0, ESM (`"type": "module"`), strict TypeScript (`tsc --noEmit`)
- **CLI Patterns**: Hand-rolled `parseArgs` in `src/cli.ts`
- **Data Sovereignty**: 100% offline, local SQLite database, local `llama-server` endpoints
- **Database Driver**: `NodeSQLiteDriver` wrapping `node:sqlite` with `foreign_keys = ON`

---

## File Structure & File Ownership Map

| File Path | Description / Responsibility | Action |
|---|---|---|
| `src/caseTypes.ts` | Shared interfaces for document chunks, datasets, search results, and repository contracts | Create |
| `src/data/caseSchema.ts` | DDL for `doc_chunks` database table and index initialization | Create |
| `src/data/DocumentChunkRepository.ts` | SQLite repository implementation for `doc_chunks` | Create |
| `src/domain/documentChunking.ts` | Document text chunker supporting paragraph/sentence splitting with overlap & JSON document content extraction | Create |
| `src/domain/datasetRetrieval.ts` | Vector cosine similarity search & keyword fallback ranking over document chunks | Create |
| `src/domain/chatGrounding.ts` | Context formatting & RAG chunk retrieval builder for chat turns | Create |
| `src/domain/appContext.ts` | Context assembly supporting `groundingContext` block insertion | Modify |
| `src/domain/runPersistentChatTurn.ts` | Chat execution supporting optional RAG grounding context | Modify |
| `src/cli.ts` | CLI entry point: `ingest` command handler, `--dataset` CLI flags, interactive multi-turn chat REPL loop | Modify |
| `package.json` | Package scripts additions for `ingest` | Modify |

---

## Bite-Sized Implementation Tasks

### Task 1: Shared Types & Schema Definition (`caseTypes.ts` & `caseSchema.ts`)

**Files:**
- Create: `experiments/vision-probe/src/caseTypes.ts`
- Create: `experiments/vision-probe/src/data/caseSchema.ts`

**Interfaces:**
- Produces: `DocChunk`, `RetrievedChunk`, `DatasetSummary`, `IDocumentChunkRepository`, `initializeCaseSchema(driver)`

- [ ] **Step 1: Create `src/caseTypes.ts`**

```typescript
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
```

- [ ] **Step 2: Create `src/data/caseSchema.ts`**

```typescript
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
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS with 0 errors.

---

### Task 2: Document Chunking & Ingestion Extractor (`documentChunking.ts`)

**Files:**
- Create: `experiments/vision-probe/src/domain/documentChunking.ts`

**Interfaces:**
- Produces: `defaultChunkOptions`, `chunkText(text, options)`, `extractJsonDocuments(jsonContent, defaultSourceFile)`

- [ ] **Step 1: Implement `src/domain/documentChunking.ts`**

```typescript
import type { ChunkOptions } from '../caseTypes.js';

export const defaultChunkOptions: ChunkOptions = {
  maxChars: 1200,
  overlap: 150,
};

export interface ExtractedDocument {
  sourceFile: string;
  title: string;
  url: string;
  content: string;
}

export function extractJsonDocuments(jsonContent: string, defaultSourceFile: string): ExtractedDocument[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonContent);
  } catch {
    return [];
  }

  const items = Array.isArray(parsed) ? parsed : [parsed];
  const results: ExtractedDocument[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const content = typeof rec.content === 'string' ? rec.content.trim() : '';
    if (!content) continue;

    const title = typeof rec.title === 'string' ? rec.title.trim() : '';
    const url = typeof rec.url === 'string' ? rec.url.trim() : '';
    const idStr = rec.id !== undefined ? String(rec.id) : `${i + 1}`;
    const sourceFile = title ? `${title} (${url || defaultSourceFile})` : `${defaultSourceFile}#${idStr}`;

    results.push({
      sourceFile,
      title,
      url,
      content,
    });
  }

  return results;
}

export function chunkText(text: string, options?: Partial<ChunkOptions>): string[] {
  const opts: ChunkOptions = { ...defaultChunkOptions, ...options };
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const rawBlocks: string[] = [];

  for (const para of paragraphs) {
    if (para.length <= opts.maxChars) {
      rawBlocks.push(para);
    } else {
      let current = para;
      while (current.length > opts.maxChars) {
        let cutIndex = current.lastIndexOf('. ', opts.maxChars);
        if (cutIndex === -1 || cutIndex < opts.maxChars * 0.3) {
          cutIndex = current.lastIndexOf(' ', opts.maxChars);
        }
        if (cutIndex === -1 || cutIndex < opts.maxChars * 0.3) {
          cutIndex = opts.maxChars;
        }
        rawBlocks.push(current.slice(0, cutIndex + 1).trim());
        current = current.slice(cutIndex + 1).trim();
      }
      if (current) rawBlocks.push(current);
    }
  }

  const chunks: string[] = [];
  let currentChunk = '';

  for (const block of rawBlocks) {
    if (!currentChunk) {
      currentChunk = block;
    } else if ((currentChunk + '\n\n' + block).length <= opts.maxChars) {
      currentChunk += '\n\n' + block;
    } else {
      chunks.push(currentChunk);
      const overlapText = currentChunk.slice(-opts.overlap);
      currentChunk = overlapText ? `${overlapText}\n\n${block}` : block;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}
```

- [ ] **Step 2: Verify with Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS with 0 errors.

---

### Task 3: SQLite Document Chunk Repository (`DocumentChunkRepository.ts`)

**Files:**
- Create: `experiments/vision-probe/src/data/DocumentChunkRepository.ts`

**Interfaces:**
- Consumes: `ISQLiteDriver`, `DocChunk`, `IDocumentChunkRepository`, `DatasetSummary`

- [ ] **Step 1: Implement `src/data/DocumentChunkRepository.ts`**

```typescript
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
```

- [ ] **Step 2: Verify with Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS with 0 errors.

---

### Task 4: Retrieval Engine with Vector Cosine & Keyword Search (`datasetRetrieval.ts`)

**Files:**
- Create: `experiments/vision-probe/src/domain/datasetRetrieval.ts`

**Interfaces:**
- Consumes: `IDocumentChunkRepository`, `CaseEmbeddingClient`, `DocChunk`, `RetrievedChunk`
- Produces: `cosineSimilarity(a, b)`, `keywordScore(query, content)`, `retrieveChunks(params)`

- [ ] **Step 1: Implement `src/domain/datasetRetrieval.ts`**

```typescript
import type { CaseEmbeddingClient, IDocumentChunkRepository, RetrievedChunk } from '../caseTypes.js';

export function parseEmbedding(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      : [];
  } catch {
    return [];
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const valA = a[i]!;
    const valB = b[i]!;
    dot += valA * valB;
    magA += valA * valA;
    magB += valB * valB;
  }
  const normA = Math.sqrt(magA);
  const normB = Math.sqrt(magB);
  return normA && normB ? dot / (normA * normB) : 0;
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'from', 'you', 'are', 'was', 'were', 'what', 'where', 'how']);

export function keywordScore(query: string, content: string): number {
  const cleanQuery = query.toLowerCase().replace(/[^\w\s]/g, '');
  const terms = cleanQuery.split(/\s+/).filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
  if (terms.length === 0) return 0;

  const cleanContent = content.toLowerCase();
  let matches = 0;
  for (const term of terms) {
    if (cleanContent.includes(term)) {
      matches++;
    }
  }

  const baseRatio = matches / terms.length;
  return Math.min(1.0, baseRatio);
}

export async function retrieveChunks(params: {
  repository: IDocumentChunkRepository;
  embedding: CaseEmbeddingClient | null;
  dataset: string;
  query: string;
  topK?: number;
  minSimilarity?: number;
}): Promise<RetrievedChunk[]> {
  const topK = params.topK ?? 4;
  const minSimilarity = params.minSimilarity ?? 0.25;
  const chunks = await params.repository.getChunksByDataset(params.dataset);
  if (chunks.length === 0) return [];

  let queryEmbedding: number[] = [];
  if (params.embedding && params.embedding.isReady()) {
    try {
      queryEmbedding = await params.embedding.embed(params.query);
    } catch {
      queryEmbedding = [];
    }
  }

  if (queryEmbedding.length > 0) {
    const scored: RetrievedChunk[] = [];
    for (const chunk of chunks) {
      const vec = parseEmbedding(chunk.embedding);
      if (vec.length > 0) {
        const sim = cosineSimilarity(queryEmbedding, vec);
        if (sim >= minSimilarity) {
          scored.push({ chunk, similarity: sim, method: 'embedding' });
        }
      }
    }
    if (scored.length > 0) {
      scored.sort((a, b) => b.similarity - a.similarity);
      return scored.slice(0, topK);
    }
  }

  // Keyword fallback
  const keywordScored: RetrievedChunk[] = [];
  for (const chunk of chunks) {
    const score = keywordScore(params.query, chunk.content);
    if (score > 0) {
      keywordScored.push({ chunk, similarity: score, method: 'keyword' });
    }
  }

  keywordScored.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    if (a.chunk.sourceFile !== b.chunk.sourceFile) return a.chunk.sourceFile.localeCompare(b.chunk.sourceFile);
    return a.chunk.chunkIndex - b.chunk.chunkIndex;
  });

  return keywordScored.slice(0, topK);
}
```

- [ ] **Step 2: Verify with Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS with 0 errors.

---

### Task 5: RAG Chat Grounding Builder & App Context Update (`chatGrounding.ts`, `appContext.ts`, `runPersistentChatTurn.ts`)

**Files:**
- Create: `experiments/vision-probe/src/domain/chatGrounding.ts`
- Modify: `experiments/vision-probe/src/domain/appContext.ts`
- Modify: `experiments/vision-probe/src/domain/runPersistentChatTurn.ts`

**Interfaces:**
- Produces: `formatGroundingBlock(chunks, dataset)`, `buildChatGrounding(params)`
- Updates: `buildContextMessages` in `appContext.ts` to accept `groundingContext?: string`

- [ ] **Step 1: Create `src/domain/chatGrounding.ts`**

```typescript
import type { CaseEmbeddingClient, IDocumentChunkRepository, RetrievedChunk } from '../caseTypes.js';
import { retrieveChunks } from './datasetRetrieval.js';

export function formatGroundingBlock(chunks: RetrievedChunk[], dataset: string): string {
  if (chunks.length === 0) return '';
  const lines: string[] = [
    `\n[Reference documents from dataset: ${dataset}]`,
    'Instructions: Answer the user question accurately using the reference information below when relevant. Cite document sources using [<dataset>/<source_file>] when referring to facts from them. If the answer is not contained in the reference documents, clearly say so.',
    '',
  ];

  for (const item of chunks) {
    const c = item.chunk;
    lines.push(`--- [${dataset}/${c.sourceFile} #${c.chunkIndex}] ---`);
    lines.push(c.content.trim());
    lines.push('');
  }

  return lines.join('\n');
}

export async function buildChatGrounding(params: {
  repository: IDocumentChunkRepository;
  embedding: CaseEmbeddingClient | null;
  dataset: string;
  message: string;
  topK?: number;
}): Promise<{ block: string; chunkCount: number }> {
  const chunks = await retrieveChunks({
    repository: params.repository,
    embedding: params.embedding,
    dataset: params.dataset,
    query: params.message,
    topK: params.topK ?? 3,
  });

  if (chunks.length === 0) {
    return { block: '', chunkCount: 0 };
  }

  return {
    block: formatGroundingBlock(chunks, params.dataset),
    chunkCount: chunks.length,
  };
}
```

- [ ] **Step 2: Modify `src/domain/appContext.ts`**

Add `groundingContext?: string;` to `interface ContextBudget` (line 88+).
Inside `buildContextMessages`, after line 181 (crossSessionMemories block), inject:
```typescript
  if (params.groundingContext && params.groundingContext.trim()) {
    const BUDGET_GROUNDING = 1200;
    const grounding = estimateTokens(params.groundingContext) <= BUDGET_GROUNDING
      ? params.groundingContext
      : params.groundingContext.slice(0, Math.floor(BUDGET_GROUNDING * 4));
    systemParts.push(`\n${grounding}`);
  }
```

- [ ] **Step 3: Modify `src/domain/runPersistentChatTurn.ts`**

Add `groundingContext?: string;` to `RunPersistentChatTurnParams`.
Pass `groundingContext: params.groundingContext` into `buildContextMessages(...)`.

- [ ] **Step 4: Verify with Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS with 0 errors.

---

### Task 6: CLI Command Wiring & Interactive Multi-Turn REPL (`cli.ts` & `package.json`)

**Files:**
- Modify: `experiments/vision-probe/src/cli.ts`
- Modify: `experiments/vision-probe/package.json`

**Interfaces:**
- Extends `ParsedArgs` with `dataset?: string`, `path?: string`, `replace?: boolean`
- Updates `parseArgs`, `validateChatArgs`, `main`
- Implements `runIngest(args)`
- Updates `runChat(args)` to support `--dataset` and launch interactive multi-turn REPL loop when `--message` is omitted.

- [ ] **Step 1: Update `package.json`**

Add `"ingest": "tsx src/cli.ts ingest"` to `scripts` in `package.json`.

- [ ] **Step 2: Update `ParsedArgs` and `parseArgs` in `src/cli.ts`**

1. Update `command` union: `'probe' | 'report' | 'download-model' | 'download-embedding' | 'list-models' | 'print-server-command' | 'chat' | 'memory-report' | 'ingest' | 'help'`.
2. Add fields to `ParsedArgs`: `dataset?: string; path?: string; replace?: boolean;`.
3. Add cases in `parseArgs`:
   - `--dataset`: `args.dataset = next; i++;`
   - `--path`: `args.path = next; i++;`
   - `--replace`: `args.replace = true;`

- [ ] **Step 3: Update `validateChatArgs` in `src/cli.ts`**

Allow embedding server flags if `args.withMemory` OR `args.dataset` is set:
```typescript
  if (!args.withMemory && !args.dataset && (args.embeddingServer || args.autoEmbeddingServer || args.noEmbeddings)) {
    throw new Error('Embedding options require either --with-memory or --dataset.');
  }
```

- [ ] **Step 4: Implement `runIngest(args)` in `src/cli.ts`**

```typescript
async function runIngest(args: ParsedArgs): Promise<number> {
  if (!args.dataset) throw new Error('ingest requires --dataset <name>');
  if (!args.path) throw new Error('ingest requires --path <fileOrDirectory>');

  const targetPath = resolveFromCwd(args.path);
  const targetExists = await exists(targetPath);
  if (!targetExists) throw new Error(`Path not found: ${targetPath}`);

  const driver = new NodeSQLiteDriver(defaultDbPath);
  await driver.initialize();
  await initializeCaseSchema(driver);
  const chunkRepo = new DocumentChunkRepository(driver);

  if (args.replace) {
    console.log(`Replacing existing dataset: "${args.dataset}"...`);
    await chunkRepo.deleteDataset(args.dataset);
  }

  let embeddingAdapter: LlamaServerEmbeddingAdapter | null = null;
  if (!args.noEmbeddings && args.embeddingServer) {
    embeddingAdapter = new LlamaServerEmbeddingAdapter(args.embeddingServer);
    await embeddingAdapter.initialize();
    console.log(`Using embedding server: ${args.embeddingServer}`);
  }

  const statInfo = await stat(targetPath);
  const filesToProcess: string[] = [];
  if (statInfo.isDirectory()) {
    const entries = await readdir(targetPath);
    for (const entry of entries) {
      if (entry.endsWith('.txt') || entry.endsWith('.md') || entry.endsWith('.json')) {
        filesToProcess.push(resolve(targetPath, entry));
      }
    }
  } else {
    filesToProcess.push(targetPath);
  }

  if (filesToProcess.length === 0) {
    console.log('No .txt, .md, or .json files found to ingest.');
    driver.close();
    return 1;
  }

  let totalChunksIngested = 0;
  let totalEmbedded = 0;

  for (const filePath of filesToProcess) {
    const rawContent = await readFile(filePath, 'utf-8');
    const baseName = basename(filePath);

    let docItems: Array<{ sourceFile: string; content: string }> = [];
    if (filePath.endsWith('.json')) {
      const extracted = extractJsonDocuments(rawContent, baseName);
      docItems = extracted.map((d) => ({ sourceFile: d.sourceFile, content: d.content }));
    } else {
      docItems = [{ sourceFile: baseName, content: rawContent }];
    }

    let fileChunkCount = 0;
    let fileEmbeddedCount = 0;

    for (const item of docItems) {
      const textChunks = chunkText(item.content);
      for (let idx = 0; idx < textChunks.length; idx++) {
        const text = textChunks[idx]!;
        let embeddingJson: string | null = null;
        if (embeddingAdapter && embeddingAdapter.isReady()) {
          try {
            const vec = await embeddingAdapter.embed(text);
            if (vec.length > 0) {
              embeddingJson = JSON.stringify(vec);
              fileEmbeddedCount++;
            }
          } catch {
            // fallback
          }
        }
        await chunkRepo.insertChunk({
          id: randomUUID(),
          dataset: args.dataset,
          sourceFile: item.sourceFile,
          chunkIndex: idx + 1,
          content: text,
          embedding: embeddingJson,
          createdAt: Date.now(),
        });
        fileChunkCount++;
      }
    }

    console.log(`  ${baseName}: ${fileChunkCount} chunks (${fileEmbeddedCount} embedded)`);
    totalChunksIngested += fileChunkCount;
    totalEmbedded += fileEmbeddedCount;
  }

  console.log(`Ingested dataset "${args.dataset}": ${totalChunksIngested} total chunks (${totalEmbedded} embedded).`);
  driver.close();
  return 0;
}
```

- [ ] **Step 5: Update `runChat` for Multi-Turn REPL & Grounding**

In `runChat(args)`:
1. Initialize `initializeCaseSchema(driver)`.
2. If `args.dataset` is set, create `DocumentChunkRepository` and retrieve `groundingContext` via `buildChatGrounding`.
3. If `args.message` is supplied, execute standard single-turn `runPersistentChatTurn`.
4. If `args.message` is omitted, enter an interactive REPL loop using `readline/promises`:
```typescript
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log(`Entering chat session with model ${modelId}. (Type 'exit' to quit)\n`);

    while (true) {
      const userInput = await rl.question('> ');
      if (!userInput.trim() || userInput.trim().toLowerCase() === 'exit') break;

      let groundingContext = '';
      if (args.dataset) {
        const grounding = await buildChatGrounding({
          repository: chunkRepo,
          embedding: embeddingAdapter,
          dataset: args.dataset,
          message: userInput,
        });
        groundingContext = grounding.block;
      }

      const turnResult = await runPersistentChatTurn({
        ...chatTurnParams,
        message: userInput,
        groundingContext,
      });

      console.log(`\n${turnResult.assistantMessage.content}\n`);
    }
    rl.close();
```

- [ ] **Step 6: Update `main()` dispatch in `src/cli.ts`**

Add dispatch for `ingest`:
```typescript
  const code =
    args.command === 'ingest'
      ? await runIngest(args)
      : args.command === 'probe'
      ...
```

- [ ] **Step 7: Verify with Typecheck & Build**

Run: `npx tsc --noEmit`
Expected: PASS with 0 errors.

---

## Verification Plan

### Automated Verification
1. `npx tsc --noEmit` (Must compile cleanly with zero errors)
2. `npm run test` (Existing tests must continue to pass)

### Manual Verification Flow
1. **Ingest Test**:
   ```bash
   npx tsx src/cli.ts ingest --dataset troubled-monk --path "C:/Users/ysharma1/OneDrive - Red Deer College/Documents/GitHub/troubled-monk-rag/backend/data/Knowledge_base.json" --replace
   ```
   *Expected output*: Processes `Knowledge_base.json`, chunks document content, inserts chunks into SQLite, prints chunk count summary.

2. **RAG Grounded Chat Test**:
   ```bash
   npx tsx src/cli.ts chat --model qwen3.5-4b --server http://127.0.0.1:8080 --dataset troubled-monk --message "What events are hosted at Troubled Monk?"
   ```
   *Expected output*: Answer generated by local LLM citing `[troubled-monk/... source_file]` references from the ingested JSON dataset.

3. **Multi-Turn Interactive REPL Test**:
   ```bash
   npx tsx src/cli.ts chat --model qwen3.5-4b --server http://127.0.0.1:8080 --dataset troubled-monk
   ```
   *Expected output*: Interactive prompt `> `, allows multi-turn questions, responds grounded on dataset context until typing `exit`.
