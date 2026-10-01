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
  return normA && normB ? dot / (normA * magB ? normA * normB : 1) : 0;
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
