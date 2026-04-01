# Implementation Progress

## Step status

- [completed] Inspect repo state and establish progress tracking
- [completed] Implement config/schema/runtime changes for embedding providers and server modes
- [completed] Refactor embedding/bootstrap/search/status paths for FastEmbed and OpenAI-compatible adapters
- [completed] Add Python uvx launcher packaging and tests
- [completed] Update docs/templates/examples for uvx and multi-entry MCP configs
- [completed] Run tests, lint, typecheck, and reconcile failures

## Evidence and citations

- Initial repo inspection completed locally on 2026-04-01.
- Source-install launcher implemented via `pyproject.toml` and `qdrant_codebase_mcp_launcher/launcher.py`.
- Dedicated search-only mode implemented across config, bootstrap, Qdrant validation, MCP, and HTTP status/reporting paths.
- Verification completed with:
  - `npm run typecheck`
  - `npm run lint`
  - `npm test`
  - `npm run test:python`
  - `uvx --from . qdrant-codebase-mcp` with `QDRANT_CODEBASE_MCP_LAUNCHER_DRY_RUN=1`

## Derived equations and verification notes

- No critical formulas were required for this implementation.
- OpenAI-compatible vector size is verified either from explicit `EMBEDDING_DIMENSIONS` / `embeddingDimensions` or from the first successful embeddings response during adapter initialization.

## Decisions and rationale

- Progress is tracked in this file to satisfy autonomous execution requirements.
- Existing `npx qdrant-codebase-mcp` behavior was preserved as the default published-install path.
- The `uvx` path is implemented as a thin Python launcher that clones/builds the Node source once per commit and then execs `node dist/mcp-entry.js`.
- Mixed embedding spaces remain isolated by separate MCP server entries rather than merged in one server process.
- `search-only` mode validates existing Qdrant collections instead of creating or recreating them.

## Failures, retries, and fallback paths

- Initial Python launcher tests failed after the launcher implementation grew to support bundled-source fallbacks and cache-key derivation. Tests were updated to match the final launcher interface and build behavior.
- ESLint flagged the config loader for complexity and object-injection patterns. The loader was split into `src/config/loader.ts` and `src/config/loader.helpers.ts`, and override application was rewritten with constrained helper logic.

## Remaining work mapped to done criteria

- None. All planned work is complete.
