import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthUser, AuthVerifier, CachedAuthUser } from './auth.types.js';

const CACHE_TTL_MS = 60_000;

/**
 * Verifies Supabase Auth access tokens by asking Supabase Auth itself
 * (`auth.getUser`). That works the same for legacy HS256 and new asymmetric
 * signing keys and also rejects tokens of signed-out sessions. Results are
 * cached briefly so polling clients do not hit Auth on every request.
 */
export function supabaseAuthVerifier(client: SupabaseClient): AuthVerifier {
  const cache = new Map<string, CachedAuthUser>();

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
