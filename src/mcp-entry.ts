import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp/server';

async function main(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[MCP] qdrant-codebase-query MCP server ready (service: ${process.env['SEARCH_SERVICE_URL'] ?? 'http://localhost:3000'})\n`
  );
}

main().catch((err) => {
  process.stderr.write(
    `[MCP] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
