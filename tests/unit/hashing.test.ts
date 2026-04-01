import { describe, it, expect } from 'vitest';
import { chunkId, contentHash, detectLanguage, buildPathSegments, safeResolveWithinRoot, normalizePath } from '../../src/utils/hashing';
import * as path from 'path';

describe('chunkId', () => {
  it('returns a 64-char hex string', () => {
    const id = chunkId('repo', 'src/a.ts', 1, 10);
    expect(id).toHaveLength(64);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(chunkId('r', 'f.ts', 1, 10)).toBe(chunkId('r', 'f.ts', 1, 10));
  });

  it('differs for different inputs', () => {
    expect(chunkId('r', 'f.ts', 1, 10)).not.toBe(chunkId('r', 'f.ts', 11, 20));
    expect(chunkId('r1', 'f.ts', 1, 10)).not.toBe(chunkId('r2', 'f.ts', 1, 10));
  });
});

describe('contentHash', () => {
  it('returns a 64-char hex string', () => {
    expect(contentHash('hello world')).toHaveLength(64);
  });

  it('is deterministic', () => {
    expect(contentHash('foo')).toBe(contentHash('foo'));
  });

  it('differs for different inputs', () => {
    expect(contentHash('foo')).not.toBe(contentHash('bar'));
  });
});

describe('detectLanguage', () => {
  it('detects typescript', () => {
    expect(detectLanguage('src/index.ts')).toBe('typescript');
  });
  it('detects tsx', () => {
    expect(detectLanguage('src/App.tsx')).toBe('typescript');
  });
  it('detects csharp', () => {
    expect(detectLanguage('Handler.cs')).toBe('csharp');
  });
  it('detects python', () => {
    expect(detectLanguage('main.py')).toBe('python');
  });
  it('falls back to text for unknown ext', () => {
    expect(detectLanguage('file.xyz')).toBe('text');
  });
  it('is case insensitive for extension', () => {
    expect(detectLanguage('FILE.TS')).toBe('typescript');
  });
});

describe('buildPathSegments', () => {
  it('builds segments from nested path', () => {
    const seg = buildPathSegments('src/Application/Chat/Handler.cs');
    expect(seg['0']).toBe('src');
    expect(seg['1']).toBe('Application');
    expect(seg['2']).toBe('Chat');
    expect(seg['3']).toBe('Handler.cs');
  });

  it('handles file at root', () => {
    const seg = buildPathSegments('index.ts');
    expect(seg['0']).toBe('index.ts');
    expect(Object.keys(seg)).toHaveLength(1);
  });
});

describe('safeResolveWithinRoot', () => {
  const root = '/home/user/project';

  it('allows file within root', () => {
    const result = safeResolveWithinRoot(root, 'src/index.ts');
    expect(result).toBe(path.join(root, 'src/index.ts'));
  });

  it('blocks path traversal', () => {
    const result = safeResolveWithinRoot(root, '../../etc/passwd');
    expect(result).toBeNull();
  });

  it('allows file directly in root', () => {
    const result = safeResolveWithinRoot(root, 'package.json');
    expect(result).toBe(path.join(root, 'package.json'));
  });
});

describe('normalizePath', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalizePath('src\\utils\\hashing.ts')).toBe('src/utils/hashing.ts');
  });

  it('passes through forward-slash paths unchanged', () => {
    expect(normalizePath('src/utils/hashing.ts')).toBe('src/utils/hashing.ts');
  });
});
