import { QdrantAdapter } from './qdrant/adapter';
import { createEmbeddingAdapter } from './embedding/factory';
import type { EmbeddingAdapter } from './embedding/types';
import { IndexingCoordinator } from './indexing/coordinator';
import { FileWatcherManager } from './watcher/watcher';
import { SearchService } from './search/service';
import { logger } from './logger';
import type { AppConfig } from './config/schema';

interface ServiceBundle {
  config: AppConfig;
  embedding: EmbeddingAdapter;
  qdrantAdapters: Map<string, QdrantAdapter>;
  coordinator: IndexingCoordinator;
  searchService: SearchService;
  watcherManager: FileWatcherManager;
}

export async function bootstrap(config: AppConfig): Promise<ServiceBundle> {
  const embedding = await initializeEmbedding(config);
  const qdrantAdapters = await initializeQdrantAdapters(config, embedding);
  logger.info(
    { repos: config.repos.map((r: { repoId: string }) => r.repoId) },
    'Qdrant adapters ready'
  );

  // 3. Build services
  const coordinator = new IndexingCoordinator(config, qdrantAdapters, embedding);
  const searchService = new SearchService(qdrantAdapters, embedding, config.minScore);
  const watcherManager = new FileWatcherManager(config, qdrantAdapters, coordinator);

  return { config, embedding, qdrantAdapters, coordinator, searchService, watcherManager };
}

async function initializeEmbedding(config: AppConfig): Promise<EmbeddingAdapter> {
  const embedding = createEmbeddingAdapter(config);
  await embedding.initialize();
  logger.info(
    {
      model: embedding.modelName,
      provider: embedding.provider,
      vectorSize: embedding.vectorSize,
    },
    'Embedding ready'
  );
  return embedding;
}

async function initializeQdrantAdapters(
  config: AppConfig,
  embedding: EmbeddingAdapter
): Promise<Map<string, QdrantAdapter>> {
  const adapters = new Map<string, QdrantAdapter>();

  for (const repo of config.repos) {
    const adapter = new QdrantAdapter(
      config.qdrantUrl,
      repo.collectionName,
      embedding.vectorSize,
      config.qdrantApiKey
    );
    await assertQdrantReachable(adapter, config.qdrantUrl);
    await initializeAdapterForMode(adapter, config.serverMode);
    adapters.set(repo.repoId, adapter);
  }

  return adapters;
}

async function assertQdrantReachable(adapter: QdrantAdapter, qdrantUrl: string): Promise<void> {
  await adapter.ping().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    const isAuth =
      msg.includes('401') ||
      msg.includes('403') ||
      msg.includes('Unauthorized') ||
      msg.includes('Forbidden');
    const hint = isAuth
      ? ' — authentication failed. Set QDRANT_API_KEY or qdrantApiKey in config.'
      : ` — check Qdrant is reachable at ${qdrantUrl}.\n  Original: ${msg}`;
    throw new Error(`Cannot connect to Qdrant at ${qdrantUrl}${hint}`);
  });
}

async function initializeAdapterForMode(
  adapter: QdrantAdapter,
  serverMode: AppConfig['serverMode']
): Promise<void> {
  if (serverMode === 'search-only') {
    await adapter.validateExistingCollection();
    return;
  }

  await adapter.initialize();
}

export function startIndexing(bundle: ServiceBundle): void {
  const { config } = bundle;

  if (config.serverMode === 'search-only') {
    logger.info('Search-only mode enabled; skipping indexing and file watchers');
    return;
  }

  void startIndexAndWatch(bundle);
}

async function startIndexAndWatch(bundle: ServiceBundle): Promise<void> {
  const { config, coordinator, watcherManager } = bundle;
  const tasks = config.repos.map(async (repo) => {
    await coordinator.fullIndex(repo.repoId).catch((err: unknown) => {
      logger.error({ repoId: repo.repoId, err }, 'Initial indexing failed');
    });
  });

  await Promise.all(tasks);
  watcherManager.startAll();
  logger.info({ repos: config.repos.map((repo) => repo.repoId) }, 'Initial indexing settled');
}
