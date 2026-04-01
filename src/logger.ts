import pino, { type Logger as PinoLogger } from 'pino';

function createLogger(): PinoLogger {
  const isDev = process.env['NODE_ENV'] !== 'production';
  const isVsCode =
    process.env['TERM_PROGRAM'] === 'vscode' || process.env['VSCODE_IPC_HOOK'] !== undefined;
  const usePrettyTransport = isDev && process.stderr.isTTY;
  const destination = pino.destination(2);
  // Always write to stderr — stdout is reserved for MCP JSON-RPC protocol messages.
  return pino(
    {
      level: process.env['LOG_LEVEL'] ?? 'info',
      transport: usePrettyTransport
        ? {
            target: 'pino-pretty',
            options: {
              colorize: !isVsCode,
              translateTime: 'SYS:standard',
              destination: 2,
            },
          }
        : undefined,
      base: { service: 'qdrant-codebase-mcp' },
    },
    destination
  );
}

export const logger = createLogger();
export type Logger = typeof logger;
