import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppConfig } from '../config/schema';
import type { EmbeddingAdapter } from '../embedding/types';
import type { IndexingCoordinator } from '../indexing/coordinator';
import {
  registerGetRepoStatusTool,
  registerListReposTool,
  registerSearchCodeTool,
  registerTriggerReindexTool,
} from './tool-registration';
import type { QdrantAdapter } from '../qdrant/adapter';
import type { SearchService } from '../search/service';

export interface McpServerDependencies {
  searchService: SearchService;
  qdrantAdapters: Map<string, QdrantAdapter>;
  config: AppConfig;
  embedding: EmbeddingAdapter;
  coordinator: IndexingCoordinator;
}

export function createMcpServer(dependencies: McpServerDependencies): McpServer {
  const server = new McpServer(
    { name: 'qdrant-codebase-query', version: '0.1.0' },
    { capabilities: {} }
  );

  registerSearchCodeTool(server, dependencies.searchService);
  registerListReposTool(server, dependencies.config);
  registerGetRepoStatusTool(server, dependencies);
  registerTriggerReindexTool(
    server,
    dependencies.config,
    dependencies.qdrantAdapters,
    dependencies.coordinator
  );

  return server;
}
