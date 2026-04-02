import type { EmbeddingProvider } from '../config/schema';

export interface EmbeddingAdapter {
  readonly modelName: string;
  readonly provider: EmbeddingProvider;
  readonly vectorSize: number;

  initialize(): Promise<void>;
  embedBatch(texts: string[]): Promise<number[][]>;
  embedQuery(query: string): Promise<number[]>;
}
