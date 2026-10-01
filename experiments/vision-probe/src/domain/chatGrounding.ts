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
