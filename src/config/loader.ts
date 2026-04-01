import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { AppConfig, AppConfigSchema } from './schema';

function expandPath(p: string, configDir: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(2));
  }
  if (path.isAbsolute(p)) return p;
  return path.resolve(configDir, p);
}

export function loadConfig(configPath?: string): AppConfig {
  const filePath = configPath ?? process.env['CONFIG_PATH'] ?? 'config.yml';
  const resolved = path.resolve(filePath);
  const configDir = path.dirname(resolved);

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

  const cfg = result.data;

  // Environment variable overrides (take precedence over config file)
  if (process.env['QDRANT_URL']) cfg.qdrantUrl = process.env['QDRANT_URL'];
  if (process.env['QDRANT_API_KEY']) cfg.qdrantApiKey = process.env['QDRANT_API_KEY'];
  if (process.env['PORT']) cfg.port = Number(process.env['PORT']);

  // Validate and expand repo root paths
  for (const repo of cfg.repos) {
    const abs = expandPath(repo.rootPath, configDir);
    if (!fs.existsSync(abs)) {
      throw new Error(`Repo root path does not exist: ${abs} (repoId: ${repo.repoId})`);
    }
    repo.rootPath = abs;
  }

  return cfg;
}
