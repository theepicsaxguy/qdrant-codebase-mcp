import { loadConfig } from './config/loader';
import { QdrantAdapter } from './qdrant/adapter';
import { EmbeddingAdapter } from './embedding/adapter';
import { IndexingCoordinator } from './indexing/coordinator';
import { FileWatcherManager } from './watcher/watcher';
import { SearchService } from './search/service';
import { buildServer } from './api/server';
import { logger } from './logger';

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info({ repos: config.repos.map((r) => r.repoId) }, 'Config loaded');

  // 1. Initialize embedding model
  const embedding = new EmbeddingAdapter(config.embeddingModel, config.embeddingBatchSize);
  await embedding.initialize();
  logger.info({ model: embedding.modelName, vectorSize: embedding.vectorSize }, 'Embedding ready');

  // 2. Initialize Qdrant adapters per repo
  const qdrantAdapters = new Map<string, QdrantAdapter>();
  for (const repo of config.repos) {
    const adapter = new QdrantAdapter(
      config.qdrantUrl,
      repo.collectionName,
      embedding.vectorSize,
      config.qdrantApiKey
    );
    await adapter.ping().catch(() => {
      throw new Error(`Cannot connect to Qdrant at ${config.qdrantUrl}`);
    });
    await adapter.initialize();
    qdrantAdapters.set(repo.repoId, adapter);
  }
  logger.info('Qdrant adapters ready');

  // 3. Build services
  const coordinator = new IndexingCoordinator(config, qdrantAdapters, embedding);
  const searchService = new SearchService(qdrantAdapters, embedding);
  const watcherManager = new FileWatcherManager(config, qdrantAdapters, coordinator);

  // 4. Start HTTP server
  const server = await buildServer(config, qdrantAdapters, embedding, coordinator, searchService);

  // 5. Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await server.close();
    await watcherManager.stopAll();
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  server.addHook('onClose', async () => {
    await watcherManager.stopAll();
  });

  // 6. Start watchers
  watcherManager.startAll();

  // 7. Trigger initial full index for each repo
  for (const repo of config.repos) {
    coordinator.fullIndex(repo.repoId).catch((err) =>
      logger.error({ repoId: repo.repoId, err }, 'Initial indexing failed')
    );
  }

  // 8. Listen
  await server.listen({ port: config.port, host: config.host });
  logger.info({ port: config.port, host: config.host }, 'Server listening');
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
