import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadConfig } from '../../src/config/loader';

describe('loadConfig env mode', () => {
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };
  let tempDir = '';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qdrant-config-'));
    process.chdir(tempDir);
    process.env = {
      QDRANT_URL: 'http://localhost:6333',
      SERVER_MODE: 'search-only',
      EMBEDDING_PROVIDER: 'openai-compatible',
      EMBEDDING_BASE_URL: 'https://embeddings.example.com/v1',
      EMBEDDING_MODEL: 'text-embedding-3-small',
      REPO_ID: 'webdocuments',
    };
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('requires COLLECTION_NAME for search-only env configs', () => {
    expect(() => loadConfig()).toThrow('COLLECTION_NAME is required when SERVER_MODE=search-only');
  });

  it('loads search-only env configs when collectionName is provided', () => {
    process.env['COLLECTION_NAME'] = 'webdocuments';

    const config = loadConfig();

    expect(config.serverMode).toBe('search-only');
    expect(config.repos[0]?.rootPath).toBeUndefined();
    expect(config.repos[0]?.collectionName).toBe('webdocuments');
  });
});
