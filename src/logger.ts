import pino from 'pino';

function createLogger() {
  const isDev = process.env['NODE_ENV'] !== 'production';
  return pino({
    level: process.env['LOG_LEVEL'] ?? 'info',
    transport: isDev
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
    base: { service: 'semantic-code-index' },
  });
}

export const logger = createLogger();
export type Logger = typeof logger;
