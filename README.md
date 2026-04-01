<p align="center">
  <img src="assets/logo.svg" width="128" alt="qdrant-codebase-mcp" />
</p>

<h2 align="center">qdrant-codebase-mcp</h2>

<p align="center">
  <strong>Stop your agent re-exploring your repo on every task.</strong><br>
  Index once into Qdrant. Search semantically, forever. Save tokens every time.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/qdrant-codebase-mcp">
    <img src="https://img.shields.io/npm/v/qdrant-codebase-mcp?color=ea580c&label=npm" alt="npm version"/>
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"/>
  </a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node ≥ 20"/>
  <a href="https://github.com/theepicsaxguy/qdrant-codebase-mcp/actions/workflows/ci.yml">
    <img src="https://github.com/theepicsaxguy/qdrant-codebase-mcp/actions/workflows/ci.yml/badge.svg" alt="CI"/>
  </a>
  <a href="https://modelcontextprotocol.io">
    <img src="https://img.shields.io/badge/MCP-compatible-blueviolet" alt="MCP compatible"/>
  </a>
</p>

---

## What it does

`qdrant-codebase-mcp` runs as a background service that:

1. **Indexes your codebase** into a [Qdrant](https://qdrant.tech) vector database using [FastEmbed](https://github.com/Anush008/fastembed-js) — locally, no external API calls needed
2. **Watches for changes** and re-indexes only modified files automatically
3. **Exposes MCP tools** so any AI assistant (Roo Code, VS Code Copilot, Claude, Cursor, Windsurf) can search your code by semantic meaning

When an agent calls `search_code("where is JWT validation done?")` it gets back the right file, the right lines, and a similarity score — not a grep list.

---

## How indexing works

```
File saved
    │
    ▼
chokidar detects write event
    │
    ▼  awaitWriteFinish — waits until the file handle closes
    │
    ▼  per-file debounce (default 2 s)
       resets if the file is saved again before the timer fires
    │
    ▼
IndexingCoordinator.indexFile()
  ├─ delete stale vectors for this file from Qdrant
  ├─ chunk the file  (overlapping windows, 150 lines / 20 overlap)
  ├─ embed all chunks in one batch  (BGE-Small-EN → 384-dim vectors)
  └─ upsert vectors + metadata into Qdrant
```

Only the **changed file** is re-indexed on save — not the whole codebase.
A full initial index runs once on startup.

**What the vectors contain:**
Each vector point in Qdrant carries the code chunk, file path, language, line numbers, content hash, and timestamp as payload — giving the agent full context alongside the embedding.

---

## Quickstart

You need a running Qdrant instance. The fastest way:

```bash
docker run -p 6333:6333 qdrant/qdrant
```

Then from your project directory:

```bash
QDRANT_URL=http://localhost:6333 npx qdrant-codebase-mcp
```

The server will connect to Qdrant, create a collection, index your code, start watching for changes, and serve MCP over stdio — all in one command.

**One-click install into VS Code:**

[Install in VS Code](vscode:mcp/install?%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22qdrant-codebase-mcp%22%5D%7D)

---

## MCP client setup

### VS Code (GitHub Copilot / Roo Code)

Add to `.vscode/mcp.json` in your workspace:

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
      "description": "Qdrant API key (leave empty for local instances)",
      "password": true
    }
  ],
  "servers": {
    "qdrant-codebase-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "qdrant-codebase-mcp"],
      "env": {
        "QDRANT_URL": "${input:qdrantUrl}",
        "QDRANT_API_KEY": "${input:qdrantApiKey}",
        "ROOT_PATH": "${workspaceFolder}"
      }
    }
  }
}
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
`%APPDATA%\Claude\claude_desktop_config.json` (Windows)

```json
{
  "mcpServers": {
    "qdrant-codebase-mcp": {
      "command": "npx",
      "args": ["-y", "qdrant-codebase-mcp"],
      "env": {
        "QDRANT_URL": "http://localhost:6333",
        "ROOT_PATH": "/path/to/your/project"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add qdrant-codebase-mcp \
  -e QDRANT_URL=http://localhost:6333 \
  -- npx -y qdrant-codebase-mcp
```

### Cursor

**Settings → MCP → Add new MCP server:**

```json
{
  "name": "qdrant-codebase-mcp",
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "qdrant-codebase-mcp"],
  "env": {
    "QDRANT_URL": "http://localhost:6333",
    "ROOT_PATH": "/path/to/your/project"
  }
}
```

### Windsurf

`~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "qdrant-codebase-mcp": {
      "command": "npx",
      "args": ["-y", "qdrant-codebase-mcp"],
      "env": {
        "QDRANT_URL": "http://localhost:6333",
        "ROOT_PATH": "/path/to/your/project"
      }
    }
  }
}
```

---

## MCP tools

| Tool | Input | What it returns |
|---|---|---|
| `search_code` | `query`, optional: `repoId`, `language`, `directoryPrefix`, `limit`, `minScore` | Ranked code chunks with file path, line range, language, similarity score |
| `list_repos` | — | All configured repos with collection name and root path |
| `get_repo_status` | `repoId` | Indexing state, timestamps, last error, embedding model info |
| `trigger_reindex` | `repoId` | Kicks off a full re-index in the background, returns immediately |

**Example — finding code by concept:**

```
search_code("JWT token validation")
```

