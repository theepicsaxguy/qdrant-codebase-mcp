import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../src/api/server';
import type { AppConfig } from '../../src/config/schema';

function createConfig(serverMode: AppConfig['serverMode']): AppConfig {
  return {
    qdrantUrl: 'http://localhost:6333',
    embeddingProvider: serverMode === 'search-only' ? 'openai-compatible' : 'fastembed',
    embeddingModel:
      serverMode === 'search-only' ? 'text-embedding-3-small' : 'fast-bge-small-en-v1.5',
    embeddingBaseUrl:
      serverMode === 'search-only' ? 'https://embeddings.example.com/v1' : undefined,
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
        repoId: 'webdocuments',
        collectionName: 'webdocuments',
        rootPath: serverMode === 'search-only' ? undefined : '/tmp/repo',
      },
    ],
  };
}

describe('server routes', () => {
  const servers = new Set<ReturnType<typeof buildServer>>();

  afterEach(async () => {
    for (const server of servers) {
      await server.close();
    }
    servers.clear();
  });

  it('reports server mode and embedding metadata in repo status', async () => {
    const server = buildServer({
      config: createConfig('search-only'),
      qdrantAdapters: new Map([
        [
          'webdocuments',
          {
            getIndexingStatus: vi.fn().mockResolvedValue(null),
            ping: vi.fn(),
          },
        ],
      ]) as never,
      embedding: {
        provider: 'openai-compatible',
        modelName: 'text-embedding-3-small',
        vectorSize: 1536,
        initialize: vi.fn(),
        embedBatch: vi.fn(),
        embedQuery: vi.fn(),
      },
      coordinator: {
        isIndexing: vi.fn().mockReturnValue(false),
      } as never,
      searchService: {
        search: vi.fn(),
      } as never,
    });
    servers.add(server);

    const response = await server.inject({ method: 'GET', url: '/repos/webdocuments/status' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      repoId: 'webdocuments',
      serverMode: 'search-only',
      embeddingProvider: 'openai-compatible',
      model: 'text-embedding-3-small',
      vectorSize: 1536,
    });
  });

  it('rejects reindex routes in search-only mode', async () => {
    const server = buildServer({
      config: createConfig('search-only'),
      qdrantAdapters: new Map([['webdocuments', { ping: vi.fn() }]]) as never,
      embedding: {
        provider: 'openai-compatible',
        modelName: 'text-embedding-3-small',
        vectorSize: 1536,
        initialize: vi.fn(),
        embedBatch: vi.fn(),
        embedQuery: vi.fn(),
      },
      coordinator: {
        isIndexing: vi.fn().mockReturnValue(false),
        fullIndex: vi.fn(),
      } as never,
      searchService: {
        search: vi.fn(),
      } as never,
    });
    servers.add(server);

    const response = await server.inject({ method: 'POST', url: '/repos/webdocuments/reindex' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: expect.stringContaining('unsupported'),
    });
  });
});
