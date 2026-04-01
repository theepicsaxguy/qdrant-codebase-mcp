import { z } from 'zod';

const DEFAULT_FASTEMBED_MODEL = 'fast-bge-small-en-v1.5';
const FASTEMBED_PROVIDER = 'fastembed';
const OPENAI_COMPATIBLE_PROVIDER = 'openai-compatible';
const INDEX_AND_WATCH_MODE = 'index-and-watch';
const SEARCH_ONLY_MODE = 'search-only';

export const RepoConfigSchema = z.object({
  repoId: z.string().min(1),
  collectionName: z.string().min(1),
  rootPath: z.string().min(1).optional(),
  include: z.array(z.string()).optional(),
  ignore: z.array(z.string()).optional(),
  maxFileSizeBytes: z.number().positive().optional(),
  language: z.string().optional(),
});

const BaseAppConfigSchema = z.object({
  qdrantUrl: z.string().url().default('http://localhost:6333'),
  qdrantApiKey: z.string().optional(),
  embeddingProvider: z
    .enum([FASTEMBED_PROVIDER, OPENAI_COMPATIBLE_PROVIDER])
    .default(FASTEMBED_PROVIDER),
  embeddingBaseUrl: z.string().url().optional(),
  embeddingApiKey: z.string().optional(),
  embeddingHeaders: z.record(z.string(), z.string()).optional(),
  embeddingDimensions: z.number().int().positive().optional(),
  embeddingModel: z.string().optional(),
  serverMode: z.enum([INDEX_AND_WATCH_MODE, SEARCH_ONLY_MODE]).default(INDEX_AND_WATCH_MODE),
  chunkMaxLines: z.number().int().positive().default(150),
  chunkOverlapLines: z.number().int().nonnegative().default(20),
  embeddingBatchSize: z.number().int().positive().default(64),
  watcherDebounceMs: z.number().int().positive().default(2000),
  maxFileSizeBytes: z.number().positive().default(1_000_000),
  minScore: z.number().min(0).max(1).default(0.78),
  port: z.number().int().positive().default(3000),
  host: z.string().default('0.0.0.0'),
  repos: z.array(RepoConfigSchema).min(1),
});

export const AppConfigSchema = BaseAppConfigSchema.superRefine((config, context) => {
  if (config.embeddingProvider === OPENAI_COMPATIBLE_PROVIDER) {
    if (!config.embeddingBaseUrl) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'embeddingBaseUrl is required when embeddingProvider is openai-compatible',
        path: ['embeddingBaseUrl'],
      });
    }

    if (!config.embeddingModel) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'embeddingModel is required when embeddingProvider is openai-compatible',
        path: ['embeddingModel'],
      });
    }
  }

  for (const [index, repo] of config.repos.entries()) {
    if (config.serverMode === INDEX_AND_WATCH_MODE && !repo.rootPath) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'rootPath is required when serverMode is index-and-watch',
        path: ['repos', index, 'rootPath'],
      });
    }
  }
}).transform((config) => ({
  ...config,
  embeddingModel:
    config.embeddingModel ??
    (config.embeddingProvider === FASTEMBED_PROVIDER ? DEFAULT_FASTEMBED_MODEL : ''),
}));

export type RepoConfig = z.infer<typeof RepoConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
export type EmbeddingProvider = AppConfig['embeddingProvider'];
export { DEFAULT_FASTEMBED_MODEL };
