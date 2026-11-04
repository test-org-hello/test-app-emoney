/**
 * End-to-end flows against a real Supabase (local: `pnpm db:start`) with the
 * Circle API replaced by an in-memory fake. Run with:
 *
 *   TEST_SUPABASE_URL=http://127.0.0.1:54321 TEST_SUPABASE_SERVICE_ROLE_KEY=... pnpm --filter @circle-wallet/backend test
 *
 * Skipped when those variables are not set. The tests may share the database
 * with a dev setup, so they remove everything they created in afterAll.
 */
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiError, ItemResponse, PageResponse, Transaction, User, UserDetails } from '@circle-wallet/shared';
import { loadConfig } from '../src/config.js';
import { buildContainer } from '../src/container.js';
import { FakeCircle } from './fakeCircle.js';
import type { SignedWebhook } from './fakeCircle.types.js';

const url = process.env.TEST_SUPABASE_URL;
const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!url || !key)('wallet flows (Supabase + fake Circle)', () => {
  const circle = new FakeCircle();
  let c: ReturnType<typeof buildContainer>;
  let api: ReturnType<typeof request>;
  let alice: User;
  const external = '0x' + '1'.repeat(40);
  let savedCursor: string | null = null;

  /** supertest bodies are `any`; read them through the API contract types. */
  const dataOf = <T>(res: { body: unknown }) => (res.body as ItemResponse<T>).data;
  const errorOf = (res: { body: unknown }) => (res.body as ApiError).error;

  const details = async (id: string) => dataOf<UserDetails>(await api.get(`/api/users/${id}`).expect(200));
  const history = async (id: string) =>
    dataOf<Transaction[]>(await api.get(`/api/users/${id}/transactions`).expect(200));
  const usdc = (d: UserDetails) => d.balances.find((b) => b.token.symbol === 'USDC');
  const deliver = (wh: SignedWebhook) => api.post('/webhooks/circle').set(wh.headers).send(wh.body);
  const createUser = async (name: string) => dataOf<User>(await api.post('/api/users').send({ name }).expect(201));
  /** Postgres error raised by the ledger guards (supabase-js returns it, it does not throw). */
  const ledgerError = (res: { error: { message: string } | null }) => res.error?.message ?? '';

  beforeAll(async () => {
    const config = loadConfig({
      SUPABASE_URL: url,
      SUPABASE_SERVICE_ROLE_KEY: key,
      CIRCLE_BASE_URL: 'https://circle.fake',
      CIRCLE_API_KEY: 'TEST_API_KEY:x:y',
      CIRCLE_ENTITY_SECRET: circle.entitySecret,
      RECONCILE_INTERVAL_MS: '0',
      // Resubmit right away in tests instead of back-dating rows (the ledger is immutable).
      RECONCILE_RESUBMIT_AFTER_MS: '0',
    });
    c = buildContainer(config, pino({ level: 'silent' }), { fetchImpl: circle.fetch });
    api = request(c.app);
    savedCursor = await c.db.getSetting('reconcile_cursor');
  });

  afterAll(async () => {
    if (!c) {
      return;
    }
    const walletIds = [...circle.wallets.keys()];
    if (walletIds.length) {
      await c.db.client.from('users').delete().in('circle_wallet_id', walletIds);
    }
    await c.db.client.from('tokens').delete().eq('id', circle.usdc.id);
    await c.db.client.from('webhook_events').delete().in('payload->notification->>walletId', walletIds);
    if (savedCursor) {
      await c.db.setSetting('reconcile_cursor', savedCursor);
    } else {
      await c.db.client.from('app_settings').delete().eq('key', 'reconcile_cursor');
    }
  });

  it('creates a user with its own Circle wallet / deposit address', async () => {
    const res = await api.post('/api/users').send({ name: 'Alice' }).expect(201);
    alice = dataOf<User>(res);
    expect(alice.address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(circle.wallets.get(alice.circleWalletId)?.refId).toBe(alice.id);

    const list = dataOf<User[]>(await api.get('/api/users').expect(200));
    expect(list.map((u) => u.id)).toContain(alice.id);
  });

  it('rejects webhooks with a bad signature', async () => {
    const tx = circle.addTx({
      walletId: alice.circleWalletId,
      transactionType: 'INBOUND',
      state: 'COMPLETE',
      amounts: ['1'],
    });
    const wh = circle.webhook(tx);
    await api
      .post('/webhooks/circle')
      .set({ ...wh.headers, 'X-Circle-Signature': 'AAAA' })
      .send(wh.body)
      .expect(401);
    circle.txs.delete(tx.id);
  });

  it('deposit: pending -> completed via webhooks, balance follows, duplicates ignored', async () => {
    const tx = circle.addTx({
      walletId: alice.circleWalletId,
      transactionType: 'INBOUND',
      state: 'CONFIRMED',
      amounts: ['10.5'],
      sourceAddress: external,
      destinationAddress: alice.address,
      txHash: '0x' + 'a'.repeat(64),
    });
    await deliver(circle.webhook(tx)).expect(200);

    let d = await details(alice.id);
    expect(usdc(d)).toMatchObject({ available: '0', incoming: '10.5' });
    expect((await history(alice.id))[0]).toMatchObject({
      direction: 'deposit',
      status: 'pending',
      circleState: 'CONFIRMED',
    });

    circle.setState(tx.id, 'COMPLETE');
    const wh = circle.webhook(tx);
    await deliver(wh).expect(200);
    await deliver(wh).expect(200); // same notificationId again

    d = await details(alice.id);
    expect(usdc(d)).toMatchObject({ available: '10.5', incoming: '0' });
    const h = await history(alice.id);
    expect(h.filter((t) => t.direction === 'deposit')).toHaveLength(1);
    expect(h[0]!.explorerUrl).toBe(`https://sepolia.basescan.org/tx/0x${'a'.repeat(64)}`);
  });

  it('withdrawal: validation and insufficient funds', async () => {
    const tokenId = circle.usdc.id;
    await api
      .post(`/api/users/${alice.id}/withdrawals`)
      .send({ tokenId, destinationAddress: 'nope', amount: '1' })
      .expect(400);
    await api
      .post(`/api/users/${alice.id}/withdrawals`)
      .send({ tokenId, destinationAddress: external, amount: '1.0000001' })
      .expect(400);
    const res = await api
      .post(`/api/users/${alice.id}/withdrawals`)
      .send({ tokenId, destinationAddress: external, amount: '10.6' })
      .expect(422);
    expect(errorOf(res).code).toBe('insufficient_funds');
  });

  it('withdrawal: reserves funds, completes via webhook; late/out-of-order webhook does not regress', async () => {
    const res = await api
      .post(`/api/users/${alice.id}/withdrawals`)
      .send({ tokenId: circle.usdc.id, destinationAddress: external, amount: '3' })
      .expect(201);
    const w = dataOf<Transaction>(res);
    expect(w).toMatchObject({ direction: 'withdrawal', status: 'pending', circleState: 'INITIATED' });
    expect(circle.transferRequests.at(-1)).toMatchObject({ idempotencyKey: w.id, refId: w.id, amounts: ['3'] });

    expect(usdc(await details(alice.id))).toMatchObject({ available: '7.5', outgoing: '3' });

    const ctx = circle.setState(w.circleTransactionId!, 'COMPLETE', { txHash: '0x' + 'b'.repeat(64) });
    await deliver(circle.webhook(ctx)).expect(200);
    // An older state arriving later must not move it back to pending.
    const stale = { ...ctx, state: 'SENT' as const };
    circle.txs.set(stale.id, stale);
    await deliver(circle.webhook(stale)).expect(200);
    circle.txs.set(ctx.id, ctx);

    const after = (await history(alice.id)).find((t) => t.id === w.id)!;
    expect(after).toMatchObject({ status: 'completed', circleState: 'COMPLETE' });
    expect(usdc(await details(alice.id))).toMatchObject({ available: '7.5', outgoing: '0' });
  });

  it('withdrawal: failed on-chain releases the funds', async () => {
    const w = dataOf<Transaction>(
      await api
        .post(`/api/users/${alice.id}/withdrawals`)
        .send({ tokenId: circle.usdc.id, destinationAddress: external, amount: '2' })
        .expect(201),
    );
    expect(usdc(await details(alice.id))!.available).toBe('5.5');

    const ctx = circle.setState(w.circleTransactionId!, 'FAILED', { errorReason: 'INSUFFICIENT_NATIVE_TOKEN' });
    await deliver(circle.webhook(ctx)).expect(200);

    const after = (await history(alice.id)).find((t) => t.id === w.id)!;
    expect(after).toMatchObject({ status: 'failed', errorReason: 'INSUFFICIENT_NATIVE_TOKEN' });
    expect(usdc(await details(alice.id))!.available).toBe('7.5');
  });

  it('withdrawal: permanent Circle rejection fails it immediately', async () => {
    circle.failNextTransferWith = 400;
    const w = dataOf<Transaction>(
      await api
        .post(`/api/users/${alice.id}/withdrawals`)
        .send({ tokenId: circle.usdc.id, destinationAddress: external, amount: '1' })
        .expect(201),
    );
    expect(w.status).toBe('failed');
    expect(w.errorReason).toContain('simulated failure');
    expect(usdc(await details(alice.id))!.available).toBe('7.5');
  });

  it('withdrawal: transient Circle error stays pending and the reconciler resubmits it once', async () => {
    circle.failNextTransferWith = 503;
    const w = dataOf<Transaction>(
      await api
        .post(`/api/users/${alice.id}/withdrawals`)
        .send({ tokenId: circle.usdc.id, destinationAddress: external, amount: '1.5' })
        .expect(201),
    );
    expect(w).toMatchObject({ status: 'pending', circleTransactionId: null });
    expect(usdc(await details(alice.id))!.available).toBe('6');

    await c.reconciler.runOnce();
    await c.reconciler.runOnce(); // second run must not send a second transfer

    const sent = circle.transferRequests.filter((r) => r.idempotencyKey === w.id);
    expect(sent).toHaveLength(2); // the failed attempt + one successful resubmit
    const after = (await history(alice.id)).find((t) => t.id === w.id)!;
    expect(after.circleTransactionId).not.toBeNull();
  });

  it('withdrawal: same Idempotency-Key returns the first withdrawal, reserves and sends once', async () => {
    const before = usdc(await details(alice.id))!.available;
    const req = { tokenId: circle.usdc.id, destinationAddress: external, amount: '0.5' };
    const key = `test-${Date.now()}`;

    const first = await api
      .post(`/api/users/${alice.id}/withdrawals`)
      .set('Idempotency-Key', key)
      .send(req)
      .expect(201);
    const again = await api
      .post(`/api/users/${alice.id}/withdrawals`)
      .set('Idempotency-Key', key)
      .send(req)
      .expect(200);

    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(dataOf<Transaction>(again).id).toBe(dataOf<Transaction>(first).id);
    expect(circle.transferRequests.filter((r) => r.idempotencyKey === dataOf<Transaction>(first).id)).toHaveLength(1);
    expect(Number(usdc(await details(alice.id))!.available)).toBe(Number(before) - 0.5);
  });

  it('withdrawal: parallel requests with one Idempotency-Key create exactly one withdrawal', async () => {
    const before = usdc(await details(alice.id))!.available;
    const req = { tokenId: circle.usdc.id, destinationAddress: external, amount: '0.25' };
    const key = `parallel-${Date.now()}`;

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        api.post(`/api/users/${alice.id}/withdrawals`).set('Idempotency-Key', key).send(req),
      ),
    );

    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(results.map((r) => dataOf<Transaction>(r).id)).size).toBe(1);
    expect(Number(usdc(await details(alice.id))!.available)).toBe(Number(before) - 0.25);
  });

  it('withdrawal: reusing an Idempotency-Key for a different request is rejected', async () => {
    const key = `reuse-${Date.now()}`;
    const base = { tokenId: circle.usdc.id, destinationAddress: external, amount: '0.1' };
    await api.post(`/api/users/${alice.id}/withdrawals`).set('Idempotency-Key', key).send(base).expect(201);

    const res = await api
      .post(`/api/users/${alice.id}/withdrawals`)
      .set('Idempotency-Key', key)
      .send({ ...base, amount: '0.2' })
      .expect(422);
    expect(errorOf(res).code).toBe('idempotency_key_reused');

    await api
      .post(`/api/users/${alice.id}/withdrawals`)
      .set('Idempotency-Key', 'bad key with spaces')
      .send(base)
      .expect(400);
  });

  it('withdrawal: concurrent requests cannot overdraw', async () => {
    const before = Number(usdc(await details(alice.id))!.available); // 6
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        api
          .post(`/api/users/${alice.id}/withdrawals`)
          .send({ tokenId: circle.usdc.id, destinationAddress: external, amount: '2' }),
      ),
    );
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(Math.floor(before / 2));
    expect(results.filter((r) => r.status === 422)).toHaveLength(5 - ok);
    expect(Number(usdc(await details(alice.id))!.available)).toBeGreaterThanOrEqual(0);
  });

  it('reconciler picks up a deposit whose webhook never arrived', async () => {
    const before = usdc(await details(alice.id))!.available;
    circle.addTx({ walletId: alice.circleWalletId, transactionType: 'INBOUND', state: 'COMPLETE', amounts: ['4'] });
    await api.post(`/api/users/${alice.id}/sync`).expect(200);
    expect(Number(usdc(await details(alice.id))!.available)).toBe(Number(before) + 4);
  });

  it('incoming amount is recorded exactly as Circle reports it, even beyond token metadata', async () => {
    // Own user, so alice keeps 6-decimal balances for the following tests.
    const carol = await createUser('Carol');
    // USDC metadata says 6 decimals; Circle is the source of truth for what happened on-chain.
    const tx = circle.addTx({
      walletId: carol.circleWalletId,
      transactionType: 'INBOUND',
      state: 'COMPLETE',
      amounts: ['1.0000001'],
    });
    await deliver(circle.webhook(tx)).expect(200);
    const row = (await history(carol.id)).find((t) => t.circleTransactionId === tx.id)!;
    expect(row.amount).toBe('1.0000001');
    expect(usdc(await details(carol.id))!.available).toBe('1.0000001'); // exact, not rounded
  });

  it('one bad Circle transaction does not block the sync of the others; zero amounts are skipped', async () => {
    const before = usdc(await details(alice.id))!.available;
    const bad = circle.addTx({
      walletId: alice.circleWalletId,
      transactionType: 'INBOUND',
      state: 'COMPLETE',
      amounts: ['not-a-number'],
    });
    const zero = circle.addTx({
      walletId: alice.circleWalletId,
      transactionType: 'INBOUND',
      state: 'COMPLETE',
      amounts: ['0'],
    });
    circle.addTx({ walletId: alice.circleWalletId, transactionType: 'INBOUND', state: 'COMPLETE', amounts: ['3'] });

    await api.post(`/api/users/${alice.id}/sync`).expect(200);

    expect(Number(usdc(await details(alice.id))!.available)).toBe(Number(before) + 3);
    const ids = (await history(alice.id)).map((t) => t.circleTransactionId);
    expect(ids).not.toContain(bad.id);
    expect(ids).not.toContain(zero.id);
    circle.txs.delete(bad.id);
    circle.txs.delete(zero.id);
  });

  it('history: cursor pages return every transaction exactly once, newest first, ties broken by id', async () => {
    const pager = await createUser('Pager');
    // 120 rows with the SAME created_at: only the id tie-breaker keeps pages from skipping or repeating rows.
    const createdAt = new Date().toISOString();
    const seeded = Array.from({ length: 120 }, (_, i) => ({
      user_id: pager.id,
      direction: 'deposit',
      status: 'completed',
      token_id: circle.usdc.id,
      amount: '0.000001',
      circle_tx_id: `page-${Date.now()}-${i}`,
      created_at: createdAt,
    }));
    expect((await c.db.client.from('transactions').insert(seeded)).error).toBeNull();

    expect(await history(pager.id)).toHaveLength(50); // first page (default limit)

    const seen: Transaction[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url = `/api/users/${pager.id}/transactions?limit=50${cursor ? `&cursor=${cursor}` : ''}`;
      const page = (await api.get(url).expect(200)).body as PageResponse<Transaction>;
      seen.push(...page.data);
      cursor = page.nextCursor;
      pages++;
    } while (cursor && pages < 20);

    expect(pages).toBe(3); // 50 + 50 + 20
    expect(seen).toHaveLength(120);
    expect(new Set(seen.map((t) => t.id)).size).toBe(120); // no repeats, no gaps
    for (let i = 1; i < seen.length; i++) {
      const [a, b] = [seen[i - 1]!, seen[i]!];
      expect(a.createdAt > b.createdAt || (a.createdAt === b.createdAt && a.id > b.id)).toBe(true);
    }

    // Boundary: limit == number of rows -> no next page; one less -> there is one.
    const all = (await api.get(`/api/users/${pager.id}/transactions?limit=120`).expect(200))
      .body as PageResponse<Transaction>;
    expect(all.nextCursor).toBeNull();
    const short = (await api.get(`/api/users/${pager.id}/transactions?limit=119`).expect(200))
      .body as PageResponse<Transaction>;
    expect(short.nextCursor).toEqual(expect.any(String));
  });

  it('history: invalid limit or cursor is a 400', async () => {
    await api.get(`/api/users/${alice.id}/transactions?limit=0`).expect(400);
    await api.get(`/api/users/${alice.id}/transactions?limit=201`).expect(400);
    await api.get(`/api/users/${alice.id}/transactions?cursor=not-a-cursor`).expect(400);
  });

  it('ledger is immutable: facts, final status, deletes and direct balance writes are rejected', async () => {
    const before = usdc(await details(alice.id))!.available;
    const completed = (await history(alice.id)).find((t) => t.direction === 'deposit' && t.status === 'completed')!;
    const tx = () => c.db.client.from('transactions');

    expect(ledgerError(await tx().update({ amount: '1000000' }).eq('id', completed.id))).toMatch(/ledger_immutable/);
    expect(
      ledgerError(
        await tx()
          .update({ user_id: (await createUser('Mallory')).id })
          .eq('id', completed.id),
      ),
    ).toMatch(/ledger_immutable/);
    expect(ledgerError(await tx().update({ status: 'pending' }).eq('id', completed.id))).toMatch(/is final/);
    expect(ledgerError(await tx().update({ tx_hash: '0xforged' }).eq('id', completed.id))).toMatch(/is final/);
    expect(ledgerError(await tx().delete().eq('id', completed.id))).toMatch(/cannot be deleted/);
    expect(
      ledgerError(await c.db.client.from('balances').update({ available: '1000000' }).eq('user_id', alice.id)),
    ).toMatch(/cannot be written directly/);

    // Nothing changed.
    expect(usdc(await details(alice.id))!.available).toBe(before);
    expect((await history(alice.id)).find((t) => t.id === completed.id)).toMatchObject({
      amount: completed.amount,
      status: 'completed',
    });
  });

  it('deleting a user removes its ledger and balances (the only allowed delete)', async () => {
    const dave = await createUser('Dave');
    circle.addTx({ walletId: dave.circleWalletId, transactionType: 'INBOUND', state: 'COMPLETE', amounts: ['5'] });
    await api.post(`/api/users/${dave.id}/sync`).expect(200);
    expect(usdc(await details(dave.id))!.available).toBe('5');

    expect((await c.db.client.from('users').delete().eq('id', dave.id)).error).toBeNull();
    const left = await c.db.client
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', dave.id);
    const balances = await c.db.client
      .from('balances')
      .select('user_id', { count: 'exact', head: true })
      .eq('user_id', dave.id);
    expect([left.count, balances.count]).toEqual([0, 0]);
  });

  it('stored balances always equal a full recomputation from the ledger', async () => {
    // Runs last: every scenario above (deposits, reservations, failures, races, rejected tampering) went
    // through the triggers.
    const res = await c.db.client.rpc('balance_drift');
    expect(res.error).toBeNull();
    expect(res.data as unknown[]).toEqual([]);
  });
});
