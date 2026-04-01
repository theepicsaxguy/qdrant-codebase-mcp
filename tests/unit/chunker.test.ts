import { describe, it, expect } from 'vitest';
import { chunkCode } from '../../src/chunker/chunker';

describe('chunkCode', () => {
  const opts = { maxLines: 10, overlapLines: 2 };

  it('returns empty array for empty content', () => {
    const result = chunkCode({ repoId: 'r', filePath: 'f.ts', language: 'ts', content: '' }, opts);
    expect(result).toHaveLength(0);
  });

  it('returns empty array for whitespace-only content', () => {
    const result = chunkCode({ repoId: 'r', filePath: 'f.ts', language: 'ts', content: '   \n  ' }, opts);
    expect(result).toHaveLength(0);
  });

  it('returns single chunk for short file', () => {
    const content = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`).join('\n');
    const result = chunkCode({ repoId: 'r', filePath: 'f.ts', language: 'ts', content }, opts);
    expect(result).toHaveLength(1);
    expect(result[0]!.startLine).toBe(1);
    expect(result[0]!.endLine).toBe(5);
  });

  it('returns multiple chunks for large file', () => {
    const content = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join('\n');
    const result = chunkCode({ repoId: 'r', filePath: 'f.ts', language: 'ts', content }, opts);
    expect(result.length).toBeGreaterThan(1);
  });

  it('chunks have correct 1-based line numbers', () => {
    const content = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
    const result = chunkCode({ repoId: 'r', filePath: 'f.ts', language: 'ts', content }, opts);
    expect(result[0]!.startLine).toBe(1);
    expect(result[0]!.endLine).toBe(10);
  });

  it('generates deterministic and stable IDs', () => {
    const content = 'const x = 1;\nconst y = 2;';
    const r1 = chunkCode({ repoId: 'repo', filePath: 'src/a.ts', language: 'ts', content }, opts);
    const r2 = chunkCode({ repoId: 'repo', filePath: 'src/a.ts', language: 'ts', content }, opts);
    expect(r1[0]!.id).toBe(r2[0]!.id);
  });

  it('different repos produce different IDs for same file', () => {
    const content = 'const x = 1;';
    const r1 = chunkCode({ repoId: 'repo1', filePath: 'src/a.ts', language: 'ts', content }, opts);
    const r2 = chunkCode({ repoId: 'repo2', filePath: 'src/a.ts', language: 'ts', content }, opts);
    expect(r1[0]!.id).not.toBe(r2[0]!.id);
  });

  it('different file paths produce different IDs', () => {
    const content = 'const x = 1;';
    const r1 = chunkCode({ repoId: 'repo', filePath: 'src/a.ts', language: 'ts', content }, opts);
    const r2 = chunkCode({ repoId: 'repo', filePath: 'src/b.ts', language: 'ts', content }, opts);
    expect(r1[0]!.id).not.toBe(r2[0]!.id);
  });

  it('chunk content matches original lines', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `const x${i} = ${i};`);
    const content = lines.join('\n');
    const result = chunkCode({ repoId: 'r', filePath: 'f.ts', language: 'ts', content }, opts);
    expect(result[0]!.codeChunk).toBe(content);
  });

  it('generates content hash per chunk', () => {
    const content = 'const x = 1;\nconst y = 2;';
    const result = chunkCode({ repoId: 'r', filePath: 'f.ts', language: 'ts', content }, opts);
    expect(result[0]!.contentHash).toHaveLength(64); // sha256 hex
  });

  it('consecutive chunks overlap by configured lines', () => {
    const overlapOpts = { maxLines: 5, overlapLines: 2 };
    const content = Array.from({ length: 12 }, (_, i) => `line${i + 1}`).join('\n');
    const result = chunkCode({ repoId: 'r', filePath: 'f.ts', language: 'ts', content }, overlapOpts);
    // chunk[0] endLine=5, chunk[1] startLine should be 4 (advance = 5-2=3)
    expect(result[1]!.startLine).toBe(4);
  });

  it('handles CRLF line endings', () => {
    const content = 'line1\r\nline2\r\nline3';
    const result = chunkCode({ repoId: 'r', filePath: 'f.ts', language: 'ts', content }, opts);
    expect(result.length).toBeGreaterThan(0);
  });

  it('huge file produces bounded chunk count', () => {
    const content = Array.from({ length: 10000 }, (_, i) => `const x${i} = ${i};`).join('\n');
    const result = chunkCode({ repoId: 'r', filePath: 'f.ts', language: 'ts', content }, opts);
    // Each chunk covers 10 lines, advanced by 8 lines -> ~1250 chunks
    expect(result.length).toBeGreaterThan(100);
    expect(result.length).toBeLessThan(5000);
  });
});
