import { ApiRequestError } from '../api-error';
import type { FetchMiddleware } from '../http.types';

/** Turns a failed connection (backend down, CORS, offline) into a readable ApiRequestError. */
export const networkMiddleware: FetchMiddleware = async (url, init, next) => {
  try {
    return await next(url, init);
  } catch {
    throw new ApiRequestError(0, 'network_error', `Бэкенд недоступен (${new URL(url).origin})`);
  }
};
