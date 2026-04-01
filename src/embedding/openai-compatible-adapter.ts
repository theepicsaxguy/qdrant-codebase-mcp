import { logger } from '../logger';
import { embeddingLatencySeconds } from '../metrics';
import type { EmbeddingAdapter } from './types';

interface OpenAICompatibleAdapterOptions {
  baseUrl: string;
  apiKey?: string;
  modelName: string;
  dimensions?: number;
  headers?: Record<string, string>;
}

interface EmbeddingRecord {
  embedding: unknown;
}

interface EmbeddingsResponse {
  data: EmbeddingRecord[];
}

export class OpenAICompatibleEmbeddingAdapter implements EmbeddingAdapter {
  private readonly log = logger.child({ component: 'OpenAICompatibleEmbeddingAdapter' });
  private _vectorSize = 0;

  constructor(private readonly options: OpenAICompatibleAdapterOptions) {}

  get modelName(): string {
    return this.options.modelName;
  }

  get provider(): 'openai-compatible' {
    return 'openai-compatible';
  }

  get vectorSize(): number {
    return this._vectorSize;
  }

  async initialize(): Promise<void> {
    if (this.options.dimensions !== undefined) {
      this._vectorSize = this.options.dimensions;
      this.log.info({ model: this.modelName, vectorSize: this._vectorSize }, 'Embedding ready');
      return;
    }

    const [probe] = await this.requestEmbeddings(['dimension probe']);
    if (probe === undefined) {
      throw new TypeError('Embedding endpoint returned no vectors for initialization');
    }

    this._vectorSize = probe.length;
    this.log.info({ model: this.modelName, vectorSize: this._vectorSize }, 'Embedding ready');
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return await this.requestEmbeddings(texts);
  }

  async embedQuery(query: string): Promise<number[]> {
    const [vector] = await this.requestEmbeddings([query]);
    if (vector === undefined) {
      throw new TypeError('Embedding endpoint returned no vectors for query');
    }

    return vector;
  }

  private async requestEmbeddings(input: string[]): Promise<number[][]> {
    const end = embeddingLatencySeconds.startTimer();
    const response = await fetch(buildEmbeddingsUrl(this.options.baseUrl), {
      method: 'POST',
      headers: buildHeaders(this.options.apiKey, this.options.headers),
      body: JSON.stringify(
        buildRequestBody(this.options.modelName, input, this.options.dimensions)
      ),
    });
    end();

    if (!response.ok) {
      throw new Error(
        `Embedding request failed with status ${response.status}: ${await response.text()}`
      );
    }

    const payload: unknown = await response.json();
    const vectors = parseEmbeddings(payload);
    if (this._vectorSize === 0 && vectors[0] !== undefined) {
      this._vectorSize = vectors[0].length;
    }

    return vectors;
  }
}

function buildEmbeddingsUrl(baseUrl: string): string {
  return new URL('embeddings', `${baseUrl.replace(/\/+$/, '')}/`).toString();
}

function buildHeaders(
  apiKey: string | undefined,
  extraHeaders: Record<string, string> | undefined
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };

  if (apiKey !== undefined && headers.Authorization === undefined) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

function buildRequestBody(
  model: string,
  input: string[],
  dimensions: number | undefined
): Record<string, number | string | string[]> {
  return {
    input,
    model,
    ...(dimensions === undefined ? {} : { dimensions }),
  };
}

function parseEmbeddings(payload: unknown): number[][] {
  if (!isEmbeddingsResponse(payload)) {
    throw new TypeError('Embedding response is malformed');
  }

  return payload.data.map((item, index) => parseEmbedding(item.embedding, index));
}

function parseEmbedding(embedding: unknown, index: number): number[] {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new TypeError(`Embedding response entry ${index} is missing a numeric vector`);
  }

  return embedding.map((value) => {
    if (typeof value !== 'number') {
      throw new TypeError(`Embedding response entry ${index} contains a non-numeric value`);
    }

    return value;
  });
}

function isEmbeddingsResponse(payload: unknown): payload is EmbeddingsResponse {
  if (typeof payload !== 'object' || payload === null || !('data' in payload)) {
    return false;
  }

  return Array.isArray((payload as EmbeddingsResponse).data);
}
