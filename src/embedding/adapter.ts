import { FlagEmbedding, EmbeddingModel } from 'fastembed';
import { logger } from '../logger';
import { embeddingLatencySeconds } from '../metrics';

const MODEL_DIMS: Record<string, number> = {
  'BAAI/bge-small-en-v1.5': 384,
  'BAAI/bge-base-en-v1.5': 768,
  'BAAI/bge-large-en-v1.5': 1024,
  'sentence-transformers/all-MiniLM-L6-v2': 384,
};

export class EmbeddingAdapter {
  private model!: FlagEmbedding;
  private _vectorSize!: number;
  private _modelName: string;
  private readonly batchSize: number;
  private readonly log = logger.child({ component: 'EmbeddingAdapter' });

  constructor(modelName: string, batchSize = 64) {
    this._modelName = modelName;
    this.batchSize = batchSize;
  }

  async initialize(): Promise<void> {
    this.log.info({ model: this._modelName }, 'Loading FastEmbed model');
    const supportedModels = FlagEmbedding.listSupportedModels();
    const found = supportedModels.find(
      (m: { model: string }) => m.model === this._modelName
    );

    if (!found) {
      const names = supportedModels.map((m: { model: string }) => m.model).join(', ');
      throw new Error(
        `Embedding model "${this._modelName}" is not supported. Available: ${names}`
      );
    }

    this.model = await FlagEmbedding.init({
      model: this._modelName as EmbeddingModel,
      cacheDir: process.env['MODEL_CACHE_DIR'] ?? './models',
    });

    // Detect vector dimension by embedding a probe string
    const probe = 'dimension probe';
    const gen = this.model.embed([probe], 1);
    const first = await gen[Symbol.asyncIterator]().next();
    if (first.done || !first.value) {
      throw new Error('Failed to detect embedding dimension from model');
    }
    const firstBatch = first.value as number[][];
    this._vectorSize = firstBatch[0]?.length ?? (MODEL_DIMS[this._modelName] ?? 384);

    this.log.info({ model: this._modelName, vectorSize: this._vectorSize }, 'Model ready');
  }

  get vectorSize(): number {
    return this._vectorSize;
  }

  get modelName(): string {
    return this._modelName;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const end = embeddingLatencySeconds.startTimer();
    const results: number[][] = [];
    const gen = this.model.passageEmbed(texts, this.batchSize);
    for await (const batch of gen) {
      const b = batch as number[][];
      results.push(...b);
    }
    end();
    return results;
  }

  async embedQuery(query: string): Promise<number[]> {
    const vector = await this.model.queryEmbed(query);
    return Array.from(vector as Float32Array | number[]);
  }
}
