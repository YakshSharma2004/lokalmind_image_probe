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
