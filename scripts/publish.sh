#!/usr/bin/env bash
# publish.sh — publish to npm · MCP Registry · VS Code Extension Marketplace
#
# Usage:
#   ./scripts/publish.sh          # interactive (local)
#   ./scripts/publish.sh --ci     # non-interactive (GitHub Actions)
#   DRY_RUN=1 ./scripts/publish.sh
#
# Required env vars:
#   NPM_TOKEN          — npm automation token
#   MCP_REGISTRY_TOKEN — token from registry.modelcontextprotocol.io
#   VSCE_TOKEN         — Azure DevOps PAT for VS Code Marketplace
#                        (only required when vsce-extension/ exists)
#
# The VS Code extension lives in vsce-extension/ and is published separately
# from the npm package. If that directory doesn't exist, that step is skipped.

set -euo pipefail

CI_MODE=0
DRY_RUN="${DRY_RUN:-0}"
for arg in "$@"; do
  case "$arg" in
    --ci)     CI_MODE=1 ;;
    --dry-run) DRY_RUN=1 ;;
  esac
done

# ── Colour helpers ──────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${GREEN}[publish]${NC} $*"; }
warn()    { echo -e "${YELLOW}[publish]${NC} $*"; }
error()   { echo -e "${RED}[publish]${NC} $*" >&2; }
section() { echo -e "\n${BLUE}── $* ──${NC}"; }

# ── Token guards (skipped in dry-run — no actual publish happens) ───────────
if [ "$DRY_RUN" = "0" ]; then
  [ -z "${NPM_TOKEN:-}"          ] && { error "NPM_TOKEN is not set.";          exit 1; }
  [ -z "${MCP_REGISTRY_TOKEN:-}" ] && { error "MCP_REGISTRY_TOKEN is not set."; exit 1; }
fi

VSCE_EXTENSION_DIR="vsce-extension"
VSCE_ENABLED=0
if [ -f "${VSCE_EXTENSION_DIR}/package.json" ]; then
  VSCE_ENABLED=1
  [ "$DRY_RUN" = "0" ] && [ -z "${VSCE_TOKEN:-}" ] && {
    error "VSCE_TOKEN is not set but ${VSCE_EXTENSION_DIR}/ exists."
    exit 1
  }
fi

# ── Local-only guards (skip in CI and dry-run — Actions already enforces these)
if [ "$CI_MODE" = "0" ] && [ "$DRY_RUN" = "0" ]; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  if [ "$BRANCH" != "main" ]; then
    error "Must publish from main (currently on '${BRANCH}'). Aborting."
    exit 1
  fi

  if [ -n "$(git status --porcelain)" ]; then
    error "Working tree is dirty. Commit or stash all changes before publishing."
    exit 1
  fi

  section "Pulling latest from origin/main"
  git pull --ff-only origin main
fi

# ── Quality gate (always runs) ───────────────────────────────────────────────
section "Quality gate"
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
info "Preparing release: ${PACKAGE}@${VERSION}"

# ── Verify version not already published ────────────────────────────────────
if npm view "${PACKAGE}@${VERSION}" version &>/dev/null; then
  error "${PACKAGE}@${VERSION} is already on npm. Did you forget to bump the version?"
  exit 1
fi

# ── Dry run ─────────────────────────────────────────────────────────────────
if [ "$DRY_RUN" = "1" ]; then
  warn "DRY_RUN — skipping publish steps."
  npm pack --dry-run
  exit 0
fi

# ── Interactive confirmation (local only) ────────────────────────────────────
if [ "$CI_MODE" = "0" ]; then
  echo ""
  warn "About to publish ${PACKAGE}@${VERSION} to all platforms:"
  warn "  1. npm              (npx ${PACKAGE})"
  warn "  2. MCP Registry     (registry.modelcontextprotocol.io)"
  [ "$VSCE_ENABLED" = "1" ] && \
  warn "  3. VS Code Marketplace (${VSCE_EXTENSION_DIR})"
  echo ""
  read -r -p "Type the version to confirm [${VERSION}]: " CONFIRM
  if [ "$CONFIRM" != "$VERSION" ]; then
    error "Version mismatch. Aborting."
    exit 1
  fi
fi

# ── Sync mcp-registry.json version ──────────────────────────────────────────
node -e "
  const fs = require('fs');
  const reg = JSON.parse(fs.readFileSync('mcp-registry.json', 'utf8'));
  reg.version = '${VERSION}';
  reg.packages[0].version = '${VERSION}';
  fs.writeFileSync('mcp-registry.json', JSON.stringify(reg, null, 2) + '\n');
"

# ═══════════════════════════════════════════════════════════════════════════
section "Platform 1 of 3 — npm  (npx ${PACKAGE})"
# ═══════════════════════════════════════════════════════════════════════════
NPM_TOKEN="$NPM_TOKEN" npm publish --access public --provenance
info "npm publish complete."

# Tag the release so other jobs/steps can reference the exact commit
if [ "$CI_MODE" = "0" ]; then
  git tag -a "v${VERSION}" -m "Release v${VERSION}"
  git push origin "v${VERSION}"
  info "Git tag v${VERSION} pushed."
fi

# ═══════════════════════════════════════════════════════════════════════════
section "Platform 2 of 3 — MCP Registry"
# ═══════════════════════════════════════════════════════════════════════════
MCP_REGISTRY_TOKEN="$MCP_REGISTRY_TOKEN" npx mcp-publisher publish
info "MCP Registry publish complete."

# ═══════════════════════════════════════════════════════════════════════════
section "Platform 3 of 3 — VS Code Extension Marketplace"
# ═══════════════════════════════════════════════════════════════════════════
if [ "$VSCE_ENABLED" = "1" ]; then
  info "Building and publishing VS Code extension from ${VSCE_EXTENSION_DIR}/…"
  # Sync extension version to match npm package version
  node -e "
    const fs = require('fs');
    const ext = JSON.parse(fs.readFileSync('${VSCE_EXTENSION_DIR}/package.json', 'utf8'));
    ext.version = '${VERSION}';
    fs.writeFileSync('${VSCE_EXTENSION_DIR}/package.json', JSON.stringify(ext, null, 2) + '\n');
  "
  (cd "${VSCE_EXTENSION_DIR}" && npm ci && npx vsce publish --pat "${VSCE_TOKEN}")
  info "VS Code Marketplace publish complete."
else
  warn "VS Code extension not yet built (${VSCE_EXTENSION_DIR}/ missing)."
  warn "See CONTRIBUTING.md for instructions on scaffolding the extension."
  warn "VS Code users can install via deep link:"
  warn "  vscode:mcp/install?%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22${PACKAGE}%22%5D%7D"
fi

# ═══════════════════════════════════════════════════════════════════════════
section "Done — ${PACKAGE}@${VERSION}"
# ═══════════════════════════════════════════════════════════════════════════
info "npm:          https://www.npmjs.com/package/${PACKAGE}/v/${VERSION}"
info "MCP Registry: https://registry.modelcontextprotocol.io"
[ "$VSCE_ENABLED" = "1" ] && \
info "VS Code:      https://marketplace.visualstudio.com/items?itemName=theepicsaxguy.${PACKAGE}"
