import { FlagEmbedding, EmbeddingModel } from 'fastembed';
import { logger } from '../logger';
import { embeddingLatencySeconds } from '../metrics';

// Known vector dimensions per fastembed v1/v2 supported models
const MODEL_DIMS: Record<string, number> = {
  'fast-bge-small-en-v1.5': 384,
  'fast-bge-base-en-v1.5': 768,
  'fast-all-MiniLM-L6-v2': 384,
  'fast-bge-small-en': 384,
  'fast-bge-base-en': 768,
  'fast-bge-small-zh-v1.5': 512,
  'fast-multilingual-e5-large': 1024,
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

    this.model = await FlagEmbedding.init({
      model: this._modelName as EmbeddingModel,
      cacheDir: process.env['MODEL_CACHE_DIR'] ?? './models',
    });

    // Detect vector dimension by embedding a probe string
    const probe = 'dimension probe';
    const gen = this.model.embed([probe], 1);
    const first = await gen.next();
    if (first.done || !first.value) {
      // Fall back to known dimensions map
      this._vectorSize = MODEL_DIMS[this._modelName] ?? 384;
    } else {
      this._vectorSize = first.value[0]?.length ?? (MODEL_DIMS[this._modelName] ?? 384);
    }

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
    return this.model.queryEmbed(query);
  }
}
