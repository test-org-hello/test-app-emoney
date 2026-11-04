import type {
  ApiError,
  CreateWithdrawalRequest,
  ItemResponse,
  ListResponse,
  PageResponse,
  SyncResult,
  Transaction,
  User,
  UserDetails,
} from '@circle-wallet/shared';
import { ApiRequestError } from './api-error';
import type { FetchHandler, FetchMiddleware } from './http.types';
import { jsonMiddleware } from './middleware/json.middleware';
import { networkMiddleware } from './middleware/network.middleware';

export { ApiRequestError };

export const HISTORY_PAGE_SIZE = 50;

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

/** Applied outermost first: network errors wrap everything else. */
const middleware: FetchMiddleware[] = [networkMiddleware, jsonMiddleware];

const send: FetchHandler = middleware.reduceRight<FetchHandler>(
  (next, mw) => (url, init) => mw(url, init, next),
  (url, init) => fetch(url, init),
);

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await send(`${API_URL}${path}`, init);
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (body as ApiError | null)?.error;
    throw new ApiRequestError(res.status, err?.code ?? 'unknown', err?.message ?? res.statusText);
  }
  return body as T;
}

export const api = {
  listUsers: () => call<ListResponse<User>>('/api/users').then((r) => r.data),
  createUser: (name: string) =>
    call<ItemResponse<User>>('/api/users', { method: 'POST', body: JSON.stringify({ name }) }).then((r) => r.data),
  getUser: (id: string) => call<ItemResponse<UserDetails>>(`/api/users/${id}`).then((r) => r.data),
  /** One page of history, newest first; pass the previous page's `nextCursor` for the next one. */
  listTransactions: (id: string, cursor?: string | null, limit = HISTORY_PAGE_SIZE) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) {
      params.set('cursor', cursor);
    }
    return call<PageResponse<Transaction>>(`/api/users/${id}/transactions?${params.toString()}`);
  },
  /** Repeating a call with the same `idempotencyKey` returns the first withdrawal instead of creating another. */
  withdraw: (id: string, req: CreateWithdrawalRequest, idempotencyKey: string) =>
    call<ItemResponse<Transaction>>(`/api/users/${id}/withdrawals`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(req),
    }).then((r) => r.data),
  sync: (id: string) => call<ItemResponse<SyncResult>>(`/api/users/${id}/sync`, { method: 'POST' }).then((r) => r.data),
};

export const queryKeys = {
  users: ['users'] as const,
  user: (id: string) => ['users', id] as const,
  /** Prefix of every history query of a user (invalidate this one). */
  transactions: (id: string) => ['users', id, 'transactions'] as const,
  /** Paginated history table (infinite query). */
  history: (id: string) => ['users', id, 'transactions', 'history'] as const,
  /** Newest page only (deposit dialog). */
  latest: (id: string) => ['users', id, 'transactions', 'latest'] as const,
};
