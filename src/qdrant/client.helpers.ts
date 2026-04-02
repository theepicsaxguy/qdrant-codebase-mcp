import { QdrantClient } from '@qdrant/js-client-rest';
import { buildPort } from './adapter.helpers';

export function createQdrantClient(qdrantUrl: string, apiKey?: string): QdrantClient {
  try {
    const u = new URL(qdrantUrl);
    const port = buildPort(u);
    return new QdrantClient({
      host: u.hostname,
      port,
      https: u.protocol === 'https:',
      prefix: u.pathname === '/' ? undefined : u.pathname.replace(/\/+$/, ''),
      apiKey,
      headers: { 'User-Agent': 'qdrant-codebase-mcp' },
    });
  } catch {
    return new QdrantClient({ url: qdrantUrl, apiKey });
  }
}
