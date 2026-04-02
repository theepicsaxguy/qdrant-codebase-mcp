import { describe, expect, it, vi } from 'vitest';
import { handleTriggerReindex } from '../../src/mcp/tool-registration';

describe('handleTriggerReindex', () => {
  it('rejects reindex in search-only mode', () => {
    const response = handleTriggerReindex(
      {
        qdrantUrl: 'http://localhost:6333',
        embeddingProvider: 'openai-compatible',
        embeddingModel: 'text-embedding-3-small',
        embeddingBaseUrl: 'https://embeddings.example.com/v1',
        serverMode: 'search-only',
        chunkMaxLines: 150,
        chunkOverlapLines: 20,
        embeddingBatchSize: 64,
        watcherDebounceMs: 2000,
        maxFileSizeBytes: 1_000_000,
        minScore: 0.78,
        port: 3000,
        host: '0.0.0.0',
        repos: [{ repoId: 'webdocuments', collectionName: 'webdocuments' }],
      },
      new Map(),
      {
        isIndexing: vi.fn().mockReturnValue(false),
        fullIndex: vi.fn(),
      } as never,
      'webdocuments'
    );

    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain('unsupported');
  });
});
