import chokidar from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { QdrantAdapter } from '../qdrant/adapter';
import { IndexingCoordinator } from '../indexing/coordinator';
import { isIndexable } from '../scanner/scanner';
import { logger } from '../logger';
import type { AppConfig, RepoConfig } from '../config/schema';

interface WatcherEntry {
  watcher: FSWatcher;
  repoId: string;
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>;
}

export class FileWatcherManager {
  private readonly config: AppConfig;
  private readonly qdrantAdapters: Map<string, QdrantAdapter>;
  private readonly coordinator: IndexingCoordinator;
  private readonly watchers: Map<string, WatcherEntry> = new Map();
  private readonly log = logger.child({ component: 'FileWatcher' });

  constructor(
    config: AppConfig,
    qdrantAdapters: Map<string, QdrantAdapter>,
    coordinator: IndexingCoordinator
  ) {
    this.config = config;
    this.qdrantAdapters = qdrantAdapters;
    this.coordinator = coordinator;
  }

  startAll(): void {
    for (const repo of this.config.repos) {
      this.startWatcher(repo);
    }
  }

  private startWatcher(repo: RepoConfig): void {
    const log = this.log.child({ repoId: repo.repoId });
    const adapter = this.qdrantAdapters.get(repo.repoId);
    if (!adapter) {
      log.error('No Qdrant adapter found, skipping watcher');
      return;
    }

    const debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

    const watcher = chokidar.watch(repo.rootPath, {
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false,
      depth: 99,
      awaitWriteFinish: {
        stabilityThreshold: this.config.watcherDebounceMs,
        pollInterval: 100,
      },
      atomic: true,
    });

    const debounce = (filePath: string, action: () => Promise<void>): void => {
      const existing = debounceTimers.get(filePath);
      if (existing) clearTimeout(existing);
      debounceTimers.set(
        filePath,
        setTimeout(() => {
          debounceTimers.delete(filePath);
          action().catch((err) => log.error({ filePath, err }, 'Debounced action failed'));
        }, this.config.watcherDebounceMs)
      );
    };

    watcher
      .on('add', (filePath: string) => {
        if (!isIndexable(filePath, repo.rootPath, repo, this.config.maxFileSizeBytes)) return;
        log.debug({ filePath }, 'File added');
        debounce(filePath, () => this.coordinator.indexFile(filePath, repo, adapter));
      })
      .on('change', (filePath: string) => {
        if (!isIndexable(filePath, repo.rootPath, repo, this.config.maxFileSizeBytes)) return;
        log.debug({ filePath }, 'File changed');
        debounce(filePath, () => this.coordinator.indexFile(filePath, repo, adapter));
      })
      .on('unlink', (filePath: string) => {
        log.debug({ filePath }, 'File deleted');
        debounce(filePath, () => this.coordinator.deleteFile(filePath, repo, adapter));
      })
      .on('error', (err: unknown) => {
        log.error({ err }, 'Watcher error');
      });

    this.watchers.set(repo.repoId, { watcher, repoId: repo.repoId, debounceTimers });
    log.info({ path: repo.rootPath }, 'Watcher started');
  }

  async stopAll(): Promise<void> {
    for (const [repoId, entry] of this.watchers) {
      try {
        // Clear pending debounce timers
        for (const timer of entry.debounceTimers.values()) {
          clearTimeout(timer);
        }
        entry.debounceTimers.clear();
        await entry.watcher.close();
        this.log.info({ repoId }, 'Watcher stopped');
      } catch (err) {
        this.log.warn({ repoId, err }, 'Error stopping watcher');
      }
    }
    this.watchers.clear();
  }
}
