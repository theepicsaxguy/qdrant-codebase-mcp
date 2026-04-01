import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const SERVICE_URL = (process.env['SEARCH_SERVICE_URL'] ?? 'http://localhost:3000').replace(/\/$/, '');

interface SearchResult {
  score: number;
  filePath: string;
  startLine: number;
  endLine: number;
  codeChunk: string;
  repoId: string;
}

interface RepoInfo {
  repoId: string;
  collectionName: string;
  rootPath: string;
}

interface RepoStatus {
  repoId: string;
  collectionName: string;
  model: string;
  vectorSize: number;
  indexingInProgress: boolean;
  status: {
    indexing_complete: boolean;
    started_at: number | null;
    completed_at: number | null;
    last_error: string | null;
  };
}

async function callService<T>(
  path: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: unknown
): Promise<T> {
  const resp = await fetch(`${SERVICE_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`HTTP ${resp.status} from qdrant-codebase-query: ${text}`);
  }
  return resp.json() as Promise<T>;
}

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'qdrant-codebase-query', version: '0.1.0' },
    { capabilities: {} }
  );

  // ── search_code ──────────────────────────────────────────────────────────
  server.registerTool(
    'search_code',
    {
      title: 'Search Code',
      description:
        'Semantically search across indexed code repositories using natural language. ' +
        'Returns relevant code chunks with file paths, line numbers, and similarity scores. ' +
        'Use this to find where specific behaviour is implemented, e.g. "where are SignalR messages sent to clients".',
      inputSchema: {
        query: z.string().min(1).max(2000).describe(
          'Natural language description of the code you are looking for'
        ),
        repoId: z.string().optional().describe(
          'Repository ID to search within. Omit to search all repos.'
        ),
        directoryPrefix: z.string().optional().describe(
          'Restrict results to files under this directory prefix, e.g. "src/Application"'
        ),
        language: z.string().optional().describe(
          'Filter by language, e.g. "csharp", "typescript", "python"'
        ),
        limit: z.number().int().min(1).max(50).default(10).optional().describe(
          'Maximum number of results'
        ),
        minScore: z.number().min(0).max(1).default(0.45).optional().describe(
          'Minimum similarity score 0–1 (default 0.45)'
        ),
      },
    },
    async ({ query, repoId, directoryPrefix, language, limit, minScore }) => {
      try {
        const path = repoId
          ? `/repos/${encodeURIComponent(repoId)}/search`
          : '/search';
        const result = await callService<{ results: SearchResult[] }>(path, 'POST', {
          query,
          repoId,
          directoryPrefix,
          language,
          limit,
          minScore,
        });

        if (result.results.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No results found for this query.' }],
          };
        }

        const text = result.results
          .map(
            (r, i) =>
              `### ${i + 1}. \`${r.filePath}\` lines ${r.startLine}–${r.endLine}` +
              (r.repoId ? ` · repo: ${r.repoId}` : '') +
              ` · score: ${r.score.toFixed(3)}\n` +
              '```\n' +
              r.codeChunk +
              '\n```'
          )
          .join('\n\n---\n\n');

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Search failed: ${err instanceof Error ? err.message : String(err)}\n\nMake sure qdrant-codebase-query is running at ${SERVICE_URL}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── list_repos ───────────────────────────────────────────────────────────
  server.registerTool(
    'list_repos',
    {
      title: 'List Indexed Repos',
      description: 'List all code repositories currently available for search.',
      inputSchema: {},
    },
    async () => {
      try {
        const result = await callService<{ repos: RepoInfo[] }>('/repos');
        const text = result.repos
          .map((r) => `- **${r.repoId}** — collection: \`${r.collectionName}\`, path: \`${r.rootPath}\``)
          .join('\n');
        return {
          content: [
            { type: 'text' as const, text: `Available repositories:\n\n${text || '(none)'}` },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  // ── get_repo_status ──────────────────────────────────────────────────────
  server.registerTool(
    'get_repo_status',
    {
      title: 'Get Repo Indexing Status',
      description: 'Get the current indexing status for a specific repository.',
      inputSchema: {
        repoId: z.string().describe('The repository ID to check'),
      },
    },
    async ({ repoId }) => {
      try {
        const r = await callService<RepoStatus>(`/repos/${encodeURIComponent(repoId)}/status`);
        const s = r.status;
        const lines = [
          `**Repo:** ${r.repoId}`,
          `**Collection:** ${r.collectionName}`,
          `**Embedding model:** ${r.model} (${r.vectorSize}-dim)`,
          `**Indexing complete:** ${s.indexing_complete}`,
          `**Currently indexing:** ${r.indexingInProgress}`,
          s.started_at
            ? `**Last started:** ${new Date(s.started_at).toISOString()}`
            : null,
          s.completed_at
            ? `**Last completed:** ${new Date(s.completed_at).toISOString()}`
            : null,
          s.last_error ? `**Last error:** ${s.last_error}` : null,
        ]
          .filter(Boolean)
          .join('\n');
        return { content: [{ type: 'text' as const, text: lines }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  // ── trigger_reindex ──────────────────────────────────────────────────────
  server.registerTool(
    'trigger_reindex',
    {
      title: 'Trigger Re-index',
      description:
        'Trigger a full re-index of a repository. The indexing runs asynchronously in the background.',
      inputSchema: {
        repoId: z.string().describe('The repository ID to re-index'),
      },
    },
    async ({ repoId }) => {
      try {
        const result = await callService<{ status: string; repoId: string }>(
          `/repos/${encodeURIComponent(repoId)}/reindex`,
          'POST'
        );
        return {
          content: [
            { type: 'text' as const, text: `${result.status} for repo "${result.repoId}"` },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}
