# qdrant-codebase-query

A standalone production service that continuously indexes source code repositories into [Qdrant](https://qdrant.tech) using [FastEmbed](https://github.com/qdrant/fastembed) and exposes semantic vector search over that code — for use by AI assistants, Copilot, Claude, and your own tooling.

## What it does

- **Continuously indexes** one or more repos — detects file adds, changes, deletes on the fly
- **Semantic code search** — find code by meaning, not just text grep
- **MCP server** — plug directly into VS Code Copilot, Claude Desktop, or any MCP client
- **Production ready** — deterministic chunk IDs, stale vector cleanup, health/metrics endpoints, graceful shutdown

### Example queries it answers

- *"where are SignalR messages sent to clients"*
- *"where is foreign key constraint handling done"*
- *"where is auth configured"*
- *"where is this behavior implemented even if the name differs"*

---

## Quick start

### 1. Prerequisites

- Node.js ≥ 20
- A running [Qdrant](https://qdrant.tech/documentation/quick-start/) instance (local or cloud)

### 2. Clone & install

```bash
git clone https://github.com/theepicsaxguy/qdrant-codebase-query.git
cd qdrant-codebase-query
npm install
```

### 3. Configure

```bash
cp config.example.yml config.yml
```

Edit `config.yml`:

```yaml
qdrantUrl: http://localhost:6333   # or your Qdrant Cloud URL
# qdrantApiKey: ""                 # set here, or use QDRANT_API_KEY env var

repos:
  - repoId: my-project
    collectionName: my-project-code
    rootPath: /path/to/your/repo   # absolute, relative, or ~ paths all work
```

> **Security:** `config.yml` is in `.gitignore`. Never commit API keys. Use the `QDRANT_API_KEY` environment variable when running in CI or shared environments.

### 4. Build & start

```bash
npm run build
npm run start
```

The service will:
1. Load the FastEmbed model on first run (downloaded to `./models/`, ~25 MB)
2. Connect to Qdrant and create/verify collections
3. Run an initial full scan and index all matching files
4. Start file watchers for continuous incremental sync
5. Serve the HTTP API on port 3000

---

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `QDRANT_URL` | Qdrant server URL | from `config.yml` |
| `QDRANT_API_KEY` | Qdrant API key | from `config.yml` |
| `PORT` | HTTP API port | `3000` |
| `CONFIG_PATH` | Path to config file | `config.yml` |
| `MODEL_CACHE_DIR` | Directory to cache embedding models | `./models` |
| `LOG_LEVEL` | Pino log level | `info` |

---

## HTTP API

### Health & ops

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `GET` | `/ready` | Readiness check (verifies Qdrant connectivity) |
| `GET` | `/metrics` | Prometheus metrics |

### Repos

| Method | Path | Description |
|---|---|---|
| `GET` | `/repos` | List configured repos |
| `GET` | `/repos/:repoId/status` | Indexing status for a repo |
| `POST` | `/repos/:repoId/reindex` | Trigger full re-index (async) |
| `POST` | `/repos/:repoId/rescan` | Alias for reindex |
| `DELETE` | `/repos/:repoId/index` | Delete the entire Qdrant collection for a repo |

### Search

```http
POST /search
Content-Type: application/json

{
  "query": "where do we send SignalR messages to clients",
  "repoId": "my-project",
  "directoryPrefix": "src",
  "language": "csharp",
  "limit": 10,
  "minScore": 0.45
}
```

```json
{
  "results": [
    {
      "score": 0.82,
      "filePath": "src/Application/Chat/SendMessageHandler.cs",
      "startLine": 22,
      "endLine": 68,
      "codeChunk": "...",
      "repoId": "my-project"
    }
  ]
}
```

---

## MCP integration (VS Code Copilot / Claude)

The MCP server lets AI assistants call `search_code` directly without manually constructing HTTP requests.

### Run the MCP server

```bash
npm run mcp
```

### Connect VS Code Copilot

Copy `mcp.template.json` to your project's `.vscode/mcp.json`, then update the path:

```json
{
  "servers": {
    "qdrant-codebase-query": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/qdrant-codebase-query/dist/mcp-entry.js"],
      "env": {
        "SEARCH_SERVICE_URL": "http://localhost:3000"
      }
    }
  }
}
```

> The HTTP service (`npm run start`) must be running. The MCP process is a thin client that calls it.

### Available MCP tools

| Tool | Description |
|---|---|
| `search_code` | Semantic search across indexed repos |
| `list_repos` | List available repos |
| `get_repo_status` | Check indexing status |
| `trigger_reindex` | Kick off a full re-index |

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "qdrant-codebase-query": {
      "command": "node",
      "args": ["/path/to/qdrant-codebase-query/dist/mcp-entry.js"],
      "env": {
        "SEARCH_SERVICE_URL": "http://localhost:3000"
      }
    }
  }
}
```

---

## Docker

```bash
# Start Qdrant + the service together
docker compose up

