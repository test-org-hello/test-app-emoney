import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiError } from '@circle-wallet/shared';
import { CircleApiError } from '../circle/client.js';
import { HttpError } from '../lib/errors.js';

/** 404 for any route that no router handled. Register after all routes. */
export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ApiError = { error: { code: 'not_found', message: 'Route not found' } };
  res.status(404).json(body);
};

/**
 * Maps thrown errors to the `{ error: { code, message } }` API shape.
 * Express 5 forwards rejected async handlers here automatically. Register last.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
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

  if (status >= 500) {
    req.log.error({ err }, 'request failed');
  }
  res.status(status).json(body);
};
