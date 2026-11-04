import type {
  ApiError,
  CreateWithdrawalRequest,
  ItemResponse,
  ListResponse,
  Transaction,
  User,
  UserDetails,
} from '@circle-wallet/shared';

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiRequestError(0, 'network_error', `Бэкенд недоступен (${API_URL})`);
  }
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
  listTransactions: (id: string) =>
    call<ListResponse<Transaction>>(`/api/users/${id}/transactions`).then((r) => r.data),
  withdraw: (id: string, req: CreateWithdrawalRequest) =>
    call<ItemResponse<Transaction>>(`/api/users/${id}/withdrawals`, {
      method: 'POST',
      body: JSON.stringify(req),
    }).then((r) => r.data),
  sync: (id: string) =>
    call<ItemResponse<{ updated: number }>>(`/api/users/${id}/sync`, { method: 'POST' }).then((r) => r.data),
};

export const queryKeys = {
  users: ['users'] as const,
  user: (id: string) => ['users', id] as const,
  transactions: (id: string) => ['users', id, 'transactions'] as const,
};
