import type { RequestHandler } from 'express';
import type { ApiError } from '@circle-wallet/shared';
import type { AuthVerifier } from '../lib/auth.types.js';

/**
 * Requires `Authorization: Bearer <Supabase access token>`.
 * Valid token: the user is exposed as `res.locals.authUser`.
 * Missing/invalid token: 401 and the request stops here.
 */
export function requireAuth(verify: AuthVerifier): RequestHandler {
  return async (req, res, next) => {
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const user = token ? await verify(token) : null;

    if (!user) {
      const body: ApiError = { error: { code: 'unauthorized', message: 'Sign in required' } };
      res.status(401).json(body);
      return;
    }
    res.locals.authUser = user;
    // Authenticated responses must not be reused from the browser/HTTP cache.
    res.set('Cache-Control', 'no-store');
    req.log?.setBindings?.({ authUserId: user.id });
    next();
  };
}
