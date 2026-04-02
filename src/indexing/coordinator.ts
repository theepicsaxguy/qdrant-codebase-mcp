import * as fs from 'fs';
import * as path from 'path';
import type { QdrantAdapter } from '../qdrant/adapter';
import type { EmbeddingAdapter } from '../embedding/types';
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
import type { QdrantPoint } from '../types';

export class IndexingCoordinator {
  private readonly config: AppConfig;
  private readonly qdrantAdapters: Map<string, QdrantAdapter>;
  private readonly embedding: EmbeddingAdapter;
  private readonly log = logger.child({ component: 'IndexingCoordinator' });
  private readonly activeTasks = new Set<string>();

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
    if (!repo.rootPath) {
      throw new Error(`Repo ${repoId} does not have a rootPath; indexing is unavailable`);
    }
    const adapter = this.qdrantAdapters.get(repoId);
    if (!adapter) throw new Error(`No Qdrant adapter for repoId: ${repoId}`);

    this.activeTasks.add(repoId);
    const timer = indexingDurationSeconds.startTimer({ repo_id: repoId });
    const startedAt = Date.now();
    try {
      await adapter.deleteCollection();
      await adapter.initialize();
      await adapter.markIndexingIncomplete(startedAt);
      const files = await scanRepo(repo, this.config.maxFileSizeBytes);
      this.log.info({ repoId, fileCount: files.length }, 'Starting full index');
      const totalChunks = await this.indexFiles(files, repo, adapter);
      await adapter.markIndexingComplete(startedAt);
      this.log.info({ repoId, totalChunks }, 'Full index complete');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await adapter.markIndexingFailed(startedAt, msg).catch(() => null);
      indexingErrorsTotal.inc({ repo_id: repoId });
      this.log.error({ repoId, err }, 'Full indexing failed');
      throw err;
    } finally {
      timer();
      this.activeTasks.delete(repoId);
    }
  }

  private async indexFiles(
    files: string[],
    repo: RepoConfig,
    adapter: QdrantAdapter
  ): Promise<number> {
    let count = 0;
    for (const filePath of files) {
      try {
        await this.indexFile(filePath, repo, adapter);
        filesIndexedTotal.inc({ repo_id: repo.repoId, status: 'success' });
        count++;
      } catch (err) {
        this.log.error({ repoId: repo.repoId, filePath, err }, 'Failed to index file');
        filesIndexedTotal.inc({ repo_id: repo.repoId, status: 'error' });
        indexingErrorsTotal.inc({ repo_id: repo.repoId });
      }
    }
    return count;
  }

  async indexFile(absolutePath: string, repo: RepoConfig, adapter: QdrantAdapter): Promise<void> {
    if (!repo.rootPath) {
      throw new Error(`Repo ${repo.repoId} does not have a rootPath; indexing is unavailable`);
    }

    const root = path.resolve(repo.rootPath);
    const relPath = normalizePath(path.relative(root, absolutePath));
    const language = detectLanguage(absolutePath);

    let content: string;
    try {
      // Path is derived from scanRepo which validates against repo.rootPath — not user input.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      content = fs.readFileSync(absolutePath, 'utf-8');
    } catch (err) {
      this.log.warn({ file: absolutePath, err }, 'Could not read file, skipping');
      return;
    }

    await adapter.deleteByFilePath(relPath);
    const chunks = chunkCode(
      { repoId: repo.repoId, filePath: relPath, language, content },
      { maxLines: this.config.chunkMaxLines, overlapLines: this.config.chunkOverlapLines }
    );
    if (chunks.length === 0) return;

    const points = await this.buildPoints(chunks, relPath, repo);
    await adapter.upsertChunks(points);
    chunksIndexedTotal.inc({ repo_id: repo.repoId }, chunks.length);
    this.log.debug({ repoId: repo.repoId, file: relPath, chunks: chunks.length }, 'File indexed');
  }

  private async buildPoints(
    chunks: ReturnType<typeof chunkCode>,
    relPath: string,
    repo: RepoConfig
  ): Promise<QdrantPoint[]> {
    const texts = chunks.map((c) => c.codeChunk);
    const vectors = await this.embedding.embedBatch(texts);
    if (vectors.length !== chunks.length) {
      throw new Error(
        `Embedding count mismatch for ${relPath}: got ${vectors.length} for ${chunks.length} chunks`
      );
    }
    const now = Date.now();
    return chunks.map((chunk, i) => ({
      id: chunk.id,
      // Index is bounds-checked by the length assertion above.
      // eslint-disable-next-line security/detect-object-injection
      vector: vectors[i] as number[],
      payload: {
        type: 'code' as const,
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
  }

  async deleteFile(absolutePath: string, repo: RepoConfig, adapter: QdrantAdapter): Promise<void> {
    if (!repo.rootPath) {
      throw new Error(`Repo ${repo.repoId} does not have a rootPath; indexing is unavailable`);
    }

    const root = path.resolve(repo.rootPath);
    const relPath = normalizePath(path.relative(root, absolutePath));
    await adapter.deleteByFilePath(relPath);
    this.log.debug({ repoId: repo.repoId, file: relPath }, 'Deleted file chunks');
  }

  isIndexing(repoId: string): boolean {
    return this.activeTasks.has(repoId);
  }
}
