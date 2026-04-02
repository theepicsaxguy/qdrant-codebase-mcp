import * as path from 'path';
import * as yaml from 'js-yaml';
import { AppConfigSchema, type AppConfig } from './schema';
import {
  applyEnvOverrides,
  buildEnvConfig,
  buildRepoFromEnv,
  fileExists,
  formatIssues,
  normalizeRepoPaths,
  readTextFile,
} from './loader.helpers';

export function loadConfig(configPath?: string): AppConfig {
  const explicit = configPath ?? process.env['CONFIG_PATH'];
  if (explicit !== undefined) {
    return loadConfigFromFile(explicit);
  }

  const autoDetect = path.resolve(process.cwd(), 'config.yml');
  if (fileExists(autoDetect)) {
    return loadConfigFromFile(autoDetect);
  }

  return loadConfigFromEnv();
}

function loadConfigFromEnv(): AppConfig {
  const repo = buildRepoFromEnv(process.cwd(), process.env);
  return parseAppConfig(buildEnvConfig(repo, process.env), 'environment configuration');
}

function loadConfigFromFile(configPath: string): AppConfig {
  const resolved = path.resolve(configPath);
  if (!fileExists(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }

  const config = parseAppConfig(
    applyEnvOverrides(parseConfigFile(resolved), process.env),
    'config file'
  );
  normalizeRepoPaths(config, path.dirname(resolved));
  return config;
}

function parseAppConfig(config: unknown, sourceName: string): AppConfig {
  const result = AppConfigSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid ${sourceName}:\n${formatIssues(result.error.issues)}`);
  }

  return result.data;
}

function parseConfigFile(resolved: string): unknown {
  const raw = readTextFile(resolved);
  return resolved.endsWith('.json') ? JSON.parse(raw) : yaml.load(raw);
}
