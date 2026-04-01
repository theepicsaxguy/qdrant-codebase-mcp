import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as yaml from 'js-yaml';
import { AppConfigSchema, type AppConfig, type RepoConfig } from './schema';

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
    collectionName: process.env['COLLECTION_NAME'] ?? deriveCollectionName(rootPath),
    rootPath,
  };
}

/**
 * Build full AppConfig entirely from environment variables.
 * rootPath defaults to the current working directory.
 * collectionName defaults to <folder>-<hash>.
 */
function loadConfigFromEnv(): AppConfig {
  const cwd = process.cwd();
  const repo = buildRepoFromEnv(cwd);
  const result = AppConfigSchema.safeParse(buildEnvConfig(repo));

  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${formatIssues(result.error.issues)}`);
  }

  return result.data;
}

function buildEnvConfig(repo: RepoConfig): Record<string, unknown> {
  return {
    qdrantUrl: process.env['QDRANT_URL'] ?? 'http://localhost:6333',
    qdrantApiKey: process.env['QDRANT_API_KEY'],
    embeddingModel: process.env['EMBEDDING_MODEL'] ?? 'fast-bge-small-en-v1.5',
    chunkMaxLines: getEnvNumber(process.env['CHUNK_MAX_LINES'], 150),
    chunkOverlapLines: getEnvNumber(process.env['CHUNK_OVERLAP_LINES'], 20),
    embeddingBatchSize: getEnvNumber(process.env['EMBEDDING_BATCH_SIZE'], 64),
    watcherDebounceMs: getEnvNumber(process.env['WATCHER_DEBOUNCE_MS'], 300),
    maxFileSizeBytes: getEnvNumber(process.env['MAX_FILE_SIZE_BYTES'], 1_000_000),
    minScore: getEnvNumber(process.env['MIN_SCORE'], 0.78),
    port: getEnvNumber(process.env['PORT'], 3000),
    host: process.env['HOST'] ?? '0.0.0.0',
    repos: [repo],
  };
}

/**
 * Load AppConfig from a YAML/JSON file, then apply env var overrides.
 */
function loadConfigFromFile(configPath: string): AppConfig {
  const resolved = path.resolve(configPath);
  const configDir = path.dirname(resolved);

  if (!fileExists(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }

  const parsed = parseConfigFile(resolved);

  const result = AppConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid config file:\n${formatIssues(result.error.issues)}`);
  }

  const cfg = result.data;

  applyEnvOverrides(cfg);
  normalizeRepoPaths(cfg, configDir);

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
  if (fileExists(autoDetect)) return loadConfigFromFile(autoDetect);

  // Pure env-var mode
  return loadConfigFromEnv();
}

function getEnvNumber(value: string | undefined, fallback: number): number {
  return value ? Number(value) : fallback;
}

function formatIssues(issues: Array<{ path: PropertyKey[]; message: string }>): string {
  return issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
}

function parseConfigFile(resolved: string): unknown {
  const raw = readTextFile(resolved);
  return resolved.endsWith('.json') ? JSON.parse(raw) : yaml.load(raw);
}

function applyEnvOverrides(config: AppConfig): void {
  const qdrantUrl = process.env['QDRANT_URL'];
  const qdrantApiKey = process.env['QDRANT_API_KEY'];
  const port = process.env['PORT'];
  const embeddingModel = process.env['EMBEDDING_MODEL'];

  if (qdrantUrl) config.qdrantUrl = qdrantUrl;
  if (qdrantApiKey) config.qdrantApiKey = qdrantApiKey;
  if (port) config.port = Number(port);
  if (embeddingModel) config.embeddingModel = embeddingModel;
}

function normalizeRepoPaths(config: AppConfig, configDir: string): void {
  for (const repo of config.repos) {
    repo.rootPath = expandPath(repo.rootPath, configDir);
    if (!repo.collectionName) {
      repo.collectionName = deriveCollectionName(repo.rootPath);
    }

    if (!fileExists(repo.rootPath)) {
      throw new Error(`Repo root path does not exist: ${repo.rootPath} (repoId: ${repo.repoId})`);
    }
  }
}

function fileExists(filePath: string): boolean {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is resolved from explicit config or cwd-local auto-detection before existence checks
  return fs.existsSync(filePath);
}

function readTextFile(filePath: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is resolved before reading and only used for explicit configuration files
  return fs.readFileSync(filePath, 'utf-8');
}
