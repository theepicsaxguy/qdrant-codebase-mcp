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

### Install from source with `uvx`

If you want to run directly from GitHub source instead of the published npm package:

```bash
QDRANT_URL=http://localhost:6333 \
ROOT_PATH=/path/to/your/project \
uvx --from git+https://github.com/theepicsaxguy/qdrant-codebase-mcp qdrant-codebase-mcp
```

For Qdrant Cloud or any authenticated endpoint, pass the API key the same way:

```bash
QDRANT_URL=https://your-cluster.qdrant.tech \
QDRANT_API_KEY=your-qdrant-api-key \
ROOT_PATH=/path/to/your/project \
uvx --from git+https://github.com/theepicsaxguy/qdrant-codebase-mcp qdrant-codebase-mcp
```

The `uvx` launcher clones the Git source, builds the Node server once per commit in a cache directory, and then runs `dist/mcp-entry.js` with your current environment.
`node` and `npm` still need to be available on your `PATH`.
If you prefer config files, set `CONFIG_PATH=/absolute/path/to/config.yml`; environment variables still take precedence over values inside that file.

**One-click install into VS Code:**

[Install in VS Code](vscode:mcp/install?%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22qdrant-codebase-mcp%22%5D%7D)

---

## MCP client setup

If you have multiple existing Qdrant collections built with different embedding models, configure **multiple MCP server entries**.
Each server process should point at exactly one embedding provider/model combination.
Do not mix different embedding spaces inside one server instance.

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
    },
    {
      "type": "promptString",
      "id": "embeddingApiKey",
      "description": "Embedding API key for OpenAI-compatible backends",
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
    },
    "webdocuments-search": {
      "type": "stdio",
      "command": "uvx",
      "args": [
        "--from",
        "git+https://github.com/theepicsaxguy/qdrant-codebase-mcp",
        "qdrant-codebase-mcp"
      ],
      "env": {
        "QDRANT_URL": "${input:qdrantUrl}",
        "QDRANT_API_KEY": "${input:qdrantApiKey}",
        "SERVER_MODE": "search-only",
        "REPO_ID": "webdocuments",
        "COLLECTION_NAME": "webdocuments",
        "EMBEDDING_PROVIDER": "openai-compatible",
        "EMBEDDING_BASE_URL": "https://your-openai-compatible-endpoint/v1",
        "EMBEDDING_API_KEY": "${input:embeddingApiKey}",
        "EMBEDDING_MODEL": "text-embedding-3-large"
      }
    }
  }
}
```

Use the same pattern to add `webdocuments-2`, `tickets-search`, or any other dedicated index. One collection/model pair should map to one MCP server entry.

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

| Tool              | Input                                                                           | What it returns                                                           |
| ----------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `search_code`     | `query`, optional: `repoId`, `language`, `directoryPrefix`, `limit`, `minScore` | Ranked code chunks with file path, line range, language, similarity score |
| `list_repos`      | —                                                                               | All configured repos with collection name, mode, and root path            |
| `get_repo_status` | `repoId`                                                                        | Indexing state, timestamps, server mode, embedding provider/model info    |
| `trigger_reindex` | `repoId`                                                                        | Kicks off a full re-index in the background; unsupported in `search-only` |

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
Precedence is: **environment variables -> `config.yml` -> built-in defaults**.

| Variable               | Default                  | Description                                       |
| ---------------------- | ------------------------ | ------------------------------------------------- |
| `QDRANT_URL`           | `http://localhost:6333`  | Qdrant server URL                                 |
| `QDRANT_API_KEY`       | —                        | Qdrant API key (required for Qdrant Cloud)        |
| `SERVER_MODE`          | `index-and-watch`        | `index-and-watch` or `search-only`                |
| `ROOT_PATH`            | `process.cwd()`          | Repository root to index (`index-and-watch` only) |
| `COLLECTION_NAME`      | `<folder>-<hash>`        | Qdrant collection; required in `search-only`      |
| `REPO_ID`              | folder name              | Logical name shown in MCP tools                   |
| `EMBEDDING_PROVIDER`   | `fastembed`             | `fastembed` or `openai-compatible`                |
| `EMBEDDING_MODEL`      | `fast-bge-small-en-v1.5` | Embedding model name                              |
| `EMBEDDING_BASE_URL`   | —                        | OpenAI-compatible embeddings base URL             |
| `EMBEDDING_API_KEY`    | —                        | OpenAI-compatible embeddings API key              |
| `EMBEDDING_DIMENSIONS` | —                        | Optional explicit embedding vector size           |
| `EMBEDDING_HEADERS_JSON` | —                      | Optional JSON object of extra embedding headers   |
| `EMBEDDING_BATCH_SIZE` | `64`                     | Chunks per embedding batch                        |
| `CHUNK_MAX_LINES`      | `150`                    | Max lines per code chunk                          |
| `CHUNK_OVERLAP_LINES`  | `20`                     | Overlap between adjacent chunks                   |
| `MAX_FILE_SIZE_BYTES`  | `1000000`                | Files larger than this are skipped                |
| `WATCHER_DEBOUNCE_MS`  | `2000`                   | Quiet period after a save before re-indexing      |
| `MIN_SCORE`            | `0.78`                   | Minimum similarity score for search results (0-1) |
| `PORT`                 | `3000`                   | HTTP health/metrics port                          |
| `CONFIG_PATH`          | —                        | Path to a `config.yml` for multi-repo setups      |

