import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AppConfig, RepoConfig } from './schema';

const SEARCH_ONLY_MODE = 'search-only';

function deriveCollectionName(rootPath: string): string {
  const folderName = path
    .basename(rootPath)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const suffix = crypto.createHash('sha256').update(rootPath).digest('hex').slice(0, 6);
  return `${folderName}-${suffix}`;
}

function expandPath(inputPath: string, baseDir: string): string {
  if (inputPath === '.' || inputPath === './') return baseDir;
  if (inputPath.startsWith('~/')) return path.join(os.homedir(), inputPath.slice(2));
  if (inputPath === '~') return os.homedir();
  if (path.isAbsolute(inputPath)) return inputPath;
  return path.resolve(baseDir, inputPath);
}

export function buildRepoFromEnv(cwd: string, env: NodeJS.ProcessEnv): RepoConfig {
  if (env['SERVER_MODE'] === SEARCH_ONLY_MODE) {
    return buildSearchOnlyRepo(env);
  }

  return buildIndexedRepo(cwd, env);
}

export function buildEnvConfig(
  repo: RepoConfig,
  env: NodeJS.ProcessEnv
): Record<string, number | string | RepoConfig[] | Record<string, string> | undefined> {
  return {
    qdrantUrl: env['QDRANT_URL'] ?? 'http://localhost:6333',
    qdrantApiKey: env['QDRANT_API_KEY'],
    embeddingProvider: env['EMBEDDING_PROVIDER'] ?? 'fastembed',
    embeddingBaseUrl: env['EMBEDDING_BASE_URL'],
    embeddingApiKey: env['EMBEDDING_API_KEY'],
    embeddingHeaders: parseEmbeddingHeaders(env['EMBEDDING_HEADERS_JSON']),
    embeddingDimensions: getEnvNumber(env['EMBEDDING_DIMENSIONS']),
    embeddingModel: env['EMBEDDING_MODEL'],
    serverMode: env['SERVER_MODE'] ?? 'index-and-watch',
    chunkMaxLines: getEnvNumber(env['CHUNK_MAX_LINES'], 150),
    chunkOverlapLines: getEnvNumber(env['CHUNK_OVERLAP_LINES'], 20),
    embeddingBatchSize: getEnvNumber(env['EMBEDDING_BATCH_SIZE'], 64),
    watcherDebounceMs: getEnvNumber(env['WATCHER_DEBOUNCE_MS'], 2000),
    maxFileSizeBytes: getEnvNumber(env['MAX_FILE_SIZE_BYTES'], 1_000_000),
    minScore: getEnvNumber(env['MIN_SCORE'], 0.78),
    port: getEnvNumber(env['PORT'], 3000),
    host: env['HOST'] ?? '0.0.0.0',
    repos: [repo],
  };
}

export function formatIssues(issues: Array<{ path: PropertyKey[]; message: string }>): string {
  return issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
}

export function normalizeRepoPaths(config: AppConfig, configDir: string): void {
  for (const repo of config.repos) {
    if (repo.rootPath !== undefined) {
      repo.rootPath = expandPath(repo.rootPath, configDir);
    }

    if (config.serverMode !== SEARCH_ONLY_MODE && !fileExists(repo.rootPath ?? '')) {
      throw new Error(`Repo root path does not exist: ${repo.rootPath} (repoId: ${repo.repoId})`);
    }
  }
}

export function applyEnvOverrides(
  config: unknown,
  env: NodeJS.ProcessEnv
): Record<string, unknown> {
  const current = isRecord(config) ? { ...config } : {};
  return mergeOverrides(current, [
    ['qdrantUrl', env['QDRANT_URL']],
    ['qdrantApiKey', env['QDRANT_API_KEY']],
    ['port', env['PORT'] === undefined ? undefined : Number(env['PORT'])],
    ['embeddingProvider', env['EMBEDDING_PROVIDER']],
    ['embeddingModel', env['EMBEDDING_MODEL']],
    ['embeddingBaseUrl', env['EMBEDDING_BASE_URL']],
    ['embeddingApiKey', env['EMBEDDING_API_KEY']],
    [
      'embeddingDimensions',
      env['EMBEDDING_DIMENSIONS'] === undefined ? undefined : Number(env['EMBEDDING_DIMENSIONS']),
    ],
    ['serverMode', env['SERVER_MODE']],
    [
      'embeddingHeaders',
      env['EMBEDDING_HEADERS_JSON'] === undefined
        ? undefined
        : parseEmbeddingHeaders(env['EMBEDDING_HEADERS_JSON']),
    ],
  ]);
}

function parseEmbeddingHeaders(raw: string | undefined): Record<string, string> | undefined {
  if (raw === undefined || raw === '') {
    return undefined;
  }

  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new TypeError('EMBEDDING_HEADERS_JSON must be a JSON object');
  }

  const entries = Object.entries(parsed).map(([key, value]) => {
    if (typeof value !== 'string') {
      throw new TypeError('EMBEDDING_HEADERS_JSON values must be strings');
    }

    return [key, value] as const;
  });

  return Object.fromEntries(entries);
}

export function fileExists(filePath: string): boolean {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is resolved from explicit config or cwd-local auto-detection before existence checks
  return fs.existsSync(filePath);
}

export function readTextFile(filePath: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is resolved before reading and only used for explicit configuration files
  return fs.readFileSync(filePath, 'utf-8');
}

function buildSearchOnlyRepo(env: NodeJS.ProcessEnv): RepoConfig {
  return {
    repoId: requireEnv(env, 'REPO_ID'),
    collectionName: requireEnv(env, 'COLLECTION_NAME'),
  };
}

function buildIndexedRepo(cwd: string, env: NodeJS.ProcessEnv): RepoConfig {
  const rootPath = expandPath(env['ROOT_PATH'] ?? '.', cwd);
  const folderName = path.basename(rootPath);
  return {
    repoId: env['REPO_ID'] ?? folderName,
    collectionName: env['COLLECTION_NAME'] ?? deriveCollectionName(rootPath),
    rootPath,
  };
}

function requireEnv(env: NodeJS.ProcessEnv, key: 'REPO_ID' | 'COLLECTION_NAME'): string {
  const value = key === 'REPO_ID' ? env['REPO_ID'] : env['COLLECTION_NAME'];
  if (value === undefined || value === '') {
    throw new Error(`${key} is required when SERVER_MODE=${SEARCH_ONLY_MODE}`);
  }

  return value;
}

function getEnvNumber(value: string | undefined, fallback?: number): number | undefined {
  return value === undefined ? fallback : Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeOverrides(
  current: Record<string, unknown>,
  overrides: Array<[string, number | string | Record<string, string> | undefined]>
): Record<string, unknown> {
  const merged = { ...current };
  for (const [key, value] of overrides) {
    if (value !== undefined) {
      // eslint-disable-next-line security/detect-object-injection -- keys are internal constant config field names
      merged[key] = value;
    }
  }

  return merged;
}
