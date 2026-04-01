# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.x     | Yes       |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report vulnerabilities privately via GitHub's Security Advisory feature:
**[Report a vulnerability](https://github.com/theepicsaxguy/qdrant-codebase-query/security/advisories/new)**

Please include:
- A description of the vulnerability and its potential impact
- Steps to reproduce
- Any suggested fix or mitigation

You will receive a response within 72 hours. If confirmed, a patch will be released as soon as possible and you will be credited in the release notes.

## Scope

- Secrets/credentials leaking through the MCP tool interface
- Path traversal via `ROOT_PATH` or file scanning
- Arbitrary code execution via configuration inputs
- Dependency vulnerabilities in published versions