# Or start just Qdrant locally
docker run -p 6333:6333 qdrant/qdrant
```

Mount your repo and config:

```yaml
# docker-compose.yml
services:
  qdrant-codebase-query:
    volumes:
      - ./config.yml:/app/config.yml:ro
      - /path/to/your/repo:/repos/my-project:ro
```

---

## Configuration reference

```yaml
# Qdrant connection
qdrantUrl: http://localhost:6333
qdrantApiKey: ""             # optional; prefer QDRANT_API_KEY env var

# Embedding
embeddingModel: fast-bge-small-en-v1.5   # 384-dim; see supported models below

# Chunking
chunkMaxLines: 150           # max lines per chunk
chunkOverlapLines: 20        # overlap between adjacent chunks

# Indexing
embeddingBatchSize: 64       # chunks embedded per batch
maxFileSizeBytes: 1000000    # files larger than this are skipped
watcherDebounceMs: 300       # ms to wait before re-indexing a changed file

# HTTP server
port: 3000
host: 0.0.0.0

# Repos (one or more)
repos:
  - repoId: my-project                   # unique identifier
    collectionName: my-project-code      # Qdrant collection name
    rootPath: /path/to/repo              # absolute, ~/relative, or . for current dir
    include:                             # optional glob overrides
      - "**/*.ts"
      - "**/*.cs"
    ignore:                              # optional extra ignore patterns
      - "**/migrations/**"
```

### Supported embedding models

| Model key | Dimensions | Notes |
|---|---|---|
| `fast-bge-small-en-v1.5` | 384 | Default — fast, good quality |
| `fast-bge-base-en-v1.5` | 768 | Better quality, slower |
| `fast-all-MiniLM-L6-v2` | 384 | Alternative small model |
| `fast-multilingual-e5-large` | 1024 | Multilingual, largest |

> Changing the model after indexing requires a full re-index (`POST /repos/:id/reindex`).

---

## Multiple repos

Index multiple codebases from one service instance:

```yaml
repos:
  - repoId: backend
    collectionName: backend-code
    rootPath: /path/to/backend

  - repoId: frontend
    collectionName: frontend-code
    rootPath: /path/to/frontend

  - repoId: infra
    collectionName: infra-code
    rootPath: /path/to/infra
    include:
      - "**/*.tf"
      - "**/*.yml"
```

Search one repo or all at once:

```http
POST /repos/backend/search   → repo-scoped
POST /search                 → all repos, merged and re-ranked
```

---

## Development

```bash
npm run dev          # start with tsx watch (auto-recompile)
npm test             # unit tests
npm run test:all     # unit + integration tests
npm run lint         # eslint
npm run format       # prettier
```

### Project structure

```
src/
  config/       schema + loader (zod validation, env var overrides)
  qdrant/       Qdrant adapter (collection lifecycle, upsert, delete, search)
  embedding/    FastEmbed adapter (model init, batch embed, query embed)
  scanner/      File scanner (glob matching, binary detection, path safety)
  chunker/      Line-based chunker (deterministic IDs, overlap, content hash)
  indexing/     Full-scan and incremental-sync coordinator
  watcher/      Chokidar-based file watcher with debouncing
  search/       Search service (query embed → Qdrant search → ranked results)
  api/          Fastify HTTP API (all endpoints)
  mcp/          MCP stdio server (search_code, list_repos, status, reindex tools)
  metrics.ts    Prometheus counters and histograms
  logger.ts     Pino structured logger
  index.ts      Main entry point
  mcp-entry.ts  MCP stdio entry point
```

---

## How it works

1. **Chunking** — files are split into overlapping line-range chunks with a deterministic ID: `sha256(repoId:filePath:startLine:endLine)`
2. **Embedding** — each chunk is embedded using FastEmbed (`passageEmbed` for indexing, `queryEmbed` for search)
3. **Storage** — chunks are upserted into Qdrant with path segments as payload indexes for efficient directory-scoped filtering
4. **Incremental sync** — file watcher detects changes; on any change, existing chunks for that file are deleted and the file is re-indexed from scratch
5. **Search** — query is embedded, Qdrant performs cosine similarity search, metadata points are excluded, results are ranked by score

---

## License

MIT
