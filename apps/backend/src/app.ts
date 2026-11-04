import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import { ZodError } from 'zod';
import type { ApiError } from '@circle-wallet/shared';
import { CircleApiError, type CircleClient } from './circle/client.js';
import type { WebhookSignatureVerifier } from './circle/webhookSignature.js';
import { requireAuth, type AuthVerifier } from './lib/auth.js';
import type { Db } from './lib/db.js';
import { HttpError } from './lib/errors.js';
import type { Logger } from './lib/logger.js';
import { usersRouter } from './routes/users.js';
import { webhooksRouter } from './routes/webhooks.js';
import type { LedgerService } from './services/ledger.js';
import type { Reconciler } from './services/reconciler.js';
import type { UserService } from './services/users.js';
import type { WithdrawalService } from './services/withdrawals.js';

export interface AppDeps {
  db: Db;
  circle: CircleClient;
  users: UserService;
  ledger: LedgerService;
  withdrawals: WithdrawalService;
  reconciler: Reconciler;
  verifier: WebhookSignatureVerifier;
  /** Resolves Supabase Auth access tokens; every /api route requires one. */
  authVerifier: AuthVerifier;
  log: Logger;
  corsOrigin: string;
  verifyWebhookSignature: boolean;
}

export function createApp(deps: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  // Responses are per-session and polled; no ETag/304 revalidation from the browser cache.
  app.set('etag', false);
  app.use(pinoHttp({ logger: deps.log, autoLogging: { ignore: (req) => req.method === 'GET' } }));

  // Webhooks first: they need the raw body for signature verification.
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

  app.use(cors({ origin: deps.corsOrigin.split(',').map((s) => s.trim()) }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => void res.json({ ok: true }));
  // Webhooks (signed by Circle) and /health stay public; the app API needs a signed-in user.
  app.use('/api', requireAuth(deps.authVerifier));
  app.get('/api/me', (_req, res) => void res.json({ data: res.locals.authUser }));
  app.use('/api/users', usersRouter(deps));

  app.use((_req, res) => {
    const body: ApiError = { error: { code: 'not_found', message: 'Route not found' } };
    res.status(404).json(body);
  });

  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    let status = 500;
    let body: ApiError = { error: { code: 'internal_error', message: 'Internal server error' } };

    if (err instanceof HttpError) {
      status = err.status;
      body = { error: { code: err.code, message: err.message, details: err.details } };
    } else if (err instanceof ZodError) {
      status = 400;
      body = { error: { code: 'validation_error', message: 'Invalid request', details: err.issues } };
    } else if (err instanceof CircleApiError) {
      status = 502;
      body = { error: { code: 'circle_error', message: err.message } };
    } else if ((err as { type?: string }).type === 'entity.parse.failed') {
      status = 400;
      body = { error: { code: 'bad_request', message: 'Malformed JSON' } };
    }

    if (status >= 500) req.log.error({ err }, 'request failed');
    res.status(status).json(body);
  };
  app.use(onError);

  return app;
}
