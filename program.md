# Semantic Code Index Service

## Purpose

Build a new standalone production service that continuously indexes source code repositories into Qdrant using FastEmbed and exposes semantic vector search over that indexed code.

This is not an MVP, not a toy watcher, and not a wrapper around the Qdrant memory MCP.

It must solve the full problem properly:

- continuously index one or more repos
- detect file adds, changes, deletes, and renames
- chunk code deterministically
- embed chunks using FastEmbed
- store vectors and metadata directly in Qdrant
- delete stale chunks when files change or disappear
- expose semantic code search over the indexed content
- provide operational endpoints for health, readiness, metrics, and repo status
- be reusable across multiple repos in VS Code
- be production ready

## Why this project exists

The current Qdrant MCP server is an official semantic memory layer on top of Qdrant [2]. It provides `qdrant-store` and `qdrant-find` tools for storing and retrieving information semantically [2]. It can be configured for semantic code search by storing natural language descriptions plus code snippets [2].

That is useful, but it does not solve the hard parts of production code indexing:

- full repo scanning
- continuous syncing while files change
- file level deletion cleanup
- stale vector replacement
- indexing state tracking
- collection lifecycle management
- payload indexes for efficient path scoped operations
- deterministic IDs
- operational visibility

Roo Code’s Qdrant implementation is the better reference for these problems. It directly manages collections, payload indexes, path based deletion, metadata markers for indexing state, vector dimension mismatch handling, and query filtering to exclude metadata [3].

So this new project exists to solve the missing half properly.

## What problem it solves

This service solves five concrete problems:

### 1. Continuous code indexing

Source code changes all the time. The search index must stay updated automatically.

### 2. Semantic code search

Developers and agents need to search by meaning, not just grep.
Examples:

- where are SignalR messages sent to clients
- where is foreign key constraint handling done
- where are controllers calling application services
- where is auth configured
- where is this behavior implemented even if names differ

### 3. Clean operational ownership

Code indexing should be owned by a dedicated service, not bolted onto an MCP memory tool.

### 4. Reusable multi repo support

One shared service should work for many repositories, with isolated collections.

### 5. Production correctness

No duplicated stale chunks, no manual cleanup, no hand run rebuild scripts as the normal flow.

## Scope

This project must do both:

- indexing and embeddings with FastEmbed
- vector search over indexed code

Do not build only an ingester.
Do not build only a search wrapper.
Do both.

## Non scope

This project should not:

- replace normal text search
- replace static analysis
- replace build correctness
- try to understand architecture perfectly from vectors alone
- use MCP as the write path for ingestion
- depend on manual storage of snippets through prompts

## References

Use these as implementation references:

- Roo Code Qdrant client  
  https://raw.githubusercontent.com/RooCodeInc/Roo-Code/refs/heads/main/src/services/code-index/vector-store/qdrant-client.ts

- Official Qdrant MCP server  
  https://github.com/qdrant/mcp-server-qdrant/tree/master

How to interpret them:

- Roo Code is the main reference for ingestion, collection lifecycle, payload indexes, delete by path, metadata markers, and search filtering [3]
- `mcp-server-qdrant` is the reference for how Qdrant is used as a semantic memory and code retrieval tool, but it is not enough for continuous repo indexing [2]

## Why not just use mcp-server-qdrant directly

Because it is the wrong layer for this job.

The Qdrant MCP server is designed as a semantic memory layer [2]. Its tools are `qdrant-store` and `qdrant-find` [2]. It can be used for semantic code search if you manually feed it snippets and descriptions [2]. It also supports FastEmbed based models for encoding memories [2].

But it does not provide a production repo indexing system with:

- watchers
- incremental sync
- delete by file path before reindex
- collection dimension handling
- metadata indexing state
- payload index management
- repo scoped lifecycle

That is exactly why Roo Code has its own direct Qdrant implementation [3].

## Recommended architecture

Build a standalone service called something like:

- `qdrant-codebase-query`
- `code-indexer`
- `repo-search-service`

My recommendation is `qdrant-codebase-query`.

### Main components

- config loader and validator
- repo registry
- file scanner
- file watcher
- chunker
- FastEmbed embedding adapter
- Qdrant storage adapter
- indexing coordinator
- search service
- HTTP API
- health and metrics endpoints
- structured logging

### Runtime flow

