import { createHash } from 'crypto';
import * as path from 'path';

/**
 * Generate a deterministic SHA-256 based point ID (as UUID-like hex string truncated to 32 hex chars).
 * Uses format: sha256(repoId:filePath:startLine:endLine) -> hex string
 */
export function chunkId(repoId: string, filePath: string, startLine: number, endLine: number): string {
  const input = `${repoId}:${filePath}:${startLine}:${endLine}`;
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Generate a SHA-256 content hash for a chunk string.
 */
export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Detect language from file extension.
 */
const EXT_TO_LANG: Record<string, string> = {
  '.cs': 'csharp',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.json': 'json',
  '.sql': 'sql',
  '.md': 'markdown',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.csproj': 'xml',
  '.sln': 'text',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.rb': 'ruby',
  '.php': 'php',
  '.sh': 'bash',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
};

export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_LANG[ext] ?? 'text';
}

/**
 * Build pathSegments record from a relative file path.
 * e.g. "src/Application/Chat/Handler.cs" -> { "0": "src", "1": "Application", "2": "Chat", "3": "Handler.cs" }
 */
export function buildPathSegments(filePath: string): Record<string, string> {
  const segments = filePath.split(/[\\/]/).filter(Boolean);
  return segments.reduce<Record<string, string>>((acc, seg, i) => {
    acc[String(i)] = seg;
    return acc;
  }, {});
}

/**
 * Safely resolve an absolute path and ensure it stays within a root boundary.
 * Returns null if the resolved path escapes the root (path traversal protection).
 */
export function safeResolveWithinRoot(rootPath: string, filePath: string): string | null {
  const resolved = path.resolve(rootPath, filePath);
  const normalizedRoot = path.resolve(rootPath);
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    return null;
  }
  return resolved;
}

/**
 * Normalise a path to use forward slashes (cross-platform consistency).
 */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}
