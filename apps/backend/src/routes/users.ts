import { Router } from 'express';
import { z } from 'zod';
import type { UsersRouterDeps } from './routes.types.js';
import type { ItemResponse, ListResponse, SyncResult, Transaction, User, UserDetails } from '@circle-wallet/shared';

const createUserBody = z.object({ name: z.string().trim().min(1).max(100) });
const withdrawalBody = z.object({
  tokenId: z.string().min(1),
  destinationAddress: z.string().min(1),
  amount: z.string().min(1),
});
const userIdParam = z.object({ id: z.uuid() });

export function usersRouter(deps: UsersRouterDeps): Router {
  const r = Router();

  r.get('/', async (_req, res) => {
    const body: ListResponse<User> = { data: await deps.users.list() };
    res.json(body);
  });

  r.post('/', async (req, res) => {
    const { name } = createUserBody.parse(req.body);
    const body: ItemResponse<User> = { data: await deps.users.create(name) };
    res.status(201).json(body);
  });

  r.get('/:id', async (req, res) => {
    const { id } = userIdParam.parse(req.params);
    const body: ItemResponse<UserDetails> = { data: await deps.users.details(id) };
    res.json(body);
  });

  r.get('/:id/transactions', async (req, res) => {
    const { id } = userIdParam.parse(req.params);
    await deps.users.get(id);
    const body: ListResponse<Transaction> = { data: await deps.db.listTransactions(id) };
    res.json(body);
  });

  r.post('/:id/withdrawals', async (req, res) => {
    const { id } = userIdParam.parse(req.params);
    const input = withdrawalBody.parse(req.body);
    const body: ItemResponse<Transaction> = { data: await deps.withdrawals.create(id, input) };
    res.status(201).json(body);
  });

  r.post('/:id/sync', async (req, res) => {
    const { id } = userIdParam.parse(req.params);
    const user = await deps.users.get(id);
    const updated = await deps.reconciler.syncWallet(user.circleWalletId);
    const body: ItemResponse<SyncResult> = { data: { updated } };
    res.json(body);
  });

  return r;
}
