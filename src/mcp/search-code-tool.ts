import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SearchService } from '../search/service';
import type { SearchResult } from '../types';
import { buildTextResponse, type TextToolResponse } from './tool-response';

const SEARCH_RESULT_SEPARATOR = '\n\n---\n\n';
const SEARCH_CODE_DESCRIPTION =
  'Semantically search across indexed code repositories using natural language. Returns relevant code chunks with file paths, line numbers, and similarity scores. Use this to find where specific behaviour is implemented, e.g. "where are SignalR messages sent to clients".';
const searchCodeInputSchema = {
  query: z
    .string()
    .min(1)
    .max(2000)
    .describe('Natural language description of the code you are looking for'),
  repoId: z
    .string()
    .optional()
    .describe('Repository ID to search within. Omit to search all repos.'),
  directoryPrefix: z
    .string()
    .optional()
    .describe('Restrict results to files under this directory prefix, e.g. "src/Application"'),
  language: z
    .string()
    .optional()
    .describe('Filter by language, e.g. "csharp", "typescript", "python"'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .optional()
    .describe('Maximum number of results'),
  minScore: z
    .number()
    .min(0)
    .max(1)
    .default(0.45)
    .optional()
    .describe('Minimum similarity score 0-1 (default 0.45)'),
};

interface SearchToolArgs {
  query: string;
  repoId?: string;
  directoryPrefix?: string;
  language?: string;
  limit?: number;
  minScore?: number;
}

export function registerSearchCodeTool(server: McpServer, searchService: SearchService): void {
  server.registerTool(
    'search_code',
    {
      title: 'Search Code',
      description: SEARCH_CODE_DESCRIPTION,
      inputSchema: searchCodeInputSchema,
    },
    async (args: SearchToolArgs) => await handleSearchCode(searchService, args)
  );
}

async function handleSearchCode(
  searchService: SearchService,
  args: SearchToolArgs
): Promise<TextToolResponse> {
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
      return buildTextResponse('No results found for this query.');
    }

    return buildTextResponse(formatSearchResults(result.results));
  } catch (error) {
    return buildTextResponse(
      `Search failed: ${error instanceof Error ? error.message : String(error)}`,
      true
    );
  }
}

function formatSearchResults(results: SearchResult[]): string {
  return results
    .map(
      (result, index) =>
        `### ${index + 1}. \`${result.filePath}\` lines ${result.startLine}-${result.endLine}${result.repoId ? ` · repo: ${result.repoId}` : ''} · score: ${result.score.toFixed(3)}\n\`\`\`\n${result.codeChunk}\n\`\`\``
    )
    .join(SEARCH_RESULT_SEPARATOR);
}
