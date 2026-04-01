import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fastembed', () => ({
  FlagEmbedding: class {},
  EmbeddingModel: { CUSTOM: 'custom' },
}));

import { EmbeddingAdapter } from '../../src/embedding/adapter';

describe('EmbeddingAdapter vector normalization', () => {
  let adapter: EmbeddingAdapter;

  beforeEach(() => {
    adapter = new EmbeddingAdapter('fast-bge-small-en-v1.5');
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