1. service starts
2. config is loaded and validated
3. Qdrant connection is verified
4. FastEmbed model is loaded and vector dimension is determined
5. configured repos are registered
6. per repo collection is checked or created
7. initial full scan runs
8. files are chunked and embedded
9. chunks are upserted into Qdrant
10. indexing metadata is marked complete
11. file watchers stay active
12. changed files are deleted and reindexed
13. deleted files are removed from Qdrant
14. search API queries Qdrant directly

## Core design decisions

### One collection per repo

Use one Qdrant collection per repository.

Why:

- easier cleanup
- easier rebuild
- simpler operational boundaries
- less cross repo noise
- safer for production

Roo Code derives collection names from the workspace path hash [3]. That is fine, but for this service explicit collection names in config are better for humans.

### Direct Qdrant writes

Use direct Qdrant client writes for ingestion, deletes, metadata, and search.

Do not use MCP tool calls as the indexing path.

### Deterministic IDs

Each chunk must get a deterministic point ID based on repo, relative file path, and line range.
Example:
`sha256(repoId:filePath:startLine:endLine)`

That makes upsert and replacement sane.

### Delete old chunks before reindex

Mandatory.

On file change:

- delete all chunks for file
- reinsert current chunks

If this is skipped, the index turns to shit fast.

Roo Code already handles delete by file path via `pathSegments` payload indexing [3].

### Metadata points for indexing state

Store metadata inside the collection to mark indexing status.

Roo Code uses a deterministic metadata point and stores `indexing_complete` there [3].

### Exclude metadata from search

Mandatory.

Roo Code explicitly excludes metadata points from query results [3].

## Functional requirements

The service must support:

### Repository management

- multiple configured repos
- one collection per repo
- explicit `repoId`
- explicit `collectionName`
- full reindex per repo
- delete index per repo
- status per repo

### File indexing

- initial full scan
- incremental sync on add, change, delete, rename
- debounced updates
- stale chunk cleanup
- max file size limit
- binary file exclusion
- include and ignore rules

### Chunking

- line based chunking
- overlap support
- deterministic chunk IDs
- line number metadata
- future extension for smarter language aware chunking

### Embeddings

- FastEmbed based embedding generation
- configurable embedding model
- batch embedding
- startup validation of vector dimension
- retry on temporary failures

### Qdrant storage

- create collection if missing
- detect vector dimension mismatch
- recreate collection or fail cleanly on mismatch
- create payload indexes
- upsert chunks
- delete chunks by exact file path
- store metadata point
- query vectors

### Search

- semantic code search endpoint
- repo scoped search
- optional directory prefix filtering
- optional language filtering
- score threshold support
- top K support

### Observability

- structured logs
- health endpoint
- readiness endpoint
- metrics endpoint
- indexing status endpoint

### Reliability

- graceful shutdown
- watcher cleanup on shutdown
- idempotent indexing
- bounded memory use
- recovery from transient failures

## Proposed API

### Health and ops

- `GET /health`
- `GET /ready`
- `GET /metrics`

### Repo management

- `GET /repos`
- `GET /repos/:repoId/status`
- `POST /repos/:repoId/reindex`
- `POST /repos/:repoId/rescan`
- `DELETE /repos/:repoId/index`

### Search

- `POST /search`
- `POST /repos/:repoId/search`

## Example search request

```json
{
  "query": "where do we send SignalR messages to clients",
  "repoId": "aiportal",
  "directoryPrefix": "src",
  "language": "cs",
  "limit": 10,
  "minScore": 0.45
}
```

## Example search response

```json
{
  "results": [
    {
      "score": 0.82,
      "filePath": "src/Application/Chat/SendMessageHandler.cs",
      "startLine": 22,
      "endLine": 68,
      "codeChunk": "..."
    }
  ]
}
```

## Data model

Each code chunk stored in Qdrant should look roughly like this:

```json
{
  "id": "sha256(repoId:filePath:startLine:endLine)",
  "vector": [],
  "payload": {
    "type": "code",
    "repoId": "aiportal",
    "filePath": "src/Application/Chat/SendMessageHandler.cs",
    "language": "cs",
    "codeChunk": "...",
    "startLine": 22,
    "endLine": 68,
    "contentHash": "sha256-of-chunk",
    "pathSegments": {
      "0": "src",
      "1": "Application",
      "2": "Chat"
    },
    "updatedAt": 1711960000
  }
}
```

Metadata point:

```json
{
  "type": "metadata",
  "indexing_complete": true,
  "started_at": 1711960000,
  "completed_at": 1711960100,
  "last_error": null
}
```

This metadata marker pattern is aligned with Roo Code’s implementation [3].

## Qdrant collection behavior

The service must:

