import type { AppConfig } from '../config/schema';
import { FastEmbedEmbeddingAdapter } from './fastembed-adapter';
import { OpenAICompatibleEmbeddingAdapter } from './openai-compatible-adapter';
import type { EmbeddingAdapter } from './types';

export function createEmbeddingAdapter(config: AppConfig): EmbeddingAdapter {
  if (config.embeddingProvider === 'openai-compatible') {
    return new OpenAICompatibleEmbeddingAdapter({
      baseUrl: config.embeddingBaseUrl ?? '',
      apiKey: config.embeddingApiKey,
      modelName: config.embeddingModel,
      dimensions: config.embeddingDimensions,
      headers: config.embeddingHeaders,
    });
  }

  return new FastEmbedEmbeddingAdapter(config.embeddingModel, config.embeddingBatchSize);
}
