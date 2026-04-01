import { execFile, spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const gitRepoCache = new Map<string, boolean>();
const GIT_FILE_BUFFER_BYTES = 50 * 1024 * 1024;

function normalizeGitPath(filePath: string): string {
  return filePath.replaceAll(path.sep, '/');
}

function parseNulSeparatedPaths(output: Buffer | string): string[] {
  const text = typeof output === 'string' ? output : output.toString('utf8');
  return text.split('\0').filter((entry) => entry.length > 0);
}

function hasGitRepoSync(rootPath: string): boolean {
  const cached = gitRepoCache.get(rootPath);
  if (cached !== undefined) {
    return cached;
  }

  const result = spawnSync('git', ['-C', rootPath, 'rev-parse', '--is-inside-work-tree'], {
    stdio: 'ignore',
  });
  const isRepo = result.status === 0;
  gitRepoCache.set(rootPath, isRepo);
  return isRepo;
}

async function hasGitRepo(rootPath: string): Promise<boolean> {
  const cached = gitRepoCache.get(rootPath);
  if (cached !== undefined) {
    return cached;
  }

  try {
    await execFileAsync('git', ['-C', rootPath, 'rev-parse', '--is-inside-work-tree']);
    gitRepoCache.set(rootPath, true);
    return true;
  } catch {
    gitRepoCache.set(rootPath, false);
    return false;
  }
}

export async function listGitVisibleFiles(rootPath: string): Promise<string[] | null> {
  if (!(await hasGitRepo(rootPath))) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', rootPath, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { encoding: 'buffer', maxBuffer: GIT_FILE_BUFFER_BYTES }
    );
    return parseNulSeparatedPaths(stdout).map((entry) => path.resolve(rootPath, entry));
  } catch {
    return null;
  }
}

export function isGitIgnored(rootPath: string, filePath: string): boolean {
  if (!hasGitRepoSync(rootPath)) {
    return false;
  }

  const relativePath = path.relative(rootPath, filePath);
  if (relativePath.length === 0 || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return false;
  }

  const result = spawnSync('git', ['-C', rootPath, 'check-ignore', '-q', '--stdin'], {
    input: `${normalizeGitPath(relativePath)}\n`,
    stdio: ['pipe', 'ignore', 'ignore'],
  });

  return result.status === 0;
}
