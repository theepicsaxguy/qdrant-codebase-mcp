import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@qdrant/js-client-rest', () => {
  class MockQdrantClient {
    upsert = vi.fn().mockResolvedValue({});
    getCollection = vi.fn().mockResolvedValue(null);
    getCollections = vi.fn().mockResolvedValue({ collections: [] });
    createCollection = vi.fn().mockResolvedValue({});
    createPayloadIndex = vi.fn().mockResolvedValue({});
  }
  return { QdrantClient: MockQdrantClient };
});

vi.mock('uuid', () => ({
  v5: vi.fn().mockReturnValue('00000000-0000-0000-0000-000000000000'),
}));

import { QdrantAdapter } from '../../src/qdrant/adapter';

const VECTOR_SIZE = 384;

function makeAdapter(): QdrantAdapter {
  return new QdrantAdapter('http://localhost:6333', 'test-collection', VECTOR_SIZE);
}

function validPoint(id: string, dim = VECTOR_SIZE) {
  return {
    id,
    vector: new Array<number>(dim).fill(0.1),
    payload: { filePath: 'src/index.ts', type: 'code' },
  };
}

describe('QdrantAdapter.upsertChunks — vector validation', () => {
  let adapter: QdrantAdapter;

  beforeEach(() => {
    adapter = makeAdapter();
  });

  it('throws on empty vector', async () => {
    const point = { id: 'aaaaaaaa-0000-0000-0000-000000000001', vector: [], payload: {} };
    await expect(adapter.upsertChunks([point])).rejects.toThrow('vector is empty');
  });

  it('throws when vector dimension mismatches collection size', async () => {
    const point = validPoint('aaaaaaaa-0000-0000-0000-000000000002', 128);
    await expect(adapter.upsertChunks([point])).rejects.toThrow(
      `vector dimension 128 does not match collection size ${VECTOR_SIZE}`
    );
  });

  it('passes for correctly sized vectors', async () => {
    const point = validPoint('aaaaaaaa-0000-0000-0000-000000000003');
    await expect(adapter.upsertChunks([point])).resolves.not.toThrow();
  });

  it('throws on the first bad point even when earlier points are valid', async () => {
    const good = validPoint('aaaaaaaa-0000-0000-0000-000000000004');
    const bad = { id: 'aaaaaaaa-0000-0000-0000-000000000005', vector: [], payload: {} };
    await expect(adapter.upsertChunks([good, bad])).rejects.toThrow('vector is empty');
  });

  it('normalizes typed-array vectors before upsert', async () => {
    const point = {
      id: 'aaaaaaaa-0000-0000-0000-000000000006',
      vector: new Float32Array(new Array<number>(VECTOR_SIZE).fill(0.1)) as unknown as number[],
      payload: { filePath: 'src/index.ts', type: 'code' },
    };

    await expect(adapter.upsertChunks([point])).resolves.not.toThrow();

    const client = (adapter as unknown as { client: { upsert: ReturnType<typeof vi.fn> } }).client;
    expect(client.upsert).toHaveBeenCalledOnce();
    const [{ points }] = client.upsert.mock.calls[0]?.slice(1) as [
      { points: Array<{ vector: unknown }> },
    ];
    expect(Array.isArray(points[0]?.vector)).toBe(true);
  });
});
