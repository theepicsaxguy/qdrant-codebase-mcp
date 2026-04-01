import { createHash } from 'crypto';
import { detectLanguage, chunkId, contentHash } from '../utils/hashing';
import type { Chunk, ChunkInput } from '../types';

export interface ChunkerOptions {
  maxLines: number;
  overlapLines: number;
}

export function chunkCode(input: ChunkInput, opts: ChunkerOptions): Chunk[] {
  const { repoId, filePath, content } = input;
  const language = input.language || detectLanguage(filePath);
  const { maxLines, overlapLines } = opts;

  const lines = content.split('\n');
  if (lines.length === 0 || content.trim() === '') return [];

  const chunks: Chunk[] = [];
  let start = 0;

  while (start < lines.length) {
    const end = Math.min(start + maxLines - 1, lines.length - 1);
    const sliceLines = lines.slice(start, end + 1);
    const codeChunk = sliceLines.join('\n');

    // 1-based line numbers
    const startLine = start + 1;
    const endLine = end + 1;

    chunks.push({
      id: chunkId(repoId, filePath, startLine, endLine),
      repoId,
      filePath,
      language,
      codeChunk,
      startLine,
      endLine,
      contentHash: contentHash(codeChunk),
    });

    if (end >= lines.length - 1) break;

    // Advance by (maxLines - overlapLines)
    const advance = Math.max(1, maxLines - overlapLines);
    start += advance;
  }

  return chunks;
}

export function hashFile(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
