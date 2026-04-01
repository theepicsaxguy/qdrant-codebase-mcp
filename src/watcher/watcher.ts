import chokidar, { type FSWatcher } from 'chokidar';
import type { QdrantAdapter } from '../qdrant/adapter';
import type { IndexingCoordinator } from '../indexing/coordinator';
import { isIndexable } from '../scanner/scanner';
import { logger } from '../logger';
import type { AppConfig, RepoConfig } from '../config/schema';

interface WatcherEntry {
  watcher: FSWatcher;
  repoId: string;
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>;
}

interface WatcherContext {
  repo: RepoConfig;
  adapter: QdrantAdapter;
  log: typeof logger;
  debounce: (filePath: string, reason: string, action: () => Promise<void>) => void;
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
    const watcher = this.createWatcher(repo);
    const debounce = this.createDebounce(log, debounceTimers);
    this.registerWatcherEvents(watcher, { repo, adapter, log, debounce });

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

  private createWatcher(repo: RepoConfig): FSWatcher {
    return chokidar.watch(repo.rootPath, {
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
  }

  private createDebounce(
    log: typeof logger,
    debounceTimers: Map<string, ReturnType<typeof setTimeout>>
  ): (filePath: string, reason: string, action: () => Promise<void>) => void {
    return (filePath: string, reason: string, action: () => Promise<void>): void => {
      const existing = debounceTimers.get(filePath);
      if (existing) {
        clearTimeout(existing);
        log.debug(
          { filePath, debounceMs: this.config.watcherDebounceMs },
          'File changed again; resetting debounce timer'
        );
      }

      log.debug(
        { filePath, debounceMs: this.config.watcherDebounceMs, reason },
        'File event detected; waiting before indexing'
      );

      debounceTimers.set(
        filePath,
        setTimeout(() => {
          debounceTimers.delete(filePath);
          log.debug({ filePath, reason }, 'Debounce window complete; processing file event');
          action().catch((err) => {
            log.error({ filePath, err }, 'Debounced action failed');
          });
        }, this.config.watcherDebounceMs)
      );
    };
  }

  private registerWatcherEvents(watcher: FSWatcher, context: WatcherContext): void {
    this.registerIndexEvent(watcher, context, 'add', 'File added');
    this.registerIndexEvent(watcher, context, 'change', 'File changed');
    this.registerDeleteEvent(watcher, context);
    watcher.on('error', (err: unknown) => {
      context.log.error({ err }, 'Watcher error');
    });
  }

  private registerIndexEvent(
    watcher: FSWatcher,
    context: WatcherContext,
    eventName: 'add' | 'change',
    message: string
  ): void {
    watcher.on(eventName, (filePath: string) => {
      if (!this.isTrackedFile(filePath, context.repo)) {
        return;
      }

      context.debounce(filePath, message, async () => {
        await this.coordinator.indexFile(filePath, context.repo, context.adapter);
      });
    });
  }

  private registerDeleteEvent(watcher: FSWatcher, context: WatcherContext): void {
    watcher.on('unlink', (filePath: string) => {
      context.debounce(filePath, 'File deleted', async () => {
        await this.coordinator.deleteFile(filePath, context.repo, context.adapter);
      });
    });
  }

  private isTrackedFile(filePath: string, repo: RepoConfig): boolean {
    return isIndexable(filePath, repo.rootPath, repo, this.config.maxFileSizeBytes);
  }
}
