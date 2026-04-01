import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ServerDependencies } from './server';
import { logger } from '../logger';
import { registry } from '../metrics';
import type { SearchService } from '../search/service';

const SearchBodySchema = z.object({
  query: z.string().min(1).max(2000),
  repoId: z.string().optional(),
  directoryPrefix: z.string().optional(),
  language: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  minScore: z.number().min(0).max(1).optional(),
});

interface SearchRouteResponse {
  code: number;
  payload: unknown;
}

export function registerOperationalRoutes(
  server: FastifyInstance,
  dependencies: ServerDependencies
): void {
  server.get('/health', (_req, reply) => {
    reply.code(200).send({ status: 'ok' });
  });

  server.get('/ready', async (_req, reply) => {
    try {
      await Promise.all(
        [...dependencies.qdrantAdapters.values()].map(async (adapter) => {
          await adapter.ping();
        })
      );
      reply.code(200).send({ status: 'ready' });
      return;
    } catch (error) {
      logger.error({ err: error }, 'Readiness check failed');
      reply.code(503).send({ status: 'not ready', error: String(error) });
      return;
    }
  });

  server.get('/metrics', async (_req, reply) => {
    const metrics = await registry.metrics();
    reply.header('Content-Type', registry.contentType).send(metrics);
  });
}

export function registerRepoRoutes(
  server: FastifyInstance,
  dependencies: ServerDependencies
): void {
  server.get('/repos', (_req, reply) => {
    const repos = dependencies.config.repos.map((repo) => ({
      repoId: repo.repoId,
      collectionName: repo.collectionName,
      rootPath: repo.rootPath,
    }));
    reply.code(200).send({ repos });
  });

  registerRepoStatusRoute(server, dependencies);
  registerRepoIndexActionRoute(server, dependencies, 'reindex');
  registerRepoIndexActionRoute(server, dependencies, 'rescan');
  registerDeleteIndexRoute(server, dependencies);
}

export function registerSearchRoutes(server: FastifyInstance, searchService: SearchService): void {
  server.post('/search', async (request, reply: FastifyReply) => {
    const response = await buildSearchResponse(searchService, request.body);
    reply.code(response.code).send(response.payload);
  });

  server.post<{ Params: { repoId: string } }>(
    '/repos/:repoId/search',
    async (request, reply: FastifyReply) => {
      const response = await buildSearchResponse(
        searchService,
        request.body,
        request.params.repoId
      );
      reply.code(response.code).send(response.payload);
    }
  );
}

function registerRepoStatusRoute(server: FastifyInstance, dependencies: ServerDependencies): void {
  server.get<{ Params: { repoId: string } }>('/repos/:repoId/status', async (request, reply) => {
    const adapter = dependencies.qdrantAdapters.get(request.params.repoId);
    const repo = dependencies.config.repos.find((item) => item.repoId === request.params.repoId);
    if (!adapter || !repo) {
      reply.code(404).send({ error: `Unknown repoId: ${request.params.repoId}` });
      return;
    }

    const status = await adapter.getIndexingStatus();
    reply.code(200).send({
      repoId: request.params.repoId,
      collectionName: repo.collectionName,
      model: dependencies.embedding.modelName,
      vectorSize: dependencies.embedding.vectorSize,
      indexingInProgress: dependencies.coordinator.isIndexing(request.params.repoId),
      status: status ?? defaultIndexingStatus(),
    });
  });
}

function registerRepoIndexActionRoute(
  server: FastifyInstance,
  dependencies: ServerDependencies,
  action: 'reindex' | 'rescan'
): void {
  server.post<{ Params: { repoId: string } }>(`/repos/:repoId/${action}`, (request, reply) => {
    const { repoId } = request.params;
    if (!dependencies.qdrantAdapters.has(repoId)) {
      reply.code(404).send({ error: `Unknown repoId: ${repoId}` });
      return;
    }

    if (dependencies.coordinator.isIndexing(repoId)) {
      reply.code(409).send({ error: 'Indexing already in progress' });
      return;
    }

    setImmediate(() => {
      dependencies.coordinator.fullIndex(repoId).catch((error) => {
        logger.error(
          { repoId, err: error },
          `${action === 'reindex' ? 'Reindex' : 'Rescan'} failed`
        );
      });
    });

    reply.code(202).send({ status: `${action} started`, repoId });
  });
}

function registerDeleteIndexRoute(server: FastifyInstance, dependencies: ServerDependencies): void {
  server.delete<{ Params: { repoId: string } }>('/repos/:repoId/index', async (request, reply) => {
    const adapter = dependencies.qdrantAdapters.get(request.params.repoId);
    if (!adapter) {
      reply.code(404).send({ error: `Unknown repoId: ${request.params.repoId}` });
      return;
    }

    await adapter.deleteCollection();
    reply.code(200).send({ status: 'index deleted', repoId: request.params.repoId });
  });
}

async function buildSearchResponse(
  searchService: SearchService,
  body: unknown,
  repoIdOverride?: string
): Promise<SearchRouteResponse> {
  const parseResult = SearchBodySchema.safeParse(body);
  if (!parseResult.success) {
    return {
      code: 400,
      payload: { error: 'Invalid request', details: parseResult.error.issues },
    };
  }

  try {
    const result = await searchService.search({
      ...parseResult.data,
      repoId: repoIdOverride ?? parseResult.data.repoId,
    });
    return { code: 200, payload: result };
  } catch (error) {
    logger.error({ err: error }, 'Search error');
    return { code: 500, payload: { error: 'Search failed', detail: String(error) } };
  }
}

function defaultIndexingStatus(): {
  indexing_complete: boolean;
  started_at: null;
  completed_at: null;
  last_error: null;
} {
  return {
    indexing_complete: false,
    started_at: null,
    completed_at: null,
    last_error: null,
  };
}
