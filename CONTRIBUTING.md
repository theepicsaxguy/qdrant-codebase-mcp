# Contributing to qdrant-codebase-mcp

## Prerequisites

- Node.js ≥ 20
- A running Qdrant instance (see `docker-compose.yml`)
- Familiarity with the [MCP specification](https://modelcontextprotocol.io)

## Setup

```bash
git clone https://github.com/theepicsaxguy/qdrant-codebase-mcp
cd qdrant-codebase-mcp
npm install
cp config.example.yml config.yml   # fill in your values
```

## Development workflow

```bash
npm run dev          # tsx watch — rebuilds on save
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint (zero warnings tolerated)
npm test             # unit tests
```

## Commit messages

This project enforces [Conventional Commits](https://www.conventionalcommits.org/).  
Commits that do not conform will be rejected by the `commit-msg` hook.

```
<type>(<scope>): <subject>

feat(search): add fuzzy match fallback for low-confidence results
fix(indexer): handle symlinked directories without infinite loop
docs: update Qdrant Cloud setup instructions
```

**Allowed types:** `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert`

Breaking changes: append `!` after the type (`feat!:`) and add a `BREAKING CHANGE:` footer.

## Changesets (versioning)

Every PR that changes published behaviour **must** include a changeset:

```bash
npx changeset          # describe your change and choose major/minor/patch
git add .changeset/
```

CI will reject the release PR if the changeset is missing. If your change is purely internal (docs, CI, test) you may skip this — but be explicit in the PR checklist.

## Pull request rules

- One concern per PR — split unrelated changes
- All CI checks must pass — no exceptions
- At least one CODEOWNERS review required before merge
- Squash merge only — keeps history linear
- The PR title must be a valid Conventional Commit subject (used as the squash commit message)

## Security

Found a vulnerability? **Do not open a public issue.**  
Report privately via [GitHub Security Advisories](https://github.com/theepicsaxguy/qdrant-codebase-mcp/security/advisories/new).  
See [SECURITY.md](SECURITY.md) for full policy.

## Releasing

Releases are fully automated via GitHub Actions + Changesets.  
Maintainers with publish rights never run `npm publish` manually — merge the Version Packages PR and CI handles everything.

For emergency manual releases, see `scripts/publish.sh`.
