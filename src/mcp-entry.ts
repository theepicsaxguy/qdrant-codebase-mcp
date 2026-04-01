#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config/loader';
import { bootstrap, startIndexing } from './bootstrap';
import { createMcpServer } from './mcp/server';
import { applyMcpRuntimeDefaults } from './mcp/runtime-defaults';

async function main(): Promise<void> {
  applyMcpRuntimeDefaults();

  // Load config — env vars, then config.yml if present, then pure env-var defaults
  const config = loadConfig();

  // Bootstrap all services — Qdrant, FastEmbed, indexer, search
  const bundle = await bootstrap(config);
  startIndexing(bundle);

  // Build MCP server that talks to services directly (no HTTP round-trip)
  const server = createMcpServer({
    searchService: bundle.searchService,
    qdrantAdapters: bundle.qdrantAdapters,
    config,
    embedding: bundle.embedding,
    coordinator: bundle.coordinator,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async (): Promise<void> => {
    await bundle.watcherManager.stopAll();
    process.exitCode = 0;
  };
  process.on('SIGTERM', () => {
    void shutdown();
  });
  process.on('SIGINT', () => {
    void shutdown();
  });
}

main().catch((err) => {
  process.stderr.write(
    `[qdrant-codebase-query] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exitCode = 1;
});
