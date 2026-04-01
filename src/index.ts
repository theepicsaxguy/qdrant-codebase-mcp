import { loadConfig } from './config/loader';
import { bootstrap, startIndexing } from './bootstrap';
import { buildServer } from './api/server';
import { logger } from './logger';

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info({ repos: config.repos.map((r) => r.repoId) }, 'Config loaded');

  const bundle = await bootstrap(config);
  const { coordinator, watcherManager, searchService, qdrantAdapters, embedding } = bundle;

  const server = await buildServer(config, qdrantAdapters, embedding, coordinator, searchService);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await server.close();
    await watcherManager.stopAll();
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  server.addHook('onClose', async () => { await watcherManager.stopAll(); });

  startIndexing(bundle);

  await server.listen({ port: config.port, host: config.host });
  logger.info({ port: config.port, host: config.host }, 'Server listening');
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
