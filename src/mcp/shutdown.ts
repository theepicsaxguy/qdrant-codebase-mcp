import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../logger';
import type { FileWatcherManager } from '../watcher/watcher';

type ShutdownSignal = 'SIGINT' | 'SIGTERM';
type ShutdownReason = ShutdownSignal | 'stdin-close' | 'stdin-end';

interface ShutdownStdin {
  off(event: 'close' | 'end', listener: () => void): ShutdownStdin;
  once(event: 'close' | 'end', listener: () => void): ShutdownStdin;
}

interface ShutdownProcess {
  exitCode?: number | null | string;
  kill(pid: number, signal: ShutdownSignal): boolean;
  off(event: ShutdownSignal, listener: () => void): ShutdownProcess;
  once(event: ShutdownSignal, listener: () => void): ShutdownProcess;
  pid: number;
  stdin: ShutdownStdin;
}

interface ShutdownDependencies {
  processRef?: ShutdownProcess;
  server: Pick<McpServer, 'close'>;
  watcherManager: Pick<FileWatcherManager, 'stopAll'>;
}

interface ShutdownController {
  register(): void;
  shutdown(reason: ShutdownReason): Promise<void>;
}

interface ShutdownHandlers {
  signalHandlers: Record<ShutdownSignal, () => void>;
  stdinHandlers: Record<'close' | 'end', () => void>;
}

const DEFAULT_TERMINATION_SIGNAL: ShutdownSignal = 'SIGTERM';

export function createStdioShutdownController(
  dependencies: ShutdownDependencies
): ShutdownController {
  const processRef = resolveProcessRef(dependencies.processRef);
  let shutdownPromise: Promise<void> | undefined;
  const signalHandlers = createSignalHandlers(shutdown);
  const stdinHandlers = createStdinHandlers(shutdown);
  const handlers: ShutdownHandlers = { signalHandlers, stdinHandlers };

  function register(): void {
    registerHandlers(processRef, handlers);
  }

  async function shutdown(reason: ShutdownReason): Promise<void> {
    shutdownPromise ??= performShutdown(dependencies, processRef, reason, handlers);
    await shutdownPromise;
  }

  return { register, shutdown };
}

export function registerStdioShutdown(dependencies: ShutdownDependencies): void {
  createStdioShutdownController(dependencies).register();
}

function createSignalHandlers(
  shutdown: (reason: ShutdownReason) => Promise<void>
): Record<ShutdownSignal, () => void> {
  return {
    SIGINT: () => {
      void shutdown('SIGINT');
    },
    SIGTERM: () => {
      void shutdown('SIGTERM');
    },
  };
}

function createStdinHandlers(
  shutdown: (reason: ShutdownReason) => Promise<void>
): Record<'close' | 'end', () => void> {
  return {
    close: () => {
      void shutdown('stdin-close');
    },
    end: () => {
      void shutdown('stdin-end');
    },
  };
}

function registerHandlers(processRef: ShutdownProcess, handlers: ShutdownHandlers): void {
  processRef.once('SIGINT', handlers.signalHandlers.SIGINT);
  processRef.once('SIGTERM', handlers.signalHandlers.SIGTERM);
  processRef.stdin.once('close', handlers.stdinHandlers.close);
  processRef.stdin.once('end', handlers.stdinHandlers.end);
}

async function performShutdown(
  dependencies: ShutdownDependencies,
  processRef: ShutdownProcess,
  reason: ShutdownReason,
  handlers: ShutdownHandlers
): Promise<void> {
  unregisterHandlers(processRef, handlers);
  const failures = await closeResources(dependencies);
  processRef.exitCode = failures.length > 0 ? 1 : 0;
  emitFailures(failures, reason);
  terminateProcess(processRef, reason);
}

function unregisterHandlers(processRef: ShutdownProcess, handlers: ShutdownHandlers): void {
  processRef.off('SIGINT', handlers.signalHandlers.SIGINT);
  processRef.off('SIGTERM', handlers.signalHandlers.SIGTERM);
  processRef.stdin.off('close', handlers.stdinHandlers.close);
  processRef.stdin.off('end', handlers.stdinHandlers.end);
}

async function closeResources(dependencies: ShutdownDependencies): Promise<Error[]> {
  const results = await Promise.allSettled([
    dependencies.server.close(),
    dependencies.watcherManager.stopAll(),
  ]);
  const failures: Error[] = [];

  for (const result of results) {
    const failure = collectFailure(result);
    if (failure) {
      failures.push(failure);
    }
  }

  return failures;
}

function collectFailure(result: PromiseSettledResult<void>): Error | undefined {
  if (result.status === 'fulfilled') {
    return undefined;
  }

  return result.reason instanceof Error ? result.reason : new Error(String(result.reason));
}

function emitFailures(failures: Error[], reason: ShutdownReason): void {
  for (const error of failures) {
    logger.error({ err: error, reason }, 'Error during MCP shutdown');
  }
}

function terminateProcess(processRef: ShutdownProcess, reason: ShutdownReason): void {
  processRef.kill(processRef.pid, resolveTerminationSignal(reason));
}

function resolveTerminationSignal(reason: ShutdownReason): ShutdownSignal {
  return reason === 'SIGINT' || reason === 'SIGTERM' ? reason : DEFAULT_TERMINATION_SIGNAL;
}

function resolveProcessRef(processRef: ShutdownProcess | undefined): ShutdownProcess {
  return (processRef ?? process) as ShutdownProcess;
}
