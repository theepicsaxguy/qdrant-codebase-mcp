import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { isIndexable, isBinaryFile, scanRepo } from '../../src/scanner/scanner';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { RepoConfig } from '../../src/config/schema';

const baseRepo: RepoConfig = {
  repoId: 'test',
  collectionName: 'test-code',
  rootPath: '/tmp',
};

describe('isBinaryFile', () => {
  it('returns false for text files', () => {
    const tmp = path.join(os.tmpdir(), 'test-text.ts');
    fs.writeFileSync(tmp, 'const x = 1;\n');
    expect(isBinaryFile(tmp)).toBe(false);
    fs.unlinkSync(tmp);
  });

  it('returns true for file with null bytes', () => {
    const tmp = path.join(os.tmpdir(), 'test-binary.bin');
    const buf = Buffer.alloc(10, 0);
    fs.writeFileSync(tmp, buf);
    expect(isBinaryFile(tmp)).toBe(true);
    fs.unlinkSync(tmp);
  });

  it('returns true for non-existent file', () => {
    expect(isBinaryFile('/nonexistent/path/file.bin')).toBe(true);
  });
});

describe('isIndexable', () => {
  let tmpDir: string;

  it('returns true for a valid .ts file', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sci-test-'));
    const file = path.join(tmpDir, 'index.ts');
    fs.writeFileSync(file, 'const x = 1;\n');
    const repo = { ...baseRepo, rootPath: tmpDir };
    expect(isIndexable(file, tmpDir, repo, 1_000_000)).toBe(true);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('blocks path traversal outside root', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sci-test-'));
    const repo = { ...baseRepo, rootPath: tmpDir };
    expect(isIndexable('/etc/passwd', tmpDir, repo, 1_000_000)).toBe(false);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns false for ignored path (node_modules)', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sci-test-'));
    const nmDir = path.join(tmpDir, 'node_modules', 'lib');
    fs.mkdirSync(nmDir, { recursive: true });
    const file = path.join(nmDir, 'index.ts');
    fs.writeFileSync(file, 'const x = 1;\n');
    const repo = { ...baseRepo, rootPath: tmpDir };
    expect(isIndexable(file, tmpDir, repo, 1_000_000)).toBe(false);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns false for oversized file', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sci-test-'));
    const file = path.join(tmpDir, 'big.ts');
    fs.writeFileSync(file, 'x'.repeat(200));
    const repo = { ...baseRepo, rootPath: tmpDir };
    expect(isIndexable(file, tmpDir, repo, 100)).toBe(false);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns false for non-matching extension', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sci-test-'));
    const file = path.join(tmpDir, 'file.xyz');
    fs.writeFileSync(file, 'some content');
    const repo = { ...baseRepo, rootPath: tmpDir };
    expect(isIndexable(file, tmpDir, repo, 1_000_000)).toBe(false);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns false for files ignored by .gitignore', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sci-test-'));
    execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'ignored.ts\n');
    const file = path.join(tmpDir, 'ignored.ts');
    fs.writeFileSync(file, 'const x = 1;\n');
    const repo = { ...baseRepo, rootPath: tmpDir };
    expect(isIndexable(file, tmpDir, repo, 1_000_000)).toBe(false);
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('scanRepo', () => {
  it('excludes files ignored by gitignore rules', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-test-'));
    execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'ignored.ts\nnested/\n');
    fs.writeFileSync(path.join(tmpDir, 'indexed.ts'), 'const ok = true;\n');
    fs.writeFileSync(path.join(tmpDir, 'ignored.ts'), 'const hidden = true;\n');
    fs.mkdirSync(path.join(tmpDir, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'nested', 'skip.ts'), 'const skip = true;\n');

    const repo = { ...baseRepo, rootPath: tmpDir };
    const files = await scanRepo(repo, 1_000_000);

    expect(files).toEqual([path.join(tmpDir, 'indexed.ts')]);
    fs.rmSync(tmpDir, { recursive: true });
  });
});
