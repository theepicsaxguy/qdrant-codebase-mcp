import { FlagEmbedding, type EmbeddingModel } from 'fastembed';
import { logger } from '../logger';
import { embeddingLatencySeconds } from '../metrics';
import type { EmbeddingAdapter } from './types';

const MODEL_DIMS = new Map<string, number>([
  ['fast-bge-small-en-v1.5', 384],
  ['fast-bge-base-en-v1.5', 768],
  ['fast-all-MiniLM-L6-v2', 384],
  ['fast-bge-small-en', 384],
  ['fast-bge-base-en', 768],
  ['fast-bge-small-zh-v1.5', 512],
  ['fast-multilingual-e5-large', 1024],
]);

export class FastEmbedEmbeddingAdapter implements EmbeddingAdapter {
  private model!: FlagEmbedding;
  private _vectorSize!: number;
  private readonly log = logger.child({ component: 'FastEmbedEmbeddingAdapter' });

  constructor(
    public readonly modelName: string,
    private readonly batchSize = 64
  ) {}

  get provider(): 'fastembed' {
    return 'fastembed';
  }

  get vectorSize(): number {
    return this._vectorSize;
  }

  async initialize(): Promise<void> {
    this.log.info({ model: this.modelName }, 'Loading FastEmbed model');
    this.model = await FlagEmbedding.init({
      model: this.modelName as Exclude<EmbeddingModel, EmbeddingModel.CUSTOM>,
      cacheDir: process.env['MODEL_CACHE_DIR'] ?? './models',
    });
    this._vectorSize = await detectVectorSize(this.model, this.modelName);
    this.log.info({ model: this.modelName, vectorSize: this._vectorSize }, 'Model ready');
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const end = embeddingLatencySeconds.startTimer();
    const results: number[][] = [];
    const generator = this.model.passageEmbed(texts, this.batchSize);

    for await (const batch of generator) {
      results.push(...batch.map((vector) => Array.from(vector)));
    }

    end();
    return results;
  }

  async embedQuery(query: string): Promise<number[]> {
    return Array.from(await this.model.queryEmbed(query));
  }
}

async function detectVectorSize(model: FlagEmbedding, modelName: string): Promise<number> {
  const generator = model.embed(['dimension probe'], 1);
  const first = await generator.next();
  if (first.done) {
    return defaultVectorSize(modelName);
  }

  return first.value[0]?.length ?? defaultVectorSize(modelName);
}

function defaultVectorSize(modelName: string): number {
  return MODEL_DIMS.get(modelName) ?? 384;
}