- create collection if missing
- use cosine distance
- validate vector size against embedding model dimension
- recreate or clearly fail on vector dimension mismatch
- create payload indexes for `type` and `pathSegments.N`
- optionally create payload index for `language`

Roo Code already does:

- collection creation
- vector dimension mismatch handling
- payload index creation for `type` and `pathSegments.0..4`
- path based deletion
- metadata marker management [3]

## File scanning rules

### Include by default

- `.cs`
- `.ts`
- `.tsx`
- `.js`
- `.jsx`
- `.json`
- `.sql`
- `.md`
- `.yml`
- `.yaml`
- `.csproj`
- `.sln`

### Ignore by default

- `.git`
- `node_modules`
- `bin`
- `obj`
- `dist`
- `build`
- `coverage`
- `.next`
- `.turbo`
- `.cache`

Also ignore:

- binary files
- huge generated files
- minified files
- files above configured size limit

### Path safety

Only index files under configured repo roots.
Never allow traversal outside configured roots.

## Chunking strategy

Start with deterministic line based chunking.

Recommended initial defaults:

- max lines per chunk: 120 to 180
- overlap: 20 lines

Requirements:

- preserve line numbers
- deterministic chunk boundaries
- stable point IDs
- content hash per chunk

Do not start with AST chunking unless there is an actual reason.
That is a distraction for first production delivery.

## FastEmbed requirements

The service must use FastEmbed for embeddings.

Relevant detail from Qdrant MCP docs:

- only FastEmbed models are supported in that server at the moment [2]

For this project:

- use FastEmbed directly in the new service
- make model configurable
- detect embedding dimension at startup
- surface model info in status endpoints
- retry temporary failures
- fail loudly if model cannot load

## Search behavior

The new service must expose vector search itself.

This is important.
Do not make search somebody else’s problem.

Search requirements:

- embed query using same FastEmbed model
- query Qdrant directly
- support repo filtering
- support directory prefix filtering
- support language filtering
- support configurable result limit
- support minimum score threshold
- exclude metadata points from results

Roo Code already excludes metadata during search using `must_not` filtering on `type = metadata` [3].

## Production expectations

This should be ready for production use when done.

That means:

- deterministic behavior
- clean failure modes
- operational visibility
- tested full scan and incremental sync
- no manual stale cleanup
- easy local use in VS Code
- reusable across repos
- documented enough that another developer can run and maintain it

## Detailed TODO

### 1. Repository and project setup

- [] Create a new standalone repository for the service
- [] Name the project something clear like `qdrant-codebase-query`
- [] Set up TypeScript project structure
- [] Enable strict TypeScript settings
- [] Add ESLint
- [] Add Prettier or chosen formatter
- [] Add unit test setup
- [] Add integration test setup
- [] Add `.editorconfig`
- [] Add `.gitignore`
- [] Add README with project purpose and setup instructions
- [] Add CI for build, lint, test

### 2. Dependency setup

- [] Add Qdrant client package
- [] Add FastEmbed package or chosen runtime wrapper
- [] Add file watcher package
- [] Add HTTP server package
- [] Add config validation package
- [] Add logger package
- [] Add Prometheus metrics package
- [] Add hashing utilities
- [] Add glob and path utilities

### 3. Configuration system

- [] Define validated config schema
- [] Support Qdrant URL
- [] Support optional Qdrant API key
- [] Support embedding model selection
- [] Support chunk size
- [] Support chunk overlap
- [] Support embedding batch size
- [] Support watcher debounce settings
- [] Support max file size setting
- [] Support multiple repo definitions
- [] Support explicit `repoId` per repo
- [] Support explicit `collectionName` per repo
- [] Support include globs per repo
- [] Support ignore globs per repo
- [] Fail fast on invalid config
- [] Document full config format

### 4. Domain types

- [] Define `RepoConfig`
- [] Define `IndexedChunk`
- [] Define `MetadataPoint`
- [] Define `SearchRequest`
- [] Define `SearchResult`
- [] Define `IndexingStatus`
- [] Define `FileChangeEvent`
- [] Separate core types from transport models

### 5. Qdrant adapter

- [] Implement Qdrant service wrapper
- [] Implement collection existence check
- [] Implement collection creation
- [] Implement vector size verification
- [] Implement collection recreation on vector dimension mismatch
- [] Implement payload index creation for `type`
- [] Implement payload index creation for `pathSegments.0`
- [] Implement payload index creation for `pathSegments.1`
- [] Implement payload index creation for `pathSegments.2`
- [] Implement payload index creation for `pathSegments.3`
- [] Implement payload index creation for `pathSegments.4`
- [] Implement optional payload index for `language`
- [] Implement chunk upsert
- [] Implement delete by exact file path
- [] Implement delete by multiple file paths
- [] Implement full collection delete
- [] Implement metadata point upsert
- [] Implement metadata point retrieval
- [] Implement semantic vector query
- [] Ensure metadata points are excluded from search results
- [] Add robust logging around all Qdrant failures

