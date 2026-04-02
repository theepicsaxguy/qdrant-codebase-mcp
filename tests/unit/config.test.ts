import { describe, it, expect } from 'vitest';
import { AppConfigSchema, DEFAULT_FASTEMBED_MODEL } from '../../src/config/schema';

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
    expect(result.data.embeddingModel).toBe(DEFAULT_FASTEMBED_MODEL);
    expect(result.data.embeddingProvider).toBe('fastembed');
    expect(result.data.serverMode).toBe('index-and-watch');
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

  it('requires openai-compatible settings when that provider is selected', () => {
    const result = AppConfigSchema.safeParse({
      ...validBase,
      embeddingProvider: 'openai-compatible',
    });

    expect(result.success).toBe(false);
  });

  it('accepts openai-compatible config when required settings are present', () => {
    const result = AppConfigSchema.safeParse({
      ...validBase,
      embeddingProvider: 'openai-compatible',
      embeddingBaseUrl: 'https://embeddings.example.com/v1',
      embeddingModel: 'text-embedding-3-large',
      embeddingApiKey: 'secret',
      serverMode: 'search-only',
      repos: [{ repoId: 'webdocuments', collectionName: 'webdocuments' }],
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error();
    expect(result.data.serverMode).toBe('search-only');
  });

  it('requires rootPath when serverMode is index-and-watch', () => {
    const result = AppConfigSchema.safeParse({
      ...validBase,
      repos: [{ repoId: 'missing-root', collectionName: 'collection' }],
    });

    expect(result.success).toBe(false);
  });

  it('allows repos without rootPath when serverMode is search-only', () => {
    const result = AppConfigSchema.safeParse({
      ...validBase,
      serverMode: 'search-only',
      repos: [{ repoId: 'search-only', collectionName: 'search-only' }],
    });

    expect(result.success).toBe(true);
  });
});
