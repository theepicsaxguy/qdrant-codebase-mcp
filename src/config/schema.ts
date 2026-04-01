import { z } from 'zod';

const RepoConfigSchema = z.object({
  repoId: z.string().min(1),
  collectionName: z.string().min(1),
  rootPath: z.string().min(1),
  include: z.array(z.string()).optional(),
  ignore: z.array(z.string()).optional(),
  maxFileSizeBytes: z.number().positive().optional(),
  language: z.string().optional(),
});

const AppConfigSchema = z.object({
  qdrantUrl: z.string().url().default('http://localhost:6333'),
  qdrantApiKey: z.string().optional(),
  embeddingModel: z.string().default('BAAI/bge-small-en-v1.5'),
  chunkMaxLines: z.number().int().positive().default(150),
  chunkOverlapLines: z.number().int().nonnegative().default(20),
  embeddingBatchSize: z.number().int().positive().default(64),
  watcherDebounceMs: z.number().int().positive().default(300),
  maxFileSizeBytes: z.number().positive().default(1_000_000),
  port: z.number().int().positive().default(3000),
  host: z.string().default('0.0.0.0'),
  repos: z.array(RepoConfigSchema).min(1),
});

export type RepoConfig = z.infer<typeof RepoConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
export { AppConfigSchema };
