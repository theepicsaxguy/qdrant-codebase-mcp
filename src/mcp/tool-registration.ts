import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AppConfig } from '../config/schema';
import type { IndexingCoordinator } from '../indexing/coordinator';
import type { McpServerDependencies } from './server';
import type { QdrantAdapter } from '../qdrant/adapter';
export { registerSearchCodeTool } from './search-code-tool';
import { buildTextResponse, type TextToolResponse } from './tool-response';

export function registerListReposTool(server: McpServer, config: AppConfig): void {
  server.registerTool(
    'list_repos',
    {
      title: 'List Indexed Repos',
      description: 'List all code repositories currently available for search.',
      inputSchema: {},
    },
    () => buildTextResponse(`Available repositories:\n\n${formatRepos(config)}`)
  );
}

export function registerGetRepoStatusTool(
  server: McpServer,
  dependencies: McpServerDependencies
): void {
  server.registerTool(
    'get_repo_status',
    {
      title: 'Get Repo Indexing Status',
      description: 'Get the current indexing status for a specific repository.',
      inputSchema: {
        repoId: z.string().describe('The repository ID to check'),
      },
    },
    async (args: { repoId: string }) => await handleGetRepoStatus(dependencies, args.repoId)
  );
}

export function registerTriggerReindexTool(
  server: McpServer,
  config: AppConfig,
  qdrantAdapters: Map<string, QdrantAdapter>,
  coordinator: IndexingCoordinator
): void {
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
    (args: { repoId: string }) =>
      handleTriggerReindex(config, qdrantAdapters, coordinator, args.repoId)
  );
}

async function handleGetRepoStatus(
  dependencies: McpServerDependencies,
  repoId: string
): Promise<TextToolResponse> {
  try {
    const adapter = dependencies.qdrantAdapters.get(repoId);
    if (!adapter) return buildTextResponse(`Unknown repo: ${repoId}`, true);
    return buildTextResponse(
      formatRepoStatus(dependencies, repoId, await adapter.getIndexingStatus())
    );
  } catch (error) {
    return buildTextResponse(
      `Failed: ${error instanceof Error ? error.message : String(error)}`,
      true
    );
  }
}

export function handleTriggerReindex(
  config: AppConfig,
  qdrantAdapters: Map<string, QdrantAdapter>,
  coordinator: IndexingCoordinator,
  repoId: string
): TextToolResponse {
  if (config.serverMode === 'search-only') {
    return buildTextResponse('Re-index is unsupported when serverMode is search-only.', true);
  }

  if (!qdrantAdapters.has(repoId)) {
    return buildTextResponse(`Unknown repo: ${repoId}`, true);
  }

  if (coordinator.isIndexing(repoId)) {
    return buildTextResponse('Indexing already in progress.');
  }

  setImmediate(() => {
    coordinator.fullIndex(repoId).catch(() => {});
  });

  return buildTextResponse(`Re-index started for repo "${repoId}"`);
}

function formatRepos(config: AppConfig): string {
  const text = config.repos
    .map(
      (repo) =>
        `- **${repo.repoId}** — collection: \`${repo.collectionName}\`, mode: \`${config.serverMode}\`${repo.rootPath ? `, path: \`${repo.rootPath}\`` : ''}`
    )
    .join('\n');

  return text || '(none)';
}

function formatRepoStatus(
  dependencies: McpServerDependencies,
  repoId: string,
  status: Awaited<ReturnType<QdrantAdapter['getIndexingStatus']>>
): string {
  return [
    `**Repo:** ${repoId}`,
    `**Server mode:** ${dependencies.config.serverMode}`,
    `**Embedding provider:** ${dependencies.embedding.provider}`,
    `**Embedding model:** ${dependencies.embedding.modelName} (${dependencies.embedding.vectorSize}-dim)`,
    `**Indexing complete:** ${status?.indexing_complete ?? 'unknown'}`,
    `**Currently indexing:** ${dependencies.coordinator.isIndexing(repoId)}`,
    status?.started_at ? `**Last started:** ${new Date(status.started_at).toISOString()}` : null,
    status?.completed_at
      ? `**Last completed:** ${new Date(status.completed_at).toISOString()}`
      : null,
    status?.last_error ? `**Last error:** ${status.last_error}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}
