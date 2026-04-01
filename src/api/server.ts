import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply } from 'fastify';
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

  // Internal helper — returns typed response tuple
  const buildSearchResponse = async (
    body: unknown,
    repoIdOverride: string | undefined
  ): Promise<{ code: number; payload: unknown }> => {
    const parse = SearchBodySchema.safeParse(body);
    if (!parse.success) {
      return { code: 400, payload: { error: 'Invalid request', details: parse.error.issues } };
    }
    const req = { ...parse.data, repoId: repoIdOverride ?? parse.data.repoId };
    try {
      const result = await searchService.search(req);
      return { code: 200, payload: result };
    } catch (err) {
      logger.error({ err }, 'Search error');
      return { code: 500, payload: { error: 'Search failed', detail: String(err) } };
    }
  };

  server.post('/search', async (req, reply: FastifyReply) => {
    const res = await buildSearchResponse(req.body, undefined);
    return reply.code(res.code).send(res.payload);
  });

  server.post<{ Params: { repoId: string } }>(
    '/repos/:repoId/search',
    async (req, reply: FastifyReply) => {
      const res = await buildSearchResponse(req.body, req.params.repoId);
      return reply.code(res.code).send(res.payload);
    }
  );

  return server;
}
