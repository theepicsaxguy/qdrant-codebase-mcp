import pino, { type Logger as PinoLogger } from 'pino';

function createLogger(): PinoLogger {
  const isDev = process.env['NODE_ENV'] !== 'production';
  const usePrettyTransport = isDev && process.stderr.isTTY;
  // Always write to stderr — stdout is reserved for MCP JSON-RPC protocol messages.
  return pino(
    {
      level: process.env['LOG_LEVEL'] ?? 'info',
      transport: usePrettyTransport
        ? {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard', destination: 2 },
          }
        : undefined,
      base: { service: 'qdrant-codebase-mcp' },
    },
    isDev ? undefined : process.stderr
  );
}

export const logger = createLogger();
export type Logger = typeof logger;
