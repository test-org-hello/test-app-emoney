import express from 'express';
import type { AppDeps } from './app.types.js';
import { corsMiddleware } from './middleware/cors.middleware.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { requestLogger } from './middleware/request-logger.middleware.js';
import { usersRouter } from './routes/users.js';
import { webhooksRouter } from './routes/webhooks.js';

export function createApp(deps: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  // The UI polls these endpoints; always return fresh data instead of ETag/304 revalidation.
  app.set('etag', false);
  app.use(requestLogger(deps.log));

  // Webhooks first: they need the raw body for signature verification (public, signed by Circle).
  app.use(
    '/webhooks',
    webhooksRouter({
      db: deps.db,
      circle: deps.circle,
      ledger: deps.ledger,
      verifier: deps.verifier,
      verifySignature: deps.verifyWebhookSignature,
      log: deps.log,
    }),
  );

  app.use(corsMiddleware(deps.corsOrigin));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => void res.json({ ok: true }));

  app.use('/api/users', usersRouter(deps));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
