import type { LlamaServerEmbeddingAdapter } from '../adapters/LlamaServerEmbeddingAdapter.js';
import type { DesktopMemoryRepository } from '../data/DesktopMemoryRepository.js';
import type { SessionMemory } from '../types.js';

const DEICTIC_REFERENCE_REGEX = /\b(this|that|those|it|again|earlier|before|previous|same)\b/i;
const SELF_REFERENCE_REGEX = /\b(i|me|my|mine)\b/i;
const GENERIC_KNOWLEDGE_OPENING_REGEX =
  /^(what|who|when|where|why|how)\s+(is|are|was|were|do|does|did|can|could|should|would)\b/i;
const MIN_SEMANTIC_CONFIDENCE = 0.3;

function requiresMemory(userMessage: string, sessionTurnCount: number): boolean {
  if (!userMessage.trim()) return false;
  const text = userMessage.toLowerCase().trim();
  const tokenCount = text.split(/\s+/).filter(Boolean).length;
  const isQuestion = text.includes('?') || GENERIC_KNOWLEDGE_OPENING_REGEX.test(text);
  const hasSelfReference = SELF_REFERENCE_REGEX.test(text);
  const hasContextReference = DEICTIC_REFERENCE_REGEX.test(text);

  if (isQuestion && !hasSelfReference && !hasContextReference) return false;
  if (hasSelfReference) return sessionTurnCount >= 2 || tokenCount >= 4;
  if (hasContextReference && tokenCount <= 12) return true;
  return false;
}

export class DesktopMemoryService {
  private embeddingService: LlamaServerEmbeddingAdapter | null = null;

  constructor(private readonly memoryRepository: DesktopMemoryRepository) {}

  setEmbeddingService(service: LlamaServerEmbeddingAdapter | null): void {
    this.embeddingService = service;
  }

  async getRelevantMemories(userMessage: string, sessionTurnCount = 0): Promise<SessionMemory[]> {
    const all = await this.memoryRepository.getAllSessionMemories();
    const pinned = all.filter((memory) => memory.isPinned);
    const nonPinned = all.filter((memory) => !memory.isPinned);

    if (!requiresMemory(userMessage, sessionTurnCount)) return [];

    if (!this.embeddingService?.isReady()) {
      return [...pinned, ...[...nonPinned].sort((a, b) => b.score - a.score).slice(0, 5)];
    }

    let queryVec: number[] = [];
    try {
      queryVec = await this.embeddingService.embed(userMessage);
    } catch {
      queryVec = [];
    }

    if (queryVec.length === 0) {
      return [...pinned, ...[...nonPinned].sort((a, b) => b.score - a.score).slice(0, 5)];
    }

    const ranked = nonPinned
      .map((memory) => {
        const embedding = parseEmbedding(memory.embedding);
        const semantic = cosineSimilarity(queryVec, embedding);
        const finalScore = 0.6 * semantic + 0.4 * memory.score;
        return { memory, semantic, finalScore };
      })
      .filter(({ semantic }) => semantic >= MIN_SEMANTIC_CONFIDENCE)
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, 5)
      .map(({ memory }) => memory);

    return [...pinned, ...ranked];
  }

  async embedAndSave(memoryId: string, summaryText: string): Promise<void> {
    if (!this.embeddingService?.isReady()) return;
    let vector: number[] = [];
    try {
      vector = await this.embeddingService.embed(summaryText);
    } catch {
      vector = [];
    }
    if (vector.length === 0) return;
    await this.memoryRepository.updateSessionMemory(memoryId, {
      embedding: JSON.stringify(vector),
    });
  }

  async evictIfNeeded(max = 10): Promise<void> {
    const count = await this.memoryRepository.countNonPinnedMemories();
    if (count <= max) return;
    await this.memoryRepository.deleteLowestScoredMemory();
  }
}

function parseEmbedding(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      : [];
  } catch {
    return [];
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0;
  const dot = a.reduce((sum, ai, i) => sum + ai * (b[i] ?? 0), 0);
  const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
  const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
  return magA && magB ? dot / (magA * magB) : 0;
}
