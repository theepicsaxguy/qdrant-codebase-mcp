import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registry } from '../metrics';
import { logger } from '../logger';
import type { AppConfig } from '../config/schema';
import type { QdrantAdapter } from '../qdrant/adapter';
import type { EmbeddingAdapter } from '../embedding/adapter';
import type { IndexingCoordinator } from '../indexing/coordinator';
import type { SearchService } from '../search/service';
import { z } from 'zod';

const SearchBodySchema = z.object({
  query: z.string().min(1).max(2000),
  repoId: z.string().optional(),
  directoryPrefix: z.string().optional(),
  language: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  minScore: z.number().min(0).max(1).optional(),
});

export async function buildServer(
  config: AppConfig,
  qdrantAdapters: Map<string, QdrantAdapter>,
  embedding: EmbeddingAdapter,
  coordinator: IndexingCoordinator,
  searchService: SearchService
): Promise<FastifyInstance> {
  const server = Fastify({
    logger: false, // We use pino directly
    requestIdHeader: 'x-request-id',
    trustProxy: true,
  });

  // --- Health & ops ---

  server.get('/health', async (_req, reply) => {
    return reply.code(200).send({ status: 'ok' });
  });

  server.get('/ready', async (_req, reply) => {
    try {
      // Check all Qdrant adapters respond
      await Promise.all([...qdrantAdapters.values()].map((a) => a.ping()));
      return reply.code(200).send({ status: 'ready' });
    } catch (err) {
      logger.error({ err }, 'Readiness check failed');
      return reply.code(503).send({ status: 'not ready', error: String(err) });
    }
  });

  server.get('/metrics', async (_req, reply) => {
    return reply
      .header('Content-Type', registry.contentType)
      .send(await registry.metrics());
  });

  // --- Repo management ---

  server.get('/repos', async (_req, reply) => {
    const repos = config.repos.map((r) => ({
      repoId: r.repoId,
      collectionName: r.collectionName,
      rootPath: r.rootPath,
    }));
    return reply.code(200).send({ repos });
  });

  server.get<{ Params: { repoId: string } }>(
    '/repos/:repoId/status',
    async (req, reply) => {
      const { repoId } = req.params;
      const adapter = qdrantAdapters.get(repoId);
      if (!adapter) return reply.code(404).send({ error: `Unknown repoId: ${repoId}` });

      const status = await adapter.getIndexingStatus();
      const repo = config.repos.find((r) => r.repoId === repoId)!;
      return reply.code(200).send({
        repoId,
        collectionName: repo.collectionName,
        model: embedding.modelName,
        vectorSize: embedding.vectorSize,
        indexingInProgress: coordinator.isIndexing(repoId),
        status: status ?? { indexing_complete: false, started_at: null, completed_at: null, last_error: null },
      });
    }
  );

  server.post<{ Params: { repoId: string } }>(
    '/repos/:repoId/reindex',
    async (req, reply) => {
      const { repoId } = req.params;
      if (!qdrantAdapters.has(repoId))
        return reply.code(404).send({ error: `Unknown repoId: ${repoId}` });
      if (coordinator.isIndexing(repoId))
        return reply.code(409).send({ error: 'Indexing already in progress' });

      setImmediate(() => {
        coordinator.fullIndex(repoId).catch((err) =>
          logger.error({ repoId, err }, 'Reindex failed')
        );
      });
      return reply.code(202).send({ status: 'reindex started', repoId });
    }
  );

  server.post<{ Params: { repoId: string } }>(
    '/repos/:repoId/rescan',
    async (req, reply) => {
      const { repoId } = req.params;
      if (!qdrantAdapters.has(repoId))
        return reply.code(404).send({ error: `Unknown repoId: ${repoId}` });
      if (coordinator.isIndexing(repoId))
        return reply.code(409).send({ error: 'Indexing already in progress' });

      setImmediate(() => {
        coordinator.fullIndex(repoId).catch((err) =>
          logger.error({ repoId, err }, 'Rescan failed')
        );
      });
      return reply.code(202).send({ status: 'rescan started', repoId });
    }
  );

  server.delete<{ Params: { repoId: string } }>(
    '/repos/:repoId/index',
    async (req, reply) => {
      const { repoId } = req.params;
      const adapter = qdrantAdapters.get(repoId);
      if (!adapter) return reply.code(404).send({ error: `Unknown repoId: ${repoId}` });

      await adapter.deleteCollection();
      return reply.code(200).send({ status: 'index deleted', repoId });
    }
  );

  // --- Search ---

  const handleSearch = async (
    body: unknown,
    repoIdOverride: string | undefined,
    reply: Parameters<Parameters<typeof server.post>[1]>[1]
  ) => {
    const parse = SearchBodySchema.safeParse(body);
    if (!parse.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parse.error.issues });
    }
    const req = { ...parse.data, repoId: repoIdOverride ?? parse.data.repoId };
    try {
      const result = await searchService.search(req);
      return reply.code(200).send(result);
    } catch (err) {
      logger.error({ err }, 'Search error');
      return reply.code(500).send({ error: 'Search failed', detail: String(err) });
    }
  };

  server.post('/search', async (req, reply) =>
    handleSearch(req.body, undefined, reply)
  );

  server.post<{ Params: { repoId: string } }>(
    '/repos/:repoId/search',
    async (req, reply) => handleSearch(req.body, req.params.repoId, reply)
  );

  return server;
}
