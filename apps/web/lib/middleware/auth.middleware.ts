import type { FetchMiddleware } from '../http.types';
import { supabase } from '../supabase';

/**
 * Adds the Supabase access token to every API request and drops the local
 * session when the backend answers 401 (expired/revoked) - the AuthGate then
 * shows the login form. `getSession()` refreshes an expired token itself.
 */
export const authMiddleware: FetchMiddleware = async (url, init, next) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await next(url, { ...init, headers });
  if (res.status === 401) await supabase.auth.signOut({ scope: 'local' });
  return res;
};
