import { describe, expect, it } from 'vitest';
import { applyMcpRuntimeDefaults } from '../../src/mcp/runtime-defaults';

function createEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    ...overrides,
  };
}

describe('applyMcpRuntimeDefaults', () => {
  it('defaults MCP logging to warn when no explicit level is set', () => {
    const env = createEnv();

    applyMcpRuntimeDefaults(env);

    expect(env['LOG_LEVEL']).toBe('warn');
  });

  it('preserves an explicit log level', () => {
    const env = createEnv({ LOG_LEVEL: 'debug' });

    applyMcpRuntimeDefaults(env);

    expect(env['LOG_LEVEL']).toBe('debug');
  });

  it('enables chokidar polling automatically in VS Code hosts', () => {
    const env = createEnv({ VSCODE_IPC_HOOK: '/tmp/vscode.sock' });

    applyMcpRuntimeDefaults(env);

    expect(env['CHOKIDAR_USEPOLLING']).toBe('1');
  });

  it('honors an explicit polling disable override', () => {
    const env = createEnv({
      TERM_PROGRAM: 'vscode',
      WATCHER_USE_POLLING: 'false',
    });

    applyMcpRuntimeDefaults(env);

    expect(env['CHOKIDAR_USEPOLLING']).toBeUndefined();
  });

  it('maps watcher poll interval into chokidar interval', () => {
    const env = createEnv({
      WATCHER_POLL_INTERVAL_MS: '250',
      VSCODE_IPC_HOOK: '/tmp/vscode.sock',
    });

    applyMcpRuntimeDefaults(env);

    expect(env['CHOKIDAR_INTERVAL']).toBe('250');
  });
});
