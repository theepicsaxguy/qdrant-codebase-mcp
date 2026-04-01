# qdrant-codebase-query

> Semantic code search for AI assistants — indexes your codebase into [Qdrant](https://qdrant.tech) and exposes it as an [MCP](https://modelcontextprotocol.io) tool that works with VS Code Copilot, Claude Desktop, Claude Code, Cursor, and more.

[![npm](https://img.shields.io/npm/v/qdrant-codebase-query)](https://www.npmjs.com/package/qdrant-codebase-query)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node ≥ 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

---

## What it does

- **Semantic code search** — find code by meaning, not just text grep. Ask "where is email validation done?" and get the right file and line ranges.
- **Continuously indexes** — watches your repo for file changes and keeps the index fresh without a full re-scan.
- **Zero-config quickstart** — defaults to the current directory, auto-generates a Qdrant collection name, no config file required.
- **MCP server** — exposes 4 tools (`search_code`, `list_repos`, `get_repo_status`, `trigger_reindex`) usable from any MCP client.
- **Production ready** — deterministic chunk IDs, stale vector cleanup, health + Prometheus metrics endpoints, graceful shutdown.

---

## Quickstart (no install)

You need a running Qdrant instance. The fastest way is Docker:

```bash
docker run -p 6333:6333 qdrant/qdrant
```

Then, from your project directory:

```bash
QDRANT_URL=http://localhost:6333 npx qdrant-codebase-query
```

That's it. The server will:
1. Connect to Qdrant
2. Create a collection named `<your-folder>-<hash>` automatically
3. Index all code in the current directory
4. Start watching for changes
5. Serve MCP tools over stdio

---

## Installation

```bash
# Run directly (npx — no install needed)
npx qdrant-codebase-query

# Or install globally
npm install -g qdrant-codebase-query
qdrant-codebase-query
```

---

## Configuration

All configuration is via **environment variables**. No config file is required.

| Variable | Default | Description |
|---|---|---|
| `QDRANT_URL` | `http://localhost:6333` | Qdrant server URL |
| `QDRANT_API_KEY` | *(none)* | Qdrant API key (required for Qdrant Cloud) |
| `ROOT_PATH` | `process.cwd()` | Path to the repository to index |
| `COLLECTION_NAME` | `<folder>-<hash>` | Qdrant collection name (auto-generated if not set) |
| `REPO_ID` | `<folder name>` | Logical name for the repo (shown in MCP tools) |
| `EMBEDDING_MODEL` | `fast-bge-small-en-v1.5` | FastEmbed model name |
| `EMBEDDING_BATCH_SIZE` | `64` | Embedding batch size |
| `CHUNK_MAX_LINES` | `150` | Maximum lines per code chunk |
| `CHUNK_OVERLAP_LINES` | `20` | Overlap between adjacent chunks |
| `MAX_FILE_SIZE_BYTES` | `1000000` | Files larger than this are skipped |
| `WATCHER_DEBOUNCE_MS` | `300` | File watcher debounce delay |
| `PORT` | `3000` | HTTP API port (health, metrics) |
| `HOST` | `0.0.0.0` | HTTP API host |
| `CONFIG_PATH` | *(none)* | Optional path to a `config.yml` file |

> **Qdrant Cloud:** Set `QDRANT_URL` to your cluster URL and `QDRANT_API_KEY` to your API key.

### Optional: config.yml

If you prefer a file-based config (e.g. for multi-repo setups), create a `config.yml`. Environment variables always take precedence over the file.

```yaml
qdrantUrl: https://your-cluster.qdrant.tech
qdrantApiKey: your-api-key

repos:
  - repoId: my-backend
    rootPath: ./src/backend
    collectionName: my-backend-code
  - repoId: my-frontend
    rootPath: ./src/frontend
    collectionName: my-frontend-code

embeddingModel: fast-bge-small-en-v1.5
chunkMaxLines: 150
chunkOverlapLines: 20
```

---

## MCP Client Setup

### VS Code (GitHub Copilot)

Add to `.vscode/mcp.json` in your project:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "qdrantUrl",
      "description": "Qdrant server URL",
      "default": "http://localhost:6333"
    },
    {
      "type": "promptString",
      "id": "qdrantApiKey",
      "description": "Qdrant API key (leave empty for local Qdrant)",
      "password": true
    }
  ],
  "servers": {
    "qdrant-codebase-query": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "qdrant-codebase-query"],
      "env": {
        "QDRANT_URL": "${input:qdrantUrl}",
        "QDRANT_API_KEY": "${input:qdrantApiKey}",
        "ROOT_PATH": "${workspaceFolder}"
      }
    }
  }
}
```

VS Code will prompt you for the Qdrant URL and API key the first time.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "qdrant-codebase-query": {
      "command": "npx",
      "args": ["-y", "qdrant-codebase-query"],
      "env": {
        "QDRANT_URL": "http://localhost:6333",
        "QDRANT_API_KEY": "",
        "ROOT_PATH": "/path/to/your/project"
      }
    }
  }
}
```

