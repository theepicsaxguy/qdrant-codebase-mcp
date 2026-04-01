import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fastembed', () => ({
  FlagEmbedding: class {},
  EmbeddingModel: { CUSTOM: 'custom' },
}));

import { FastEmbedEmbeddingAdapter } from '../../src/embedding/fastembed-adapter';
import { OpenAICompatibleEmbeddingAdapter } from '../../src/embedding/openai-compatible-adapter';

describe('FastEmbedEmbeddingAdapter vector normalization', () => {
  let adapter: FastEmbedEmbeddingAdapter;

  beforeEach(() => {
    adapter = new FastEmbedEmbeddingAdapter('fast-bge-small-en-v1.5');
  });

  it('converts typed-array passage embeddings into plain arrays', async () => {
    (
      adapter as unknown as {
        model: {
          passageEmbed: (
            texts: string[],
            batchSize: number
          ) => AsyncGenerator<Float32Array[], void, unknown>;
        };
      }
    ).model = {
      async *passageEmbed() {
        yield [new Float32Array([0.1, 0.2]), new Float32Array([0.3, 0.4])];
      },
    };

    const vectors = await adapter.embedBatch(['a', 'b']);

    expect(vectors).toHaveLength(2);
    expect(vectors[0]?.[0]).toBeCloseTo(0.1);
    expect(vectors[0]?.[1]).toBeCloseTo(0.2);
    expect(vectors[1]?.[0]).toBeCloseTo(0.3);
    expect(vectors[1]?.[1]).toBeCloseTo(0.4);
    expect(Array.isArray(vectors[0])).toBe(true);
  });

  it('converts typed-array query embeddings into plain arrays', async () => {
    (
      adapter as unknown as { model: { queryEmbed: (query: string) => Promise<Float32Array> } }
    ).model = {
      queryEmbed: vi.fn().mockResolvedValue(new Float32Array([0.5, 0.6])),
    };

    const vector = await adapter.embedQuery('query');

    expect(vector[0]).toBeCloseTo(0.5);
    expect(vector[1]).toBeCloseTo(0.6);
    expect(Array.isArray(vector)).toBe(true);
  });
});

describe('OpenAICompatibleEmbeddingAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends model, input, auth, and custom headers for batch embeddings', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new OpenAICompatibleEmbeddingAdapter({
      baseUrl: 'https://embeddings.example.com/v1',
      modelName: 'text-embedding-3-large',
      apiKey: 'secret',
      headers: { 'x-test-header': 'enabled' },
    });

    const vectors = await adapter.embedBatch(['a', 'b']);

    expect(vectors).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(adapter.vectorSize).toBe(2);

    const request = fetchMock.mock.calls[0];
    expect(request?.[0].toString()).toBe('https://embeddings.example.com/v1/embeddings');
    expect(request?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      model: 'text-embedding-3-large',
      input: ['a', 'b'],
    });

    expect(request?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer secret',
      'Content-Type': 'application/json',
      'x-test-header': 'enabled',
    });
  });

  it('derives vector size during initialize when dimensions are not configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ embedding: [0.4, 0.5, 0.6] }],
          }),
          { status: 200 }
        )
      )
    );

    const adapter = new OpenAICompatibleEmbeddingAdapter({
      baseUrl: 'https://embeddings.example.com/v1',
      modelName: 'text-embedding-3-small',
    });

    await adapter.initialize();

    expect(adapter.vectorSize).toBe(3);
  });

  it('fails for malformed embedding responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ embedding: ['bad'] }],
          }),
          { status: 200 }
        )
      )
    );

    const adapter = new OpenAICompatibleEmbeddingAdapter({
      baseUrl: 'https://embeddings.example.com/v1',
      modelName: 'text-embedding-3-small',
    });

    await expect(adapter.embedQuery('query')).rejects.toThrow('non-numeric value');
  });
});
