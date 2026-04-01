import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SearchService } from '../search/service';
import type { QdrantAdapter } from '../qdrant/adapter';
import type { IndexingCoordinator } from '../indexing/coordinator';
import type { EmbeddingAdapter } from '../embedding/adapter';
import type { AppConfig } from '../config/schema';

export function createMcpServer(
  searchService: SearchService,
  qdrantAdapters: Map<string, QdrantAdapter>,
  config: AppConfig,
  embedding: EmbeddingAdapter,
  coordinator: IndexingCoordinator
): McpServer {
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
    async (args: {
      query: string;
      repoId?: string;
      directoryPrefix?: string;
      language?: string;
      limit?: number;
      minScore?: number;
    }) => {
      try {
        const result = await searchService.search({
          query: args.query,
          repoId: args.repoId,
          directoryPrefix: args.directoryPrefix,
          language: args.language,
          limit: args.limit ?? 10,
          minScore: args.minScore ?? 0.45,
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
              text: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
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
      const text = config.repos
        .map((r) => `- **${r.repoId}** — collection: \`${r.collectionName}\`, path: \`${r.rootPath}\``)
        .join('\n');
      return {
        content: [
          { type: 'text' as const, text: `Available repositories:\n\n${text || '(none)'}` },
        ],
      };
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
    async (args: { repoId: string }) => {
      try {
        const adapter = qdrantAdapters.get(args.repoId);
        if (!adapter) {
          return {
            content: [{ type: 'text' as const, text: `Unknown repo: ${args.repoId}` }],
            isError: true,
          };
        }
        const s = await adapter.getIndexingStatus();
        const lines = [
          `**Repo:** ${args.repoId}`,
          `**Embedding model:** ${embedding.modelName} (${embedding.vectorSize}-dim)`,
          `**Indexing complete:** ${s?.indexing_complete ?? 'unknown'}`,
          `**Currently indexing:** ${coordinator.isIndexing(args.repoId)}`,
          s?.started_at ? `**Last started:** ${new Date(s.started_at).toISOString()}` : null,
          s?.completed_at
            ? `**Last completed:** ${new Date(s.completed_at).toISOString()}`
            : null,
          s?.last_error ? `**Last error:** ${s.last_error}` : null,
        ]
          .filter(Boolean)
          .join('\n');
        return { content: [{ type: 'text' as const, text: lines }] };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
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
    async (args: { repoId: string }) => {
      if (!qdrantAdapters.has(args.repoId)) {
        return {
          content: [{ type: 'text' as const, text: `Unknown repo: ${args.repoId}` }],
          isError: true,
        };
      }
      if (coordinator.isIndexing(args.repoId)) {
        return {
          content: [{ type: 'text' as const, text: 'Indexing already in progress.' }],
        };
      }
      setImmediate(() => {
        coordinator.fullIndex(args.repoId).catch(() => undefined);
      });
      return {
        content: [
          { type: 'text' as const, text: `Re-index started for repo "${args.repoId}"` },
        ],
      };
    }
  );

  return server;
}

