import { createHash } from 'crypto';
import * as path from 'path';

/**
 * Generate a deterministic RFC 4122 UUID string for a chunk.
 * Uses the first 128 bits of SHA-256(repoId:filePath:startLine:endLine) formatted
 * as a UUID string — the only ID format Qdrant accepts for string point IDs.
 */
export function chunkId(
  repoId: string,
  filePath: string,
  startLine: number,
  endLine: number
): string {
  const input = `${repoId}:${filePath}:${startLine}:${endLine}`;
  const bytes = createHash('sha256').update(input).digest().subarray(0, 16);
  const byte6 = bytes[6];
  const byte8 = bytes[8];
  if (byte6 === undefined || byte8 === undefined) {
    throw new Error('Failed to derive a deterministic chunk UUID');
  }
  bytes[6] = (byte6 & 0x0f) | 0x40;
  bytes[8] = (byte8 & 0x3f) | 0x80;
  const h = Buffer.from(bytes).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Generate a SHA-256 content hash for a chunk string.
 */
export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Detect language from file extension.
 * Uses Map.get() (not bracket access) to avoid object-injection lint warnings.
 */
const EXT_TO_LANG = new Map<string, string>([
  ['.cs', 'csharp'],
  ['.ts', 'typescript'],
  ['.tsx', 'typescript'],
  ['.js', 'javascript'],
  ['.jsx', 'javascript'],
  ['.json', 'json'],
  ['.sql', 'sql'],
  ['.md', 'markdown'],
  ['.yml', 'yaml'],
  ['.yaml', 'yaml'],
  ['.csproj', 'xml'],
  ['.sln', 'text'],
  ['.py', 'python'],
  ['.go', 'go'],
  ['.rs', 'rust'],
  ['.java', 'java'],
  ['.rb', 'ruby'],
  ['.php', 'php'],
  ['.sh', 'bash'],
  ['.html', 'html'],
  ['.css', 'css'],
  ['.scss', 'scss'],
]);

export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_LANG.get(ext) ?? 'text';
}

/**
 * Build pathSegments record from a relative file path.
 * e.g. "src/Application/Chat/Handler.cs" -> { "0": "src", "1": "Application", "2": "Chat", "3": "Handler.cs" }
 */
export function buildPathSegments(filePath: string): Record<string, string> {
  const segments = filePath.split(/[\\/]/).filter(Boolean);
  return Object.fromEntries(segments.map((seg, i) => [String(i), seg]));
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
