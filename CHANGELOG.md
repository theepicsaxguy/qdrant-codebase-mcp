# qdrant-codebase-mcp

## 0.1.2

### Patch Changes

- ccb95e0: Fix MCP stdio shutdown so Ctrl+C and host-managed stop requests terminate cleanly.

## 0.1.1

### Patch Changes

- 58eb260: Add MCP server and routing refinements, including tool registration changes and related server/bootstrap updates.
- 58eb260: Reduce noisy MCP stderr logging, make the file watcher use a polling fallback in VS Code-hosted MCP sessions, and ensure full indexing plus live file watching respect `.gitignore`.
