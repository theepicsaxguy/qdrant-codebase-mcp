#!/usr/bin/env bash
# publish.sh — safe manual publish to npm + MCP Registry
# Run from the project root: ./scripts/publish.sh
#
# Required env vars:
#   NPM_TOKEN          — npm publish token (automation token, not legacy)
#   MCP_REGISTRY_TOKEN — token from registry.modelcontextprotocol.io
#
# Optional:
#   DRY_RUN=1          — validate everything but do not actually publish

set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"

# ── Colour helpers ──────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[publish]${NC} $*"; }
warn()  { echo -e "${YELLOW}[publish]${NC} $*"; }
error() { echo -e "${RED}[publish]${NC} $*" >&2; }

# ── Guards ──────────────────────────────────────────────────────────────────
if [ -z "${NPM_TOKEN:-}" ]; then
  error "NPM_TOKEN is not set. Aborting."
  exit 1
fi

if [ -z "${MCP_REGISTRY_TOKEN:-}" ]; then
  error "MCP_REGISTRY_TOKEN is not set. Aborting."
  exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  error "Must publish from main (currently on '$BRANCH'). Aborting."
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  error "Working tree is dirty. Commit or stash changes before publishing."
  exit 1
fi

# ── Pull latest ─────────────────────────────────────────────────────────────
info "Pulling latest from origin/main…"
git pull --ff-only origin main

# ── Quality gate ────────────────────────────────────────────────────────────
info "Running quality gate…"
npm ci
npm run typecheck
npm run lint
npm run knip
npm run audit
npm test
npm run build

# ── Read version ────────────────────────────────────────────────────────────
VERSION=$(node -p "require('./package.json').version")
PACKAGE=$(node -p "require('./package.json').name")
info "Publishing ${PACKAGE}@${VERSION}"

# ── Verify no existing publish for this version ─────────────────────────────
if npm view "${PACKAGE}@${VERSION}" version &>/dev/null; then
  error "${PACKAGE}@${VERSION} is already published on npm. Bump the version first."
  exit 1
fi

# ── Confirm ─────────────────────────────────────────────────────────────────
if [ "$DRY_RUN" = "1" ]; then
  warn "DRY_RUN=1 — skipping actual publish steps."
  npm pack --dry-run
  exit 0
fi

echo ""
warn "You are about to publish ${PACKAGE}@${VERSION} to:"
warn "  1. npm (public)"
warn "  2. MCP Registry (modelcontextprotocol.io)"
warn ""
read -r -p "Type the version to confirm [${VERSION}]: " CONFIRM
if [ "$CONFIRM" != "$VERSION" ]; then
  error "Version mismatch. Aborting."
  exit 1
fi

# ── 1. Publish to npm ────────────────────────────────────────────────────────
info "Publishing to npm…"
NPM_TOKEN="$NPM_TOKEN" npm publish --access public --provenance
info "npm publish complete."

# ── 2. Tag the release ───────────────────────────────────────────────────────
info "Tagging v${VERSION}…"
git tag -a "v${VERSION}" -m "Release v${VERSION}"
git push origin "v${VERSION}"
info "Git tag pushed."

# ── 3. Publish to MCP Registry ───────────────────────────────────────────────
info "Updating mcp-registry.json version to ${VERSION}…"
# Keep mcp-registry.json in sync with package.json version
node -e "
  const fs = require('fs');
  const reg = JSON.parse(fs.readFileSync('mcp-registry.json', 'utf8'));
  reg.version = '${VERSION}';
  reg.packages[0].version = '${VERSION}';
  fs.writeFileSync('mcp-registry.json', JSON.stringify(reg, null, 2) + '\n');
"

info "Publishing to MCP Registry…"
MCP_REGISTRY_TOKEN="$MCP_REGISTRY_TOKEN" npx mcp-publisher publish
info "MCP Registry publish complete."

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
info "Released ${PACKAGE}@${VERSION} to:"
info "  npm:          https://www.npmjs.com/package/${PACKAGE}/v/${VERSION}"
info "  MCP Registry: https://registry.modelcontextprotocol.io"
info "  VS Code URL:  vscode:mcp/install?%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22${PACKAGE}%22%5D%7D"
