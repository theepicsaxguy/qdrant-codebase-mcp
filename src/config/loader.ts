import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { AppConfig, AppConfigSchema } from './schema';

export function loadConfig(configPath?: string): AppConfig {
  const filePath = configPath ?? process.env['CONFIG_PATH'] ?? 'config.yml';
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }

  const raw = fs.readFileSync(resolved, 'utf-8');
  let parsed: unknown;

  if (resolved.endsWith('.json')) {
    parsed = JSON.parse(raw);
  } else {
    parsed = yaml.load(raw);
  }

  const result = AppConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid config:\n${issues}`);
  }

  // Validate repo root paths
  for (const repo of result.data.repos) {
    const abs = path.resolve(repo.rootPath);
    if (!fs.existsSync(abs)) {
      throw new Error(`Repo root path does not exist: ${abs} (repoId: ${repo.repoId})`);
    }
    // Normalise rootPath to absolute
    repo.rootPath = abs;
  }

  return result.data;
}
