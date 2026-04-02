# CLAUDE.md — qdrant-codebase-mcp

This file gives Claude Code the context it needs to work effectively in this repository.

## What this project is

An MCP (Model Context Protocol) server that indexes a codebase into Qdrant (a vector database) using FastEmbed embeddings, then exposes semantic search tools to AI assistants. Users run it via `npx qdrant-codebase-mcp` and their AI assistant can call `search_code("JWT validation logic")` to find relevant code by meaning.

## Commands

```bash
npm run dev          # run with tsx watch (rebuilds on save)
npm run typecheck    # tsc --noEmit — must pass before committing
npm run lint         # ESLint strict — zero warnings tolerated
npm test             # vitest unit tests (tests/unit/)
npm run build        # compile src/ → dist/
npm run knip         # find dead exports / unused deps
npm run audit        # npm audit --audit-level=moderate
npm run changeset    # describe a change before opening a PR
DRY_RUN=1 ./scripts/publish.sh         # validate publish without publishing
./scripts/publish.sh --dry-run          # same
./scripts/publish.sh --ci               # non-interactive CI mode
```

## Architecture

```
src/
  mcp-entry.ts          entry point for MCP stdio transport
  index.ts              entry point for HTTP service
  bootstrap.ts          wires all services together; call startIndexing() to activate
  config/
    schema.ts           Zod schema — all config with defaults lives here
    loader.ts           loads from env vars or config.yml; env takes precedence
  mcp/
    server.ts           registers MCP tools: search_code, list_repos, get_repo_status, trigger_reindex
  indexing/
    coordinator.ts      fullIndex() and indexFile() — the core indexing loop
  watcher/
    watcher.ts          chokidar file watcher with per-file debounce timers
  embedding/
    adapter.ts          FastEmbed wrapper; lazy-loads model; batch + single embed
  qdrant/
    adapter.ts          Qdrant REST client wrapper; collection lifecycle + upsert/search/delete
  search/
    service.ts          embeds query → searches one or all repos → merges results
  scanner/
    scanner.ts          walks the repo and returns indexable file paths
  chunker/
    chunker.ts          splits files into overlapping line windows
  types/
    index.ts            shared interfaces (IndexedChunk, MetadataPoint, etc.)
  logger.ts             pino logger factory
  metrics.ts            prom-client counters and histograms
tests/
  unit/                 vitest unit tests — no Qdrant/network required
```

## Key behaviours to understand

**Indexing flow on file save:**

1. chokidar fires `change` event
2. `awaitWriteFinish` waits for the OS file handle to close
3. Per-file debounce timer (default 2000ms) resets on each event — prevents embedding storms during rapid saves or formatter runs
4. `coordinator.indexFile()` deletes old vectors for the file, re-chunks, re-embeds in batch, upserts new vectors

**Incremental vs full index:**

- `coordinator.fullIndex()` — called once on startup, scans all files
- `coordinator.indexFile()` — called by the watcher on change/add, called by `trigger_reindex` MCP tool

**Config precedence:** env vars → config.yml → Zod defaults

**Embedding is local:** FastEmbed downloads the model once to `./models/` (or `FASTEMBED_CACHE_PATH`). No external embedding API calls in the default setup.

## Linting — what is enforced

The ESLint config (`eslint.config.mjs`) is strict. Key constraints that frequently come up:

- **`max-lines: 200`** — if a file approaches this, split it into smaller modules
- **`max-lines-per-function: 40`** — long functions must be decomposed
- **`@typescript-eslint/no-explicit-any`** — never use `any`; use `unknown` + type guards
- **`@typescript-eslint/no-non-null-assertion`** — no `!` assertions; use nullish coalescing or guards
- **`@typescript-eslint/return-await: always`** — always `return await promise` inside async functions (required for correct stack traces in try/catch)
- **`@typescript-eslint/promise-function-async`** — functions that return promises must be `async`
- **`unused-imports/no-unused-imports`** — remove unused imports; knip finds dead exports
- **`security/detect-non-literal-fs-filename`** — fs calls with dynamic paths need path validation
- **`unicorn/no-array-for-each`** — use `for...of` loops, not `.forEach()`
- **`unicorn/no-process-exit`** — use `process.exitCode = 1; process.exit()` pattern or throw

## Adding a new MCP tool

1. Add the handler function in `src/mcp/server.ts` — keep it under 40 lines
2. If it needs a new service method, add to the appropriate adapter/service in `src/`
3. Update `mcp-registry.json` tools array
4. Run `npm run lint` and `npm run typecheck`
5. Add a changeset: `npx changeset`

## Release process

Releases are fully automated. As a contributor:

1. Make changes in a branch
2. Run `npm run typecheck && npm run lint && npm test` before pushing
3. A changeset is required if `src/` files change — the pre-commit hook will prompt you if one is missing
4. Open a PR — CI must pass (type check, lint, format, knip, security audit, tests)
5. After merge, Changesets bot opens a "Version Packages" PR automatically
6. Maintainer merges the version PR → CI publishes to npm + MCP Registry + VS Code Marketplace (once extension is built)

Manual publish: `NPM_TOKEN=... MCP_REGISTRY_TOKEN=... ./scripts/publish.sh`
Dry run: `DRY_RUN=1 ./scripts/publish.sh` or `./scripts/publish.sh --dry-run`

## Required secrets (GitHub)

| Secret               | Used for                                              |
| -------------------- | ----------------------------------------------------- |
| `NPM_TOKEN`          | `npm publish` in release workflow                     |
| `MCP_REGISTRY_TOKEN` | `mcp-publisher publish`                               |
| `VSCE_TOKEN`         | VS Code Marketplace (once `vsce-extension/` is built) |

## Things to watch out for

- `config.yml` and `models/` are gitignored and never published — do not add them to `files` in package.json
- The `prepare` script runs `husky` — it is guarded with `[ -d .git ]` so it does not break consumers who `npm install` this package
- `pino-pretty` is a runtime dep (not dev) because the HTTP service uses it — it is listed in `ignoreDependencies` in knip.json to suppress the false-positive unused warning
- The watcher uses `awaitWriteFinish` AND a debounce — both use `watcherDebounceMs`. Total minimum latency before indexing starts after a save is ~2× the configured value

Commit using conventional commits. Without attribution to a specific author. Always commit after each successful step.

ALWAYS COMMIT YOUR CHANGES
