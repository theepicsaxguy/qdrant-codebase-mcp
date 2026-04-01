import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as yaml from 'js-yaml';
import { AppConfig, AppConfigSchema, RepoConfig } from './schema';

/**
 * Derive a deterministic but "random-looking" collection name from a path.
 * Format: <folder-name>-<6 hex chars>
 * e.g. "my-project-a3f2c1"
 */
function deriveCollectionName(rootPath: string): string {
  const folderName = path
    .basename(rootPath)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const suffix = crypto.createHash('sha256').update(rootPath).digest('hex').slice(0, 6);
  return `${folderName}-${suffix}`;
}

function expandPath(p: string, baseDir: string): string {
  if (p === '.' || p === './') return baseDir;
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  if (p === '~') return os.homedir();
  if (path.isAbsolute(p)) return p;
  return path.resolve(baseDir, p);
}

/**
 * Build a single-repo config from environment variables.
 * Used when no config file is present.
 */
function buildRepoFromEnv(cwd: string): RepoConfig {
  const rootPath = expandPath(process.env['ROOT_PATH'] ?? '.', cwd);
  const folderName = path.basename(rootPath);
  return {
    repoId: process.env['REPO_ID'] ?? folderName,
    collectionName:
      process.env['COLLECTION_NAME'] ?? deriveCollectionName(rootPath),
    rootPath,
  };
}

/**
 * Build full AppConfig entirely from environment variables.
 * rootPath defaults to the current working directory.
 * collectionName defaults to <folder>-<hash>.
 */
export function loadConfigFromEnv(): AppConfig {
  const cwd = process.cwd();
  const repo = buildRepoFromEnv(cwd);

  const result = AppConfigSchema.safeParse({
    qdrantUrl: process.env['QDRANT_URL'] ?? 'http://localhost:6333',
    qdrantApiKey: process.env['QDRANT_API_KEY'] ?? undefined,
    embeddingModel: process.env['EMBEDDING_MODEL'] ?? 'fast-bge-small-en-v1.5',
    chunkMaxLines: process.env['CHUNK_MAX_LINES']
      ? Number(process.env['CHUNK_MAX_LINES'])
      : 150,
    chunkOverlapLines: process.env['CHUNK_OVERLAP_LINES']
      ? Number(process.env['CHUNK_OVERLAP_LINES'])
      : 20,
    embeddingBatchSize: process.env['EMBEDDING_BATCH_SIZE']
      ? Number(process.env['EMBEDDING_BATCH_SIZE'])
      : 64,
    watcherDebounceMs: process.env['WATCHER_DEBOUNCE_MS']
      ? Number(process.env['WATCHER_DEBOUNCE_MS'])
      : 300,
    maxFileSizeBytes: process.env['MAX_FILE_SIZE_BYTES']
      ? Number(process.env['MAX_FILE_SIZE_BYTES'])
      : 1_000_000,
    port: process.env['PORT'] ? Number(process.env['PORT']) : 3000,
    host: process.env['HOST'] ?? '0.0.0.0',
    repos: [repo],
  });

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return result.data;
}

/**
 * Load AppConfig from a YAML/JSON file, then apply env var overrides.
 */
export function loadConfigFromFile(configPath: string): AppConfig {
  const resolved = path.resolve(configPath);
  const configDir = path.dirname(resolved);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }

  const raw = fs.readFileSync(resolved, 'utf-8');
  const parsed: unknown = resolved.endsWith('.json')
    ? JSON.parse(raw)
    : yaml.load(raw);

  const result = AppConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid config file:\n${issues}`);
  }

  const cfg = result.data;

  // Env vars always override file values
  if (process.env['QDRANT_URL']) cfg.qdrantUrl = process.env['QDRANT_URL'];
  if (process.env['QDRANT_API_KEY']) cfg.qdrantApiKey = process.env['QDRANT_API_KEY'];
  if (process.env['PORT']) cfg.port = Number(process.env['PORT']);
  if (process.env['EMBEDDING_MODEL']) cfg.embeddingModel = process.env['EMBEDDING_MODEL'];

  // Expand repo root paths (allow . ~/relative paths relative to config dir)
  for (const repo of cfg.repos) {
    repo.rootPath = expandPath(repo.rootPath, configDir);
    if (!repo.collectionName) {
      repo.collectionName = deriveCollectionName(repo.rootPath);
    }
    if (!fs.existsSync(repo.rootPath)) {
      throw new Error(
        `Repo root path does not exist: ${repo.rootPath} (repoId: ${repo.repoId})`
      );
    }
  }

  return cfg;
}

/**
 * Main entry: prefer CONFIG_PATH or config.yml if present, otherwise env-only.
 */
export function loadConfig(configPath?: string): AppConfig {
  const explicit = configPath ?? process.env['CONFIG_PATH'];
  if (explicit) return loadConfigFromFile(explicit);

  // Auto-detect config.yml in cwd
  const autoDetect = path.resolve(process.cwd(), 'config.yml');
  if (fs.existsSync(autoDetect)) return loadConfigFromFile(autoDetect);

  // Pure env-var mode
  return loadConfigFromEnv();
}
