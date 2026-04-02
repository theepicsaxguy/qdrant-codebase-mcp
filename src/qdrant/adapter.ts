import { QdrantClient, type Schemas } from '@qdrant/js-client-rest';
import { logger } from '../logger';
import { buildPathSegments } from '../utils/hashing';
import type { IndexingStatus, QdrantPoint, SearchResult } from '../types';
import {
  buildDeleteFilter,
  buildPort,
  buildSearchFilter,
  ensurePayloadIndexes,
  mapSearchPoint,
  metadataId,
  metadataPoint,
  normalizeVector,
  readVectorSize,
  SEARCH_RESULT_PAYLOAD_FIELDS,
  toIndexingStatus,
  validatePointVectors,
} from './adapter.helpers';

export interface QdrantSearchParams {
  queryVector: number[];
  directoryPrefix?: string;
  language?: string;
  limit?: number;
  minScore?: number;
}
export class QdrantAdapter {
  private readonly client: QdrantClient;
  private readonly collectionName: string;
  private readonly vectorSize: number;
  private readonly log = logger.child({ component: 'QdrantAdapter' });

  constructor(qdrantUrl: string, collectionName: string, vectorSize: number, apiKey?: string) {
    this.collectionName = collectionName;
    this.vectorSize = vectorSize;
    try {
      const u = new URL(qdrantUrl);
      const port = buildPort(u);
      this.client = new QdrantClient({
        host: u.hostname,
        port,
        https: u.protocol === 'https:',
        prefix: u.pathname === '/' ? undefined : u.pathname.replace(/\/+$/, ''),
        apiKey,
        headers: { 'User-Agent': 'qdrant-codebase-mcp' },
      });
    } catch {
      this.client = new QdrantClient({ url: qdrantUrl, apiKey });
    }
  }

  async initialize(): Promise<void> {
    const info = await this.getCollectionInfo();
    if (info === null) {
      this.log.info({ collection: this.collectionName }, 'Creating collection');
      await this.createCollection();
    } else {
      await this.maybeRecreateCollection(info);
    }
    await ensurePayloadIndexes(this.client, this.collectionName, this.log);
    this.log.info({ collection: this.collectionName }, 'Collection ready');
  }

  async validateExistingCollection(): Promise<void> {
    const info = await this.getCollectionInfo();
    if (info === null) {
      throw new Error(`Collection does not exist: ${this.collectionName}`);
    }

    const existingSize = readVectorSize(info.config.params.vectors);
    if (existingSize !== 0 && existingSize !== this.vectorSize) {
      throw new Error(
        `Collection ${this.collectionName} has vector size ${existingSize}, expected ${this.vectorSize}`
      );
    }
  }

  private async createCollection(): Promise<void> {
    await this.client.createCollection(this.collectionName, {
      vectors: { size: this.vectorSize, distance: 'Cosine', on_disk: true },
      hnsw_config: { m: 64, ef_construct: 512, on_disk: true },
    });
  }
  private async maybeRecreateCollection(
    info: Awaited<ReturnType<QdrantClient['getCollection']>>
  ): Promise<void> {
    const existingSize = readVectorSize(info.config.params.vectors);
    if (existingSize === 0 || existingSize === this.vectorSize) return;
    this.log.warn(
      { existing: existingSize, expected: this.vectorSize },
      'Vector dimension mismatch — recreating'
    );
    await this.client.deleteCollection(this.collectionName);
    await new Promise<void>((r) => setTimeout(r, 200));
    await this.createCollection();
  }

  async upsertChunks(points: QdrantPoint[]): Promise<void> {
    validatePointVectors(points, this.vectorSize);
    const processed: Schemas['PointStruct'][] = points.map((p) => ({
      id: p.id,
      vector: normalizeVector(p.vector),
      payload: { ...p.payload, pathSegments: buildPathSegments(p.payload.filePath) },
    }));
    await this.client.upsert(this.collectionName, { points: processed, wait: true });
  }

  async deleteByFilePath(filePath: string): Promise<void> {
    await this.deleteByFilePaths([filePath]);
  }

  async deleteByFilePaths(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return;
    const exists = await this.collectionExists();
    if (!exists) return;
    const filter = buildDeleteFilter(filePaths);
    await this.client.delete(this.collectionName, { filter, wait: true });
    this.log.debug({ count: filePaths.length }, 'Deleted chunks by file path');
  }

  async deleteCollection(): Promise<void> {
    if (await this.collectionExists()) {
      await this.client.deleteCollection(this.collectionName);
      this.log.info({ collection: this.collectionName }, 'Collection deleted');
    }
  }
  async markIndexingIncomplete(startedAt: number): Promise<void> {
    await this.writeMetadata({
      indexing_complete: false,
      started_at: startedAt,
      completed_at: null,
      last_error: null,
    });
  }

  async markIndexingComplete(startedAt: number): Promise<void> {
    await this.writeMetadata({
      indexing_complete: true,
      started_at: startedAt,
      completed_at: Date.now(),
      last_error: null,
    });
  }

  async markIndexingFailed(startedAt: number, error: string): Promise<void> {
    await this.writeMetadata({
      indexing_complete: false,
      started_at: startedAt,
      completed_at: Date.now(),
      last_error: error,
    });
  }

  private async writeMetadata(fields: Record<string, unknown>): Promise<void> {
    await this.client.upsert(this.collectionName, {
      points: [metadataPoint(metadataId(), this.vectorSize, fields)],
      wait: true,
    });
  }

  async getIndexingStatus(): Promise<IndexingStatus | null> {
    if (!(await this.collectionExists())) return null;
    try {
      const points = await this.client.retrieve(this.collectionName, {
        ids: [metadataId()],
        with_payload: true,
        with_vector: false,
      });
      const p = points[0];
      if (!p?.payload) return null;
      return toIndexingStatus(p.payload as Record<string, unknown>, this.collectionName);
    } catch {
      return null;
    }
  }

  async search(params: QdrantSearchParams): Promise<SearchResult[]> {
    const { queryVector, limit = 10, minScore = 0.45 } = params;
    const filter = buildSearchFilter(params);
    const result = await this.client.query(this.collectionName, {
      query: queryVector,
      filter,
      limit,
      score_threshold: minScore,
      with_payload: { include: SEARCH_RESULT_PAYLOAD_FIELDS },
    });
    const hits = result.points as Array<{
      score: number;
      payload?: Record<string, unknown> | null;
    }>;
    return hits.flatMap((p) => {
      const mapped = mapSearchPoint(p);
      return mapped === null ? [] : [mapped];
    });
  }

  async collectionExists(): Promise<boolean> {
    return (await this.getCollectionInfo()) !== null;
  }

  private async getCollectionInfo(): Promise<Awaited<
    ReturnType<QdrantClient['getCollection']>
  > | null> {
    try {
      return await this.client.getCollection(this.collectionName);
    } catch {
      return null;
    }
  }

  async ping(): Promise<void> {
    await this.client.getCollections();
  }
}
