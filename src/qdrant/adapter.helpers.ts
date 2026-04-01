import * as path from 'path';
import { v5 as uuidv5 } from 'uuid';
import type { QdrantClient, Schemas } from '@qdrant/js-client-rest';
import type { IndexingStatus, QdrantPoint, SearchResult } from '../types';
import type { QdrantSearchParams } from './adapter';

type SearchPayload = Record<string, unknown>;
type LoggerLike = { warn: (context: Record<string, unknown>, message: string) => void };

const METADATA_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const METADATA_KEY = '__indexing_metadata__';
const PAYLOAD_INDEX_FIELDS = [
  'type',
  'repoId',
  'language',
  ...Array.from({ length: 5 }, (_, index) => `pathSegments.${index}`),
];
export const SEARCH_RESULT_PAYLOAD_FIELDS = [
  'filePath',
  'codeChunk',
  'startLine',
  'endLine',
  'repoId',
];

export function buildPort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

export function buildSearchFilter(params: QdrantSearchParams): Schemas['Filter'] {
  const must: Array<{ key: string; match: { value: string } }> = [];
  const mustNot = [{ key: 'type', match: { value: 'metadata' } }];

  if (params.directoryPrefix) {
    const norm = path.posix.normalize(params.directoryPrefix.replace(/\\/g, '/'));
    const clean = norm.startsWith('./') ? norm.slice(2) : norm;
    if (clean && clean !== '.') {
      const segments = clean.split('/').filter(Boolean);
      for (const [index, segment] of segments.entries()) {
        must.push({ key: `pathSegments.${index}`, match: { value: segment } });
      }
    }
  }

  if (params.language) {
    must.push({ key: 'language', match: { value: params.language } });
  }

  return { must_not: mustNot, ...(must.length > 0 ? { must } : {}) } as Schemas['Filter'];
}

export function mapSearchPoint(point: {
  score: number;
  payload?: SearchPayload | null;
}): SearchResult | null {
  const payload = point.payload;
  if (payload === null || payload === undefined) return null;
  const filePath = payload['filePath'];
  const codeChunk = payload['codeChunk'];

  if (typeof filePath !== 'string' || filePath.length === 0 || typeof codeChunk !== 'string') {
    return null;
  }

  return {
    score: point.score,
    filePath,
    startLine: payload['startLine'] as number,
    endLine: payload['endLine'] as number,
    codeChunk,
    repoId: (payload['repoId'] as string | undefined) ?? '',
  };
}

export function readVectorSize(vectorsConfig: unknown): number {
  if (
    typeof vectorsConfig === 'object' &&
    vectorsConfig !== null &&
    'size' in vectorsConfig &&
    typeof vectorsConfig.size === 'number'
  ) {
    return vectorsConfig.size;
  }

  return 0;
}

export function buildDeleteFilter(filePaths: string[]): Schemas['Filter'] {
  const filters = filePaths.map((filePath) => {
    const segments = filePath.split(/[\\/]/).filter(Boolean);
    return {
      must: segments.map((segment, index) => ({
        key: `pathSegments.${index}`,
        match: { value: segment },
      })),
    };
  });

  if (filters.length === 1) {
    return filters[0] as Schemas['Filter'];
  }

  return { should: filters } as unknown as Schemas['Filter'];
}

export async function ensurePayloadIndexes(
  client: QdrantClient,
  collectionName: string,
  log: LoggerLike
): Promise<void> {
  for (const field of PAYLOAD_INDEX_FIELDS) {
    try {
      await client.createPayloadIndex(collectionName, {
        field_name: field,
        field_schema: 'keyword',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.toLowerCase().includes('already exists')) {
        log.warn({ field, err: message }, 'Could not create payload index');
      }
    }
  }
}

export function metadataId(): string {
  return uuidv5(METADATA_KEY, METADATA_NAMESPACE);
}

export function metadataPoint(
  id: string,
  vectorSize: number,
  fields: Record<string, unknown>
): Schemas['PointStruct'] {
  return {
    id,
    vector: new Array<number>(vectorSize).fill(0),
    payload: { type: 'metadata', ...fields },
  };
}

export function toIndexingStatus(payload: SearchPayload, collectionName: string): IndexingStatus {
  return {
    repoId: '',
    collectionName,
    indexing_complete: Boolean(payload['indexing_complete']),
    started_at: (payload['started_at'] as number | null) ?? null,
    completed_at: (payload['completed_at'] as number | null) ?? null,
    last_error: (payload['last_error'] as string | null) ?? null,
  };
}

export function validatePointVectors(points: QdrantPoint[], vectorSize: number): void {
  for (const point of points) {
    if (point.vector.length === 0) {
      throw new Error(
        `Point ${point.id}: vector is empty — embedding likely failed for this chunk`
      );
    }

    if (point.vector.length !== vectorSize) {
      throw new Error(
        `Point ${point.id}: vector dimension ${point.vector.length} does not match collection size ${vectorSize}`
      );
    }
  }
}

export function normalizeVector(vector: ArrayLike<number>): number[] {
  return Array.from(vector);
}
