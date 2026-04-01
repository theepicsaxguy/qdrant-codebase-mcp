import * as fs from 'fs';
import * as path from 'path';
import micromatch from 'micromatch';
import fg from 'fast-glob';
import type { RepoConfig } from '../config/schema';
import { logger, type Logger } from '../logger';
import { normalizePath } from '../utils/hashing';

const DEFAULT_INCLUDE = [
  '**/*.cs',
  '**/*.ts',
  '**/*.tsx',
  '**/*.js',
  '**/*.jsx',
  '**/*.json',
  '**/*.sql',
  '**/*.md',
  '**/*.yml',
  '**/*.yaml',
  '**/*.csproj',
  '**/*.sln',
  '**/*.py',
  '**/*.go',
  '**/*.rs',
  '**/*.java',
  '**/*.sh',
  '**/*.html',
  '**/*.css',
  '**/*.scss',
];

const DEFAULT_IGNORE = [
  '**/.git/**',
  '**/node_modules/**',
  '**/bin/**',
  '**/obj/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/.cache/**',
  '**/__pycache__/**',
  '**/vendor/**',
  '**/.nuget/**',
  '**/packages/**',
];

const MIN_BINARY_DETECT_BYTES = 512;

export function isBinaryFile(filePath: string): boolean {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(MIN_BINARY_DETECT_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, MIN_BINARY_DETECT_BYTES, 0);
    fs.closeSync(fd);
    for (let i = 0; i < bytesRead; i++) {
      // eslint-disable-next-line security/detect-object-injection
      const b = buf[i];
      if (b !== undefined && b === 0) return true;
    }
    return false;
  } catch {
    return true;
  }
}

export function isMinified(content: string): boolean {
  const lines = content.split('\n');
  const longLines = lines.filter((l) => l.length > 500).length;
  return lines.length > 0 && longLines / lines.length > 0.3;
}

function filterSafeFiles(files: string[], root: string): string[] {
  return files.filter((f) => {
    const abs = path.resolve(f);
    return abs.startsWith(root + path.sep) || abs === root;
  });
}

function filterBySize(safe: string[], limit: number, log: Logger): string[] {
  const result: string[] = [];
  for (const f of safe) {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const stat = fs.statSync(f);
      if (stat.size > limit) {
        log.debug({ file: f, size: stat.size }, 'Skipping oversized file');
        continue;
      }
      if (isBinaryFile(f)) {
        log.debug({ file: f }, 'Skipping binary file');
        continue;
      }
      result.push(f);
    } catch (err) {
      log.warn({ file: f, err }, 'Could not stat file, skipping');
    }
  }
  return result;
}

export async function scanRepo(repo: RepoConfig, maxFileSizeBytes: number): Promise<string[]> {
  const log = logger.child({ component: 'FileScanner', repoId: repo.repoId });
  const root = path.resolve(repo.rootPath);
  const include = repo.include ?? DEFAULT_INCLUDE;
  const ignore = [...DEFAULT_IGNORE, ...(repo.ignore ?? [])];
  const limit = repo.maxFileSizeBytes ?? maxFileSizeBytes;

  log.info({ root, patterns: include.length }, 'Scanning repo');

  const files = await fg(include, {
    cwd: root,
    absolute: true,
    ignore,
    onlyFiles: true,
    followSymbolicLinks: false,
    suppressErrors: true,
    dot: false,
  });

  const safe = filterSafeFiles(files, root);
  const result = filterBySize(safe, limit, log);

  log.info({ count: result.length }, 'Scan complete');
  return result;
}

export function isIndexable(
  filePath: string,
  rootPath: string,
  repo: RepoConfig,
  maxFileSizeBytes: number
): boolean {
  const root = path.resolve(rootPath);
  const abs = path.resolve(filePath);

  // Path traversal guard
  if (!abs.startsWith(root + path.sep) && abs !== root) return false;

  const rel = normalizePath(path.relative(root, abs));
  const include = repo.include ?? DEFAULT_INCLUDE;
  const ignore = [...DEFAULT_IGNORE, ...(repo.ignore ?? [])];

  if (!micromatch([rel], include).length) return false;
  if (micromatch([rel], ignore).length) return false;

  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const stat = fs.statSync(abs);
    const limit = repo.maxFileSizeBytes ?? maxFileSizeBytes;
    if (stat.size > limit) return false;
  } catch {
    return false;
  }

  return !isBinaryFile(abs);
}