### Multi-repo config.yml

```yaml
qdrantUrl: https://your-cluster.qdrant.tech
qdrantApiKey: your-api-key
serverMode: index-and-watch
embeddingProvider: fastembed
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

### Dedicated search-only config.yml

Use this mode when the collection already exists in Qdrant and was embedded with an OpenAI-compatible model.

```yaml
qdrantUrl: https://your-cluster.qdrant.tech
qdrantApiKey: your-api-key
serverMode: search-only
embeddingProvider: openai-compatible
embeddingBaseUrl: https://your-openai-compatible-endpoint/v1
embeddingApiKey: your-embedding-api-key
embeddingModel: text-embedding-3-large

repos:
  - repoId: webdocuments
    collectionName: webdocuments
```

If you have five dedicated indexes using five different embedding models, run five MCP server entries in your client config. Each entry should set its own `REPO_ID`, `COLLECTION_NAME`, `EMBEDDING_BASE_URL`, and `EMBEDDING_MODEL`.

### Supported embedding models

| Model                    | Dimensions | Notes                      |
| ------------------------ | ---------- | -------------------------- |
| `fast-bge-small-en-v1.5` | 384        | Default — fast, low memory |
| `fast-bge-base-en-v1.5`  | 768        | Better recall, more memory |
| `multilingual-e5-large`  | 1024       | Multi-language codebases   |

---

## HTTP API

The service also exposes a REST API (default port 3000):

| Endpoint                  | Description                             |
| ------------------------- | --------------------------------------- |
| `GET /health`             | `{"status":"ok"}` when ready            |
| `GET /metrics`            | Prometheus metrics                      |
| `GET /repos`              | List all indexed repos                  |
| `GET /repos/:id/status`   | Indexing status for a repo              |
| `POST /repos/:id/search`  | REST search (same as MCP `search_code`) |
| `POST /repos/:id/reindex` | Trigger a full re-index                 |

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
             │  └─ FastEmbed or OpenAI-compatible         │
             │     one provider/model per server process  │
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
             │     skipped in search-only mode            │
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

If the source run targets Qdrant Cloud, include `QDRANT_API_KEY` or point `CONFIG_PATH` at a config file that contains `qdrantApiKey`:

```bash
QDRANT_URL=https://your-cluster.qdrant.tech \
QDRANT_API_KEY=your-qdrant-api-key \
ROOT_PATH=/path/to/your/project \
npx tsx src/mcp-entry.ts
```

### Source install with `uvx`

For a source install without cloning the repo manually:

```bash
uvx --from git+https://github.com/theepicsaxguy/qdrant-codebase-mcp qdrant-codebase-mcp
```

For authenticated Qdrant instances:

```bash
QDRANT_URL=https://your-cluster.qdrant.tech \
QDRANT_API_KEY=your-qdrant-api-key \
ROOT_PATH=/path/to/your/project \
uvx --from git+https://github.com/theepicsaxguy/qdrant-codebase-mcp qdrant-codebase-mcp
```

If you see `authentication failed. Set QDRANT_API_KEY or qdrantApiKey in config.`, the server started correctly but the Qdrant connection is missing credentials. Pass `QDRANT_API_KEY` in the client `env` block or run with `CONFIG_PATH=/absolute/path/to/config.yml`.

For dedicated external indexes, add environment variables in your client config:

```json
{
  "SERVER_MODE": "search-only",
  "REPO_ID": "webdocuments",
  "COLLECTION_NAME": "webdocuments",
  "EMBEDDING_PROVIDER": "openai-compatible",
  "EMBEDDING_BASE_URL": "https://your-openai-compatible-endpoint/v1",
  "EMBEDDING_API_KEY": "your-embedding-api-key",
  "EMBEDDING_MODEL": "text-embedding-3-large"
}
```

### Security note on `npm audit`

Current installs may report one high-severity advisory in transitive `lodash@4.17.23`.
In this repository that package is pulled in through `secretlint`, which is only used by the linting toolchain and pre-commit workflow, not by the published server runtime.
That still merits dependency hygiene, but it is a much lower risk than a vulnerability in the production dependency graph that handles MCP requests or Qdrant traffic.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contributor guide including commit conventions, changeset requirements, and the release process.

---

## License

[MIT](LICENSE)


test
