import { describe, it, expect } from 'vitest';
import { AppConfigSchema } from '../../src/config/schema';

describe('AppConfigSchema', () => {
  const validBase = {
    qdrantUrl: 'http://localhost:6333',
    repos: [
      {
        repoId: 'my-repo',
        collectionName: 'my-repo-code',
        rootPath: '/tmp',
      },
    ],
  };

  it('accepts valid minimal config', () => {
    const result = AppConfigSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it('rejects missing repos', () => {
    const result = AppConfigSchema.safeParse({ qdrantUrl: 'http://localhost:6333', repos: [] });
    expect(result.success).toBe(false);
  });

  it('rejects invalid qdrantUrl', () => {
    const result = AppConfigSchema.safeParse({ ...validBase, qdrantUrl: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('applies default values', () => {
    const result = AppConfigSchema.safeParse(validBase);
    if (!result.success) throw new Error('Should succeed');
    expect(result.data.chunkMaxLines).toBe(150);
    expect(result.data.chunkOverlapLines).toBe(20);
    expect(result.data.port).toBe(3000);
    expect(result.data.embeddingModel).toBe('fast-bge-small-en-v1.5');
  });

  it('rejects repo without repoId', () => {
    const result = AppConfigSchema.safeParse({
      ...validBase,
      repos: [{ collectionName: 'c', rootPath: '/tmp' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative port', () => {
    const result = AppConfigSchema.safeParse({ ...validBase, port: -1 });
    expect(result.success).toBe(false);
  });

  it('accepts config with optional apiKey', () => {
    const result = AppConfigSchema.safeParse({ ...validBase, qdrantApiKey: 'secret' });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error();
    expect(result.data.qdrantApiKey).toBe('secret');
  });
});