### 6. FastEmbed integration

- [] Choose exact FastEmbed runtime and package
- [] Implement embedding adapter interface
- [] Implement batch embedding
- [] Detect vector dimension at startup
- [] Expose loaded model name in status output
- [] Handle model initialization failure clearly
- [] Add retry for temporary embedding failures
- [] Add unit tests for embedding adapter

### 7. File scanning

- [] Implement full repository scanner
- [] Support include globs
- [] Support ignore globs
- [] Ignore `.git`
- [] Ignore `node_modules`
- [] Ignore `bin`
- [] Ignore `obj`
- [] Ignore `dist`
- [] Ignore `build`
- [] Ignore `coverage`
- [] Ignore other configured junk paths
- [] Ignore binary files
- [] Ignore files above configured max size
- [] Normalize file paths consistently on Windows
- [] Guarantee only files under repo root are indexed

### 8. Chunking

- [] Implement deterministic line based chunking
- [] Support configurable max lines
- [] Support configurable overlap
- [] Preserve `startLine`
- [] Preserve `endLine`
- [] Generate deterministic point IDs from repo, file path, and line range
- [] Generate content hash per chunk
- [] Add tests for empty files
- [] Add tests for tiny files
- [] Add tests for huge files
- [] Add tests for mixed line endings
- [] Add tests for stable deterministic IDs

### 9. Initial indexing pipeline

- [] Build full indexing coordinator
- [] Mark indexing as incomplete at start
- [] Scan all indexable files in repo
- [] Read files safely
- [] Chunk files
- [] Batch embed chunks
- [] Upsert chunks to Qdrant
- [] Mark indexing complete on success
- [] Record failure metadata on indexing error
- [] Log indexing progress
- [] Make indexing idempotent

### 10. Incremental sync pipeline

- [] Add file watcher per configured repo
- [] Debounce repeated change events
- [] On file add, index file
- [] On file change, delete previous chunks then reindex file
- [] On file delete, remove file chunks from Qdrant
- [] On file rename, treat as delete old plus add new
- [] Handle temporary file lock errors gracefully
- [] Prevent duplicate rework during event bursts
- [] Add per repo work queue
- [] Recover from transient watcher errors

### 11. Metadata and indexing state

- [] Store deterministic metadata point per collection
- [] Mark indexing incomplete at start of full scan
- [] Mark indexing complete at end of successful scan
- [] Store timestamps for started and completed
- [] Store last error if indexing fails
- [] Expose indexing state through API
- [] Exclude metadata points from normal search

### 12. Search service

- [] Implement query embedding using same FastEmbed model
- [] Implement semantic vector search against Qdrant
- [] Support repo scoped search
- [] Support directory prefix filter
- [] Support language filter
- [] Support result limit
- [] Support minimum score threshold
- [] Return file path, line range, score, and code chunk
- [] Return stable predictable JSON
- [] Add unit tests for search logic
- [] Add integration tests for semantic search

### 13. HTTP API

- [] Implement `GET /health`
- [] Implement `GET /ready`
- [] Implement `GET /metrics`
- [] Implement `GET /repos`
- [] Implement `GET /repos/:repoId/status`
- [] Implement `POST /repos/:repoId/reindex`
- [] Implement `POST /repos/:repoId/rescan`
- [] Implement `DELETE /repos/:repoId/index`
- [] Implement `POST /search`
- [] Implement `POST /repos/:repoId/search`
- [] Add request validation
- [] Add response typing
- [] Add API tests

### 14. Observability

- [] Add structured logging everywhere
- [] Add request logs for API
- [] Add indexing lifecycle logs
- [] Add Qdrant operation logs at appropriate level
- [] Add counters for indexed files
- [] Add counters for indexed chunks
- [] Add counters for indexing failures
- [] Add counters for search requests
- [] Add histograms for indexing duration
- [] Add histograms for search latency
- [] Expose metrics in Prometheus format

### 15. Reliability and hardening

