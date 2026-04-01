import * as fs from 'fs';
import * as path from 'path';
import { QdrantAdapter } from '../qdrant/adapter';
import { EmbeddingAdapter } from '../embedding/adapter';
import { scanRepo } from '../scanner/scanner';
import { chunkCode } from '../chunker/chunker';
import { detectLanguage, normalizePath } from '../utils/hashing';
import { logger } from '../logger';
import {
  filesIndexedTotal,
  chunksIndexedTotal,
  indexingErrorsTotal,
  indexingDurationSeconds,
} from '../metrics';
import type { AppConfig, RepoConfig } from '../config/schema';

export class IndexingCoordinator {
  private readonly config: AppConfig;
  private readonly qdrantAdapters: Map<string, QdrantAdapter>;
  private readonly embedding: EmbeddingAdapter;
  private readonly log = logger.child({ component: 'IndexingCoordinator' });
  private activeTasks = new Set<string>();

  constructor(
    config: AppConfig,
    qdrantAdapters: Map<string, QdrantAdapter>,
    embedding: EmbeddingAdapter
  ) {
    this.config = config;
    this.qdrantAdapters = qdrantAdapters;
    this.embedding = embedding;
  }

  async fullIndex(repoId: string): Promise<void> {
    if (this.activeTasks.has(repoId)) {
      this.log.warn({ repoId }, 'Indexing already in progress, skipping');
      return;
    }

    const repo = this.config.repos.find((r) => r.repoId === repoId);
    if (!repo) throw new Error(`Unknown repoId: ${repoId}`);

    const adapter = this.qdrantAdapters.get(repoId);
    if (!adapter) throw new Error(`No Qdrant adapter for repoId: ${repoId}`);

    this.activeTasks.add(repoId);
    const timer = indexingDurationSeconds.startTimer({ repo_id: repoId });
    const startedAt = Date.now();

    try {
      await adapter.markIndexingIncomplete(startedAt);
      this.log.info({ repoId }, 'Starting full index');

      const files = await scanRepo(repo, this.config.maxFileSizeBytes);
      this.log.info({ repoId, fileCount: files.length }, 'Files to index');

      let totalChunks = 0;
      for (const filePath of files) {
        try {
          await this.indexFile(filePath, repo, adapter);
          filesIndexedTotal.inc({ repo_id: repoId, status: 'success' });
          totalChunks++;
        } catch (err) {
          this.log.error({ repoId, filePath, err }, 'Failed to index file');
          filesIndexedTotal.inc({ repo_id: repoId, status: 'error' });
          indexingErrorsTotal.inc({ repo_id: repoId });
        }
      }

      await adapter.markIndexingComplete(startedAt);
      this.log.info({ repoId, totalChunks }, 'Full index complete');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await adapter.markIndexingFailed(startedAt, msg).catch(() => undefined);
      indexingErrorsTotal.inc({ repo_id: repoId });
      this.log.error({ repoId, err }, 'Full indexing failed');
      throw err;
    } finally {
      timer();
      this.activeTasks.delete(repoId);
    }
  }

  async indexFile(
    absolutePath: string,
    repo: RepoConfig,
    adapter: QdrantAdapter
  ): Promise<void> {
    const root = path.resolve(repo.rootPath);
    const relPath = normalizePath(path.relative(root, absolutePath));
    const language = detectLanguage(absolutePath);

    let content: string;
    try {
      content = fs.readFileSync(absolutePath, 'utf-8');
    } catch (err) {
      this.log.warn({ file: absolutePath, err }, 'Could not read file, skipping');
      return;
    }

    // Delete existing chunks before reinserting
    await adapter.deleteByFilePath(relPath);

    const chunks = chunkCode(
      { repoId: repo.repoId, filePath: relPath, language, content },
      { maxLines: this.config.chunkMaxLines, overlapLines: this.config.chunkOverlapLines }
    );

    if (chunks.length === 0) return;

    // Batch embed
    const texts = chunks.map((c) => c.codeChunk);
    const vectors = await this.embedding.embedBatch(texts);

    const now = Date.now();
    const points = chunks.map((chunk, i) => ({
      id: chunk.id,
      vector: vectors[i] ?? [],
      payload: {
        type: 'code',
        repoId: repo.repoId,
        filePath: chunk.filePath,
        language: chunk.language,
        codeChunk: chunk.codeChunk,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        contentHash: chunk.contentHash,
        updatedAt: now,
      },
    }));

    await adapter.upsertChunks(points);
    chunksIndexedTotal.inc({ repo_id: repo.repoId }, chunks.length);

    this.log.debug({ repoId: repo.repoId, file: relPath, chunks: chunks.length }, 'File indexed');
  }

  async deleteFile(absolutePath: string, repo: RepoConfig, adapter: QdrantAdapter): Promise<void> {
    const root = path.resolve(repo.rootPath);
    const relPath = normalizePath(path.relative(root, absolutePath));
    await adapter.deleteByFilePath(relPath);
    this.log.debug({ repoId: repo.repoId, file: relPath }, 'Deleted file chunks');
  }

  isIndexing(repoId: string): boolean {
    return this.activeTasks.has(repoId);
  }
}
