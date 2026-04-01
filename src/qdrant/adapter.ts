import { QdrantClient } from '@qdrant/js-client-rest';
import type { Schemas } from '@qdrant/js-client-rest';
import * as path from 'path';
import { v5 as uuidv5 } from 'uuid';
import { logger } from '../logger';
import { buildPathSegments } from '../utils/hashing';
import type { IndexingStatus, SearchResult } from '../types';

const METADATA_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // UUID v5 namespace
const METADATA_KEY = '__indexing_metadata__';

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
      const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
      this.client = new QdrantClient({
        host: u.hostname,
        port,
        https: u.protocol === 'https:',
        prefix: u.pathname === '/' ? undefined : u.pathname.replace(/\/+$/, ''),
        apiKey,
        headers: { 'User-Agent': 'semantic-code-index' },
      });
    } catch {
      this.client = new QdrantClient({ url: qdrantUrl, apiKey });
    }
  }

  private metadataId(): string {
    return uuidv5(METADATA_KEY, METADATA_NAMESPACE);
  }

  async initialize(): Promise<void> {
    const info = await this.getCollectionInfo();

    if (info === null) {
      this.log.info({ collection: this.collectionName }, 'Creating collection');
      await this.client.createCollection(this.collectionName, {
        vectors: { size: this.vectorSize, distance: 'Cosine', on_disk: true },
        hnsw_config: { m: 64, ef_construct: 512, on_disk: true },
      });
    } else {
      const vectorsConfig = info.config?.params?.vectors;
      let existingSize = 0;
      if (typeof vectorsConfig === 'object' && vectorsConfig !== null && 'size' in vectorsConfig) {
        existingSize = (vectorsConfig as { size: number }).size;
      }
      if (existingSize !== 0 && existingSize !== this.vectorSize) {
        this.log.warn(
          { existing: existingSize, expected: this.vectorSize },
          'Vector dimension mismatch — recreating collection'
        );
        await this.client.deleteCollection(this.collectionName);
        await new Promise((r) => setTimeout(r, 200));
        await this.client.createCollection(this.collectionName, {
          vectors: { size: this.vectorSize, distance: 'Cosine', on_disk: true },
          hnsw_config: { m: 64, ef_construct: 512, on_disk: true },
        });
      }
    }

    await this.createPayloadIndexes();
    this.log.info({ collection: this.collectionName }, 'Collection ready');
  }

  private async createPayloadIndexes(): Promise<void> {
    const fields = ['type', 'repoId', 'language', ...Array.from({ length: 5 }, (_, i) => `pathSegments.${i}`)];
    for (const field of fields) {
      try {
        await this.client.createPayloadIndex(this.collectionName, {
          field_name: field,
          field_schema: 'keyword',
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.toLowerCase().includes('already exists')) {
          this.log.warn({ field, err: msg }, 'Could not create payload index');
        }
      }
    }
  }

  async upsertChunks(
    points: Array<{
      id: string;
      vector: number[];
      payload: Record<string, unknown>;
    }>
  ): Promise<void> {
    const processed: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }> = points.map((p) => {
      const filePath = p.payload['filePath'] as string | undefined;
      const pathSegments = filePath ? buildPathSegments(filePath) : {};
      return {
        id: p.id,
        vector: p.vector,
        payload: { ...p.payload, pathSegments },
      };
    });

    await this.client.upsert(this.collectionName, { points: processed, wait: true });
  }

  async deleteByFilePath(filePath: string): Promise<void> {
    return this.deleteByFilePaths([filePath]);
  }

  async deleteByFilePaths(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return;
    const exists = await this.collectionExists();
    if (!exists) return;

    const filters = filePaths.map((fp) => {
      const segments = fp.split(/[\\/]/).filter(Boolean);
      return {
        must: segments.map((seg, i) => ({
          key: `pathSegments.${i}`,
          match: { value: seg },
        })),
      };
    });

    const filter: Schemas['Filter'] =
      filters.length === 1
        ? (filters[0] as Schemas['Filter'])
        : ({ should: filters } as unknown as Schemas['Filter']);

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
    const id = this.metadataId();
    await this.client.upsert(this.collectionName, {
      points: [
        {
          id,
          vector: new Array<number>(this.vectorSize).fill(0),
          payload: {
            type: 'metadata',
            indexing_complete: false,
            started_at: startedAt,
            completed_at: null,
            last_error: null,
          },
        },
      ],
      wait: true,
    });
  }

  async markIndexingComplete(startedAt: number): Promise<void> {
    const id = this.metadataId();
    await this.client.upsert(this.collectionName, {
      points: [
        {
          id,
          vector: new Array<number>(this.vectorSize).fill(0),
          payload: {
            type: 'metadata',
            indexing_complete: true,
            started_at: startedAt,
            completed_at: Date.now(),
            last_error: null,
          },
        },
      ],
      wait: true,
    });
  }

  async markIndexingFailed(startedAt: number, error: string): Promise<void> {
    const id = this.metadataId();
    await this.client.upsert(this.collectionName, {
      points: [
        {
          id,
          vector: new Array<number>(this.vectorSize).fill(0),
          payload: {
            type: 'metadata',
            indexing_complete: false,
            started_at: startedAt,
            completed_at: Date.now(),
            last_error: error,
          },
        },
      ],
      wait: true,
    });
  }

  async getIndexingStatus(): Promise<IndexingStatus | null> {
    if (!(await this.collectionExists())) return null;
    try {
      const points = await this.client.retrieve(this.collectionName, {
        ids: [this.metadataId()],
        with_payload: true,
        with_vector: false,
      });
      if (points.length === 0) return null;
      const p = points[0];
      if (!p?.payload) return null;
      return {
        repoId: '',
        collectionName: this.collectionName,
        indexing_complete: Boolean(p.payload['indexing_complete']),
        started_at: (p.payload['started_at'] as number | null) ?? null,
        completed_at: (p.payload['completed_at'] as number | null) ?? null,
        last_error: (p.payload['last_error'] as string | null) ?? null,
      };
    } catch {
      return null;
    }
  }

  async search(params: QdrantSearchParams): Promise<SearchResult[]> {
    const { queryVector, directoryPrefix, language, limit = 10, minScore = 0.45 } = params;

    const mustConditions: Array<{ key: string; match: { value: string } }> = [];
    const mustNotConditions: Array<{ key: string; match: { value: string } }> = [
      { key: 'type', match: { value: 'metadata' } },
    ];

    if (directoryPrefix) {
      const norm = path.posix.normalize(directoryPrefix.replace(/\\/g, '/'));
      const clean = norm.startsWith('./') ? norm.slice(2) : norm;
      if (clean && clean !== '.') {
        const segs = clean.split('/').filter(Boolean);
        segs.forEach((seg: string, i: number) =>
          mustConditions.push({ key: `pathSegments.${i}`, match: { value: seg } })
        );
      }
    }

    if (language) {
      mustConditions.push({ key: 'language', match: { value: language } });
    }

    const filter: Schemas['Filter'] = {
      must_not: mustNotConditions,
      ...(mustConditions.length > 0 ? { must: mustConditions } : {}),
    } as Schemas['Filter'];

    const result = await this.client.query(this.collectionName, {
      query: queryVector,
      filter,
      limit,
      score_threshold: minScore,
      with_payload: { include: ['filePath', 'codeChunk', 'startLine', 'endLine', 'repoId'] },
    });

    return (result.points as Array<{ score: number; payload?: Record<string, unknown> | null }>)
      .filter((p) => {
        const pay = p.payload;
        return pay && pay['filePath'] && pay['codeChunk'] != null;
      })
      .map((p) => ({
        score: p.score,
        filePath: p.payload!['filePath'] as string,
        startLine: p.payload!['startLine'] as number,
        endLine: p.payload!['endLine'] as number,
        codeChunk: p.payload!['codeChunk'] as string,
        repoId: (p.payload!['repoId'] as string | undefined) ?? '',
      }));
  }

  async collectionExists(): Promise<boolean> {
    return (await this.getCollectionInfo()) !== null;
  }

  private async getCollectionInfo() {
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
