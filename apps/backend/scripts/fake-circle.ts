/**
 * Local mock of the Circle API for development without a Circle account.
 *
 *   pnpm --filter @circle-wallet/backend circle:fake     # listens on :4010
 *
 * In apps/backend/.env set
 *   CIRCLE_BASE_URL=http://localhost:4010
 *   CIRCLE_ENTITY_SECRET=abab...ab (64 chars, the value printed on start)
 *
 * It implements the endpoints the backend uses, signs webhooks with its own
 * ECDSA key (served at /v2/notifications/publicKey/{id}) and posts them to
 * WEBHOOK_URL (default http://localhost:4000/webhooks/circle). Outbound
 * transfers progress INITIATED -> SENT -> COMPLETE automatically (amount 13.13
 * fails, to demo the failure path). Deposits are simulated with:
 *
 *   curl -X POST localhost:4010/_fake/deposit -H 'content-type: application/json' \
 *        -d '{"address":"0x...","amount":"25"}'
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { FakeCircle } from '../test/fakeCircle.js';
import type { CircleTransaction } from '../src/circle/circle.types.js';
import type { FakeDepositRequest } from '../test/fakeCircle.types.js';

const PORT = Number(process.env.FAKE_CIRCLE_PORT ?? 4010);
const WEBHOOK_URL = process.env.WEBHOOK_URL ?? 'http://localhost:4000/webhooks/circle';
const circle = new FakeCircle();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hash = () => '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

async function notify(tx: CircleTransaction) {
  const wh = circle.webhook(tx);
  const res = await fetch(WEBHOOK_URL, { method: 'POST', headers: wh.headers, body: wh.body }).catch((e: Error) => e);
  console.log(`webhook ${tx.transactionType} ${tx.state} -> ${res instanceof Error ? res.message : res.status}`);
}

async function progress(id: string, states: CircleTransaction['state'][]) {
  for (const s of states) {
    await sleep(3000);
    const extra: Partial<CircleTransaction> =
      s === 'SENT' ? { txHash: hash() } : s === 'FAILED' ? { errorReason: 'FAKE_FAILURE' } : {};
    await notify(circle.setState(id, s, extra));
  }
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const chunks: Buffer[] = [];
  for await (const c of req) {
    chunks.push(c as Buffer);
  }
  const body = Buffer.concat(chunks).toString();

  if (req.method === 'POST' && req.url === '/_fake/deposit') {
    const { address, amount } = JSON.parse(body || '{}') as FakeDepositRequest;
    const wallet = [...circle.wallets.values()].find((w) => w.address.toLowerCase() === address?.toLowerCase());
    if (!wallet || !amount) {
      res.writeHead(400).end('unknown address or missing amount');
      return;
    }
    const tx = circle.addTx({
      walletId: wallet.id,
      transactionType: 'INBOUND',
      state: 'CONFIRMED',
      amounts: [amount],
      sourceAddress: '0x' + 'f'.repeat(40),
      destinationAddress: wallet.address,
      txHash: hash(),
    });
    await notify(tx);
    void progress(tx.id, ['COMPLETE']);
    res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify(tx));
    return;
  }

  const response = await circle
    .fetch(`http://localhost:${PORT}${req.url}`, { method: req.method, body: body || undefined })
    .catch((e: Error) => new Response(JSON.stringify({ code: 400, message: e.message }), { status: 400 }));

  if (req.method === 'POST' && req.url === '/v1/w3s/developer/transactions/transfer' && response.status === 201) {
    const { data } = (await response.clone().json()) as { data: { id: string } };
    const tx = circle.txs.get(data.id)!;
    void progress(data.id, tx.amounts?.[0] === '13.13' ? ['QUEUED', 'FAILED'] : ['QUEUED', 'SENT', 'COMPLETE']);
  }

  res.writeHead(response.status, { 'content-type': 'application/json' }).end(await response.text());
}

const server = createServer((req, res) => {
  void handle(req, res).catch((e: unknown) => {
    console.error(e);
    res.writeHead(500).end();
  });
});

server.listen(PORT, () => {
  console.log(`fake Circle on http://localhost:${PORT}, webhooks -> ${WEBHOOK_URL}`);
  console.log(`CIRCLE_ENTITY_SECRET=${circle.entitySecret}`);
});