### Claude Code (CLI)

```bash
claude mcp add qdrant-codebase-query \
  -e QDRANT_URL=http://localhost:6333 \
  -e ROOT_PATH=/path/to/your/project \
  -- npx -y qdrant-codebase-query
```

### Cursor

Open **Cursor → Settings → MCP → Add new MCP server** and enter:

```json
{
  "name": "qdrant-codebase-query",
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "qdrant-codebase-query"],
  "env": {
    "QDRANT_URL": "http://localhost:6333",
    "ROOT_PATH": "/path/to/your/project"
  }
}
```

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "qdrant-codebase-query": {
      "command": "npx",
      "args": ["-y", "qdrant-codebase-query"],
      "env": {
        "QDRANT_URL": "http://localhost:6333",
        "ROOT_PATH": "/path/to/your/project"
      }
    }
  }
}
```

---

## MCP Tools

| Tool | Description |
|---|---|
| `search_code` | Semantic search across indexed repos. Returns file paths, line ranges, code snippets, and similarity scores. |
| `list_repos` | List all indexed repositories. |
| `get_repo_status` | Show indexing status for a repo (complete, in-progress, last error). |
| `trigger_reindex` | Trigger a full re-index of a repository (runs in background). |

### Example: search_code

```
Query: "where are JWT tokens validated?"
```

Returns:

```
### 1. `src/auth/middleware.ts` lines 45–72 · repo: my-backend · score: 0.921
...
```

---

## HTTP API

The HTTP server (default port 3000) exposes:

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Returns `{"status":"ok"}` when ready |
| `/metrics` | GET | Prometheus metrics |
| `/repos` | GET | List indexed repos |
| `/repos/:id/status` | GET | Get repo indexing status |
| `/repos/:id/search` | POST | REST search endpoint |
| `/repos/:id/reindex` | POST | Trigger re-index |

To run the HTTP service separately (useful for team setups):

```bash
ROOT_PATH=/path/to/project QDRANT_URL=http://localhost:6333 npm start
```

---

## Architecture

```
npx qdrant-codebase-query
         │
         ▼
   mcp-entry.ts  ──── stdio MCP transport ──▶ AI client
         │
         ▼
   bootstrap.ts
   ┌──────────────────────────────────────────────┐
   │  EmbeddingAdapter (fastembed BGE-small 384d) │
   │  QdrantAdapter (collection lifecycle)         │
   │  IndexingCoordinator (scan → chunk → upsert) │
   │  FileWatcherManager (chokidar, debounced)     │
   │  SearchService (ANN search + filters)         │
   └──────────────────────────────────────────────┘
```

- **Chunking** — files are split into overlapping chunks (default 150 lines, 20 overlap) with deterministic content-hashed IDs
- **Incremental updates** — only changed/new files are re-embedded; deleted files are removed from the index
- **Vector dimensions** — BGE-Small-EN: 384, BGE-Base-EN: 768, Multilingual-E5-Large: 1024

---

## Development

```bash
git clone https://github.com/yourusername/qdrant-codebase-query
cd qdrant-codebase-query
npm install

# Run tests
npm test

# Build
npm run build

# Run MCP server from source (env-var config)
QDRANT_URL=http://localhost:6333 npm run mcp:dev

# Run HTTP service from source
QDRANT_URL=http://localhost:6333 npm run dev
```

### Running with a config file

```bash
cp config.example.yml config.yml
# Edit config.yml, then:
npm run dev
```

---

## Publishing

```bash
npm run build
npm publish
```

---

## License

MIT
