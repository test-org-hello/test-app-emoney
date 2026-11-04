import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestHandler } from 'express';
import type { ApiError } from '@circle-wallet/shared';

export interface AuthUser {
  id: string;
  email: string | null;
}

/** Resolves a bearer token to a user, or null if the token is invalid/expired. */
export type AuthVerifier = (token: string) => Promise<AuthUser | null>;

const CACHE_TTL_MS = 60_000;

/**
 * Verifies Supabase Auth access tokens by asking Supabase Auth itself
 * (`auth.getUser`). That works the same for legacy HS256 and new asymmetric
 * signing keys and also rejects tokens of signed-out sessions. Results are
 * cached briefly so polling clients do not hit Auth on every request.
 */
export function supabaseAuthVerifier(client: SupabaseClient): AuthVerifier {
  const cache = new Map<string, { user: AuthUser; until: number }>();

  return async (token) => {
    const now = Date.now();
    const hit = cache.get(token);
    if (hit && hit.until > now) return hit.user;

    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) {
      cache.delete(token);
      return null;
    }
    const user: AuthUser = { id: data.user.id, email: data.user.email ?? null };

    if (cache.size > 1000) cache.clear();
    cache.set(token, { user, until: now + CACHE_TTL_MS });
    return user;
  };
}

/** Requires `Authorization: Bearer <Supabase access token>`; exposes the user as `res.locals.authUser`. */
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
