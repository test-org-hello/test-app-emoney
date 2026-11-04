import type { FetchMiddleware } from '../http.types';

/** JSON request bodies: sets Content-Type unless the caller already did. */
export const jsonMiddleware: FetchMiddleware = (url, init, next) => {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return next(url, { ...init, headers });
};
