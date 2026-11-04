import { pinoHttp } from 'pino-http';
import type { Logger } from '../lib/logger.types.js';

/** Structured request logging; GETs (UI polling) are not logged to keep the output readable. */
export const requestLogger = (logger: Logger) =>
  pinoHttp({ logger, autoLogging: { ignore: (req) => req.method === 'GET' } });
