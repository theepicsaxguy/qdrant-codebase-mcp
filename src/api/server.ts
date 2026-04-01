import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from '../config/schema';
import type { EmbeddingAdapter } from '../embedding/types';
import {
  registerOperationalRoutes,
  registerRepoRoutes,
  registerSearchRoutes,
} from './server.routes';
import type { IndexingCoordinator } from '../indexing/coordinator';
import type { QdrantAdapter } from '../qdrant/adapter';
import type { SearchService } from '../search/service';

export interface ServerDependencies {
  config: AppConfig;
  qdrantAdapters: Map<string, QdrantAdapter>;
  embedding: EmbeddingAdapter;
  coordinator: IndexingCoordinator;
  searchService: SearchService;
}

export function buildServer(dependencies: ServerDependencies): FastifyInstance {
  const server = Fastify({
    logger: false,
    requestIdHeader: 'x-request-id',
    trustProxy: true,
  });

  registerOperationalRoutes(server, dependencies);
  registerRepoRoutes(server, dependencies);
  registerSearchRoutes(server, dependencies.searchService);

  return server;
}