- [] Add graceful shutdown
- [] Stop watchers cleanly on shutdown
- [] Drain in flight work on shutdown
- [] Validate Qdrant connectivity at startup
- [] Validate FastEmbed readiness at startup
- [] Fail clearly on vector dimension mismatch
- [] Prevent indexing outside configured roots
- [] Add request size limits
- [] Add optional API auth if exposed beyond localhost
- [] Ensure no insecure TLS bypass exists
- [] Test behavior on Qdrant unavailability
- [] Test behavior on embedding model failure
- [] Test restart behavior

### 16. Search quality improvements

- [] Add directory scoped ranking support
- [] Add filename weighting if helpful
- [] Add language aware ranking tweak if useful
- [] Evaluate storing a summary field per chunk
- [] Add relevance tests for known queries
- [] Tune default score thresholds
- [] Tune default chunk sizes and overlap
- [] Document tradeoffs

### 17. VS Code workflow support

- [] Document local run flow for VS Code
- [] Add example `.vscode/tasks.json` for running the service
- [] Add example config for one repo
- [] Add example config for multiple repos
- [] Document how app repos connect to the service
- [] Document how this differs from using `mcp-server-qdrant` directly
- [] Document collection naming expectations

### 18. Testing

- [] Add unit tests for chunking
- [] Add unit tests for path normalization
- [] Add unit tests for deterministic ID generation
- [] Add unit tests for ignore rules
- [] Add unit tests for config validation
- [] Add integration tests against a real Qdrant instance
- [] Add integration tests for initial full indexing
- [] Add integration tests for file updates
- [] Add integration tests for file deletes
- [] Add integration tests for rename handling
- [] Add integration tests for metadata marker behavior
- [] Add integration tests for semantic search
- [] Add API endpoint tests
- [] Add failure tests for Qdrant unavailable
- [] Add failure tests for FastEmbed unavailable

### 19. Deployment and operations

- [] Add Dockerfile
- [] Add docker compose example with Qdrant
- [] Add Windows run instructions
- [] Add Linux run instructions
- [] Add persistent storage guidance for Qdrant
- [] Add backup and restore guidance
- [] Add schema and versioning strategy
- [] Add upgrade guidance for model changes
- [] Add rebuild guidance for vector dimension changes

### 20. Definition of done

- [] Service can fully index a repo from scratch
- [] Service stays in sync while files are edited
- [] Service removes stale chunks correctly
- [] Service supports semantic code search in production
- [] Service exposes health, readiness, metrics, and repo status
- [] Service survives restart cleanly
- [] Service has docs another developer can actually follow
- [] Service has test coverage for critical flows
- [] Service is reusable across multiple repos
- [] Service is ready for daily use in VS Code

## Implementation notes

### Use Roo Code as the main behavioral reference

Roo Code already solves several non trivial Qdrant concerns correctly:

- deterministic collection naming from workspace path [3]
- collection creation and recreation on vector dimension mismatch [3]
- payload index creation for `type` and path segments [3]
- automatic `pathSegments` payload enrichment during upsert [3]
- delete by file path using path segment filters [3]
- metadata marker for indexing completion state [3]
- metadata exclusion during search [3]

That is the model to copy.

### Use Qdrant MCP as a secondary reference

The official Qdrant MCP server is useful to understand:

- semantic memory pattern [2]
- tool shapes for store and find [2]
- code search style descriptions [2]
- FastEmbed model expectation [2]

But it is not the ingestion architecture you want.

### Keep indexing and MCP concerns separate

If the team still wants to use `mcp-server-qdrant`, that is fine.

But the split should be:

- this new service owns code ingestion and vector search
- MCP remains a separate memory style interface if needed

Do not mix them into one muddy system.

## Acceptance criteria

This project is done when all of this is true:

- a repo can be indexed from scratch without manual cleanup
- changed files are reindexed automatically
- deleted files are removed from Qdrant automatically
- semantic search returns file path, line range, score, and chunk
- metadata points never leak into search results
- service state is visible through health, readiness, status, and metrics endpoints
- vector dimension mismatches are handled cleanly
- the service can be reused for multiple repos
- another developer can run it locally from the docs without guessing
- it is solid enough to use daily, not just demo once

## Short handoff summary

Build a standalone production service that continuously indexes one or more code repositories into Qdrant using FastEmbed and exposes semantic vector search over that indexed code. Do not use the Qdrant MCP server as the ingestion layer. Use direct Qdrant management, with per repo collections, deterministic IDs, delete before reindex, metadata based indexing state, health and metrics endpoints, and strong test coverage. Use Roo Code’s Qdrant client as the main implementation reference for vector store behavior and use the official Qdrant MCP repo only as a secondary reference for semantic retrieval patterns [2][3].
