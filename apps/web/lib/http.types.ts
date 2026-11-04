/** Final step of the chain: actually performs the request. */
export type FetchHandler = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Client-side request middleware for calls to the backend API. Each middleware
 * may change the request, call `next`, and inspect or replace the response.
 */
export type FetchMiddleware = (url: string, init: RequestInit, next: FetchHandler) => Promise<Response>;
