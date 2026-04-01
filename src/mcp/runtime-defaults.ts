type EnvMap = NodeJS.ProcessEnv;

function hasVsCodeHost(env: EnvMap): boolean {
  if (env['TERM_PROGRAM'] === 'vscode') {
    return true;
  }

  return env['VSCODE_IPC_HOOK'] !== undefined || env['VSCODE_IPC_HOOK_CLI'] !== undefined;
}

function parseBooleanFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return normalized.length > 0;
}

function shouldEnablePolling(env: EnvMap): boolean {
  const explicit = parseBooleanFlag(env['WATCHER_USE_POLLING'] ?? env['CHOKIDAR_USEPOLLING']);
  if (explicit !== undefined) {
    return explicit;
  }

  return hasVsCodeHost(env);
}

export function applyMcpRuntimeDefaults(env: EnvMap = process.env): void {
  env['LOG_LEVEL'] ??= 'warn';

  if (shouldEnablePolling(env) && env['CHOKIDAR_USEPOLLING'] === undefined) {
    env['CHOKIDAR_USEPOLLING'] = '1';
  }

  const pollInterval = env['WATCHER_POLL_INTERVAL_MS'];
  if (pollInterval !== undefined && env['CHOKIDAR_INTERVAL'] === undefined) {
    env['CHOKIDAR_INTERVAL'] = pollInterval;
  }
}
