import { describe, expect, it, vi } from 'vitest';
import { SearchService } from '../../src/search/service';
import type { EmbeddingAdapter } from '../../src/embedding/types';
import type { QdrantAdapter } from '../../src/qdrant/adapter';

describe('SearchService', () => {
  it('searches a dedicated collection with the active embedding provider', async () => {
    const embedding: EmbeddingAdapter = {
      provider: 'openai-compatible',
      modelName: 'text-embedding-3-small',
      vectorSize: 3,
      initialize: vi.fn(),
      embedBatch: vi.fn(),
      embedQuery: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    };
    const adapter = {
      search: vi.fn().mockResolvedValue([
        {
          repoId: 'webdocuments',
          filePath: 'docs/page.md',
          startLine: 1,
          endLine: 8,
          codeChunk: 'hello world',
          score: 0.98,
        },
      ]),
    } as unknown as QdrantAdapter;
    const service = new SearchService(new Map([['webdocuments', adapter]]), embedding, 0.7);

    const result = await service.search({ query: 'hello', repoId: 'webdocuments' });

    expect(embedding.embedQuery).toHaveBeenCalledWith('hello');
    expect(adapter.search).toHaveBeenCalledWith({
      queryVector: [0.1, 0.2, 0.3],
      directoryPrefix: undefined,
      language: undefined,
      limit: 10,
      minScore: 0.7,
    });
    expect(result.results[0]?.repoId).toBe('webdocuments');
  });
});
