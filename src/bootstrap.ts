import { QdrantAdapter } from './qdrant/adapter';
import { EmbeddingAdapter } from './embedding/adapter';
import { IndexingCoordinator } from './indexing/coordinator';
import { FileWatcherManager } from './watcher/watcher';
import { SearchService } from './search/service';
import { logger } from './logger';
import type { AppConfig } from './config/schema';

export interface ServiceBundle {
  config: AppConfig;
  embedding: EmbeddingAdapter;
  qdrantAdapters: Map<string, QdrantAdapter>;
  coordinator: IndexingCoordinator;
  searchService: SearchService;
  watcherManager: FileWatcherManager;
}

export async function bootstrap(config: AppConfig): Promise<ServiceBundle> {
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
    await adapter.ping().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      const isAuth =
        msg.includes('401') ||
        msg.includes('403') ||
        msg.includes('Unauthorized') ||
        msg.includes('Forbidden');
      const hint = isAuth
        ? ' — authentication failed. Set QDRANT_API_KEY or qdrantApiKey in config.'
        : ` — check Qdrant is reachable at ${config.qdrantUrl}.\n  Original: ${msg}`;
      throw new Error(`Cannot connect to Qdrant at ${config.qdrantUrl}${hint}`);
    });
    await adapter.initialize();
    qdrantAdapters.set(repo.repoId, adapter);
  }
  logger.info(
    { repos: config.repos.map((r: { repoId: string }) => r.repoId) },
    'Qdrant adapters ready'
  );

  // 3. Build services
  const coordinator = new IndexingCoordinator(config, qdrantAdapters, embedding);
  const searchService = new SearchService(qdrantAdapters, embedding);
  const watcherManager = new FileWatcherManager(config, qdrantAdapters, coordinator);

  return { config, embedding, qdrantAdapters, coordinator, searchService, watcherManager };
}

export function startIndexing(bundle: ServiceBundle): void {
  const { config, coordinator, watcherManager } = bundle;

  watcherManager.startAll();

  for (const repo of config.repos) {
    coordinator.fullIndex(repo.repoId).catch((err: unknown) => {
      logger.error({ repoId: repo.repoId, err }, 'Initial indexing failed');
    });
  }
}