```
### 1. src/auth/middleware.ts  lines 45–72  ·  repo: my-backend  ·  score: 0.921
\`\`\`typescript
export async function validateJwt(token: string): Promise<JwtPayload> {
  ...
}
\`\`\`

### 2. src/api/guards/auth.guard.ts  lines 12–34  ·  score: 0.887
...
```

---

## Configuration

All settings are via **environment variables** or an optional `config.yml`.

| Variable | Default | Description |
|---|---|---|
| `QDRANT_URL` | `http://localhost:6333` | Qdrant server URL |
| `QDRANT_API_KEY` | — | Qdrant API key (required for Qdrant Cloud) |
| `ROOT_PATH` | `process.cwd()` | Repository root to index |
| `COLLECTION_NAME` | `<folder>-<hash>` | Qdrant collection (auto-generated) |
| `REPO_ID` | folder name | Logical name shown in MCP tools |
| `EMBEDDING_MODEL` | `fast-bge-small-en-v1.5` | FastEmbed model |
| `EMBEDDING_BATCH_SIZE` | `64` | Chunks per embedding batch |
| `CHUNK_MAX_LINES` | `150` | Max lines per code chunk |
| `CHUNK_OVERLAP_LINES` | `20` | Overlap between adjacent chunks |
| `MAX_FILE_SIZE_BYTES` | `1000000` | Files larger than this are skipped |
| `WATCHER_DEBOUNCE_MS` | `2000` | Quiet period after a save before re-indexing |
| `PORT` | `3000` | HTTP health/metrics port |
| `CONFIG_PATH` | — | Path to a `config.yml` for multi-repo setups |

### Multi-repo config.yml

```yaml
qdrantUrl: https://your-cluster.qdrant.tech
qdrantApiKey: your-api-key
embeddingModel: fast-bge-small-en-v1.5
chunkMaxLines: 150
chunkOverlapLines: 20
watcherDebounceMs: 2000

repos:
  - repoId: backend
    rootPath: ./src/backend
    collectionName: backend-code
  - repoId: frontend
    rootPath: ./src/frontend
    collectionName: frontend-code
```

### Supported embedding models

| Model | Dimensions | Notes |
|---|---|---|
| `fast-bge-small-en-v1.5` | 384 | Default — fast, low memory |
| `fast-bge-base-en-v1.5` | 768 | Better recall, more memory |
| `multilingual-e5-large` | 1024 | Multi-language codebases |

---

## HTTP API

The service also exposes a REST API (default port 3000):

| Endpoint | Description |
|---|---|
| `GET /health` | `{"status":"ok"}` when ready |
| `GET /metrics` | Prometheus metrics |
| `GET /repos` | List all indexed repos |
| `GET /repos/:id/status` | Indexing status for a repo |
| `POST /repos/:id/search` | REST search (same as MCP `search_code`) |
| `POST /repos/:id/reindex` | Trigger a full re-index |

---

## Architecture

```
npx qdrant-codebase-mcp
         │
         ├── stdio ──────────────────────────────▶ MCP client (AI assistant)
         │          search_code / list_repos /
         │          get_repo_status / trigger_reindex
         │
         └── mcp-entry.ts
                   │
                   ▼
             bootstrap.ts  (initialises all services)
             ┌────────────────────────────────────────────┐
             │                                            │
             │  EmbeddingAdapter                          │
             │  └─ FastEmbed BGE-Small-EN (384-dim)       │
             │     runs locally, no API calls             │
             │                                            │
             │  QdrantAdapter (per repo)                  │
             │  └─ collection lifecycle + upsert/search   │
             │                                            │
             │  IndexingCoordinator                       │
             │  └─ scan → chunk → embed → upsert          │
             │     incremental: only changed files        │
             │                                            │
             │  FileWatcherManager                        │
             │  └─ chokidar + per-file debounce           │
             │                                            │
             │  SearchService                             │
             │  └─ embed query → ANN search → rank        │
             │     single-repo and cross-repo             │
             └────────────────────────────────────────────┘
```

---

## Development

```bash
git clone https://github.com/theepicsaxguy/qdrant-codebase-mcp
cd qdrant-codebase-mcp
npm install
cp config.example.yml config.yml   # fill in your Qdrant URL

npm run typecheck    # tsc --noEmit
npm run lint         # ESLint (zero warnings)
npm test             # unit tests
npm run build        # compile to dist/
```

### Running the MCP server from source

Point your MCP client at the local source instead of the published package.
The `mcp:dev` script uses `tsx` so changes are reflected without a rebuild.

**VS Code — `.vscode/mcp.json`:**

```json
{
  "servers": {
    "qdrant-codebase-mcp-dev": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/qdrant-codebase-mcp/src/mcp-entry.ts"],
      "env": {
        "QDRANT_URL": "http://localhost:6333",
        "ROOT_PATH": "${workspaceFolder}"
      }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add qdrant-codebase-mcp-dev \
  -e QDRANT_URL=http://localhost:6333 \
  -e ROOT_PATH=/path/to/your/project \
  -- npx tsx /absolute/path/to/qdrant-codebase-mcp/src/mcp-entry.ts
```

**Any other client (generic stdio):**

```bash
QDRANT_URL=http://localhost:6333 \
ROOT_PATH=/path/to/your/project \
npx tsx src/mcp-entry.ts
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contributor guide including commit conventions, changeset requirements, and the release process.

---

## License

[MIT](LICENSE)
