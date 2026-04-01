import { describe, expect, it, vi } from 'vitest';

vi.mock('fastembed', () => ({
  FlagEmbedding: class {},
  EmbeddingModel: { CUSTOM: 'custom' },
}));

import { startIndexing } from '../../src/bootstrap';
import type { AppConfig } from '../../src/config/schema';

function createConfig(serverMode: AppConfig['serverMode']): AppConfig {
  return {
    qdrantUrl: 'http://localhost:6333',
    qdrantApiKey: undefined,
    embeddingProvider: 'fastembed',
    embeddingBaseUrl: undefined,
    embeddingApiKey: undefined,
    embeddingHeaders: undefined,
    embeddingDimensions: undefined,
    embeddingModel: 'fast-bge-small-en-v1.5',
    serverMode,
    chunkMaxLines: 150,
    chunkOverlapLines: 20,
    embeddingBatchSize: 64,
    watcherDebounceMs: 2000,
    maxFileSizeBytes: 1_000_000,
    minScore: 0.78,
    port: 3000,
    host: '0.0.0.0',
    repos: [
      {
        repoId: 'repo-a',
        collectionName: 'repo-a',
        rootPath: '/tmp/repo-a',
      },
      {
        repoId: 'repo-b',
        collectionName: 'repo-b',
        rootPath: '/tmp/repo-b',
      },
    ],
  };
}

describe('startIndexing', () => {
  it('skips watchers and indexing in search-only mode', () => {
    const watcherManager = { startAll: vi.fn() };
    const coordinator = { fullIndex: vi.fn() };

    startIndexing({
      config: createConfig('search-only'),
      embedding: {} as never,
      qdrantAdapters: new Map(),
      coordinator: coordinator as never,
      searchService: {} as never,
      watcherManager: watcherManager as never,
    });

    expect(watcherManager.startAll).not.toHaveBeenCalled();
    expect(coordinator.fullIndex).not.toHaveBeenCalled();
  });

  it('starts watchers and queues initial indexing in index-and-watch mode', () => {
    const watcherManager = { startAll: vi.fn() };
    const coordinator = {
      fullIndex: vi.fn().mockReturnValue(Promise.resolve()),
    };

    startIndexing({
      config: createConfig('index-and-watch'),
      embedding: {} as never,
      qdrantAdapters: new Map(),
      coordinator: coordinator as never,
      searchService: {} as never,
      watcherManager: watcherManager as never,
    });

    expect(watcherManager.startAll).toHaveBeenCalledOnce();
    expect(coordinator.fullIndex).toHaveBeenCalledTimes(2);
    expect(coordinator.fullIndex).toHaveBeenNthCalledWith(1, 'repo-a');
    expect(coordinator.fullIndex).toHaveBeenNthCalledWith(2, 'repo-b');
  });
});
