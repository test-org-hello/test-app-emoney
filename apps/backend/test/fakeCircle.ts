import { generateKeyPairSync, privateDecrypt, constants, randomUUID, sign } from 'node:crypto';
import type { CircleTransaction, CircleWallet } from '../src/circle/circle.types.js';
import type { FakeRequestBody, FakeTxInput, SignedWebhook } from './fakeCircle.types.js';

/**
 * In-memory stand-in for the Circle API, used as `fetchImpl` of CircleClient.
 * It implements just enough of the endpoints the backend calls, checks that
 * every mutating call carries a decryptable entity secret ciphertext, and can
 * sign webhook payloads like Circle does.
 */
export class FakeCircle {
  readonly entitySecret = 'ab'.repeat(32);
  readonly usdc = {
    id: randomUUID(),
    blockchain: 'BASE-SEPOLIA',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  };

  readonly wallets = new Map<string, CircleWallet>();
  readonly txs = new Map<string, CircleTransaction>();
  readonly transferRequests: FakeRequestBody[] = [];
  private readonly idempotency = new Map<string, unknown>();

  private readonly rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  private readonly ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  readonly keyId = randomUUID();

  /** When set, the next transfer request fails with this HTTP status. */
  failNextTransferWith?: number;

  fetch: typeof fetch = (input, init) => {
    try {
      return Promise.resolve(this.handle(input, init));
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  };

  private handle(input: string | URL | Request, init: RequestInit | undefined): Response {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init?.method ?? 'GET';
    const body: FakeRequestBody = typeof init?.body === 'string' ? (JSON.parse(init.body) as FakeRequestBody) : {};
    const key = body.idempotencyKey ?? '';
    const path = url.pathname;

    if (method === 'GET' && path === '/v1/w3s/config/entity/publicKey') {
      return json(200, { data: { publicKey: this.rsa.publicKey.export({ type: 'spki', format: 'pem' }) } });
    }
    if (method === 'GET' && path === `/v2/notifications/publicKey/${this.keyId}`) {
      const der = this.ec.publicKey.export({ type: 'spki', format: 'der' });
      return json(200, {
        data: {
          id: this.keyId,
          algorithm: 'ECDSA_SHA_256',
          publicKey: der.toString('base64'),
          createDate: new Date().toISOString(),
        },
      });
    }

    if (method === 'POST') this.assertCiphertext(body.entitySecretCiphertext);

    if (method === 'POST' && path === '/v1/w3s/developer/walletSets') {
      return json(201, { data: { walletSet: { id: randomUUID() } } });
    }
    if (method === 'POST' && path === '/v1/w3s/developer/wallets') {
      const cached = this.idempotency.get(key);
      if (cached) return json(200, cached);
      const wallet: CircleWallet = {
        id: randomUUID(),
        address: '0x' + randomUUID().replace(/-/g, '').padEnd(40, '0').slice(0, 40),
        blockchain: body.blockchains?.[0] ?? 'BASE-SEPOLIA',
        state: 'LIVE',
        walletSetId: body.walletSetId ?? '',
        accountType: body.accountType,
        refId: body.metadata?.[0]?.refId,
      };
      this.wallets.set(wallet.id, wallet);
      const res = { data: { wallets: [wallet] } };
      this.idempotency.set(key, res);
      return json(201, res);
    }
    if (method === 'POST' && path === '/v1/w3s/developer/transactions/transfer') {
      this.transferRequests.push(body);
      if (this.failNextTransferWith) {
        const status = this.failNextTransferWith;
        this.failNextTransferWith = undefined;
        return json(status, { code: 155201, message: 'simulated failure' });
      }
      const cached = this.idempotency.get(key);
      if (cached) return json(200, cached);
      const wallet = this.wallets.get(body.walletId ?? '');
      if (!wallet) return json(404, { code: 404, message: 'wallet not found' });
      const tx = this.addTx({
        walletId: wallet.id,
        transactionType: 'OUTBOUND',
        state: 'INITIATED',
        amounts: body.amounts,
        tokenId: body.tokenId,
        sourceAddress: wallet.address,
        destinationAddress: body.destinationAddress,
        refId: body.refId,
      });
      const res = { data: { id: tx.id, state: tx.state } };
      this.idempotency.set(key, res);
      return json(201, res);
    }
    if (method === 'GET' && path.startsWith('/v1/w3s/transactions/')) {
      const tx = this.txs.get(path.split('/').pop()!);
      return tx ? json(200, { data: { transaction: tx } }) : json(404, { code: 404, message: 'not found' });
    }
    if (method === 'GET' && path === '/v1/w3s/transactions') {
      const walletIds = url.searchParams.get('walletIds')?.split(',');
      const refId = url.searchParams.get('refId');
      const txType = url.searchParams.get('txType');
      const list = [...this.txs.values()].filter(
        (t) =>
          (!walletIds || walletIds.includes(t.walletId!)) &&
          (!refId || t.refId === refId) &&
          (!txType || t.transactionType === txType),
      );
      return json(200, { data: { transactions: list } });
    }
    if (method === 'GET' && path === `/v1/w3s/tokens/${this.usdc.id}`) {
      return json(200, { data: { token: this.usdc } });
    }
    return json(404, { code: 404, message: `fake circle: no route ${method} ${path}` });
  }

  addTx(p: FakeTxInput): CircleTransaction {
    const now = new Date().toISOString();
    const tx: CircleTransaction = {
      id: randomUUID(),
      blockchain: 'BASE-SEPOLIA',
      operation: 'TRANSFER',
      createDate: now,
      updateDate: now,
      tokenId: this.usdc.id,
      ...p,
    };
    this.txs.set(tx.id, tx);
    return tx;
  }

  setState(id: string, state: CircleTransaction['state'], extra: Partial<CircleTransaction> = {}) {
    const tx = this.txs.get(id)!;
    Object.assign(tx, { state, updateDate: new Date().toISOString() }, extra);
    return tx;
  }

  /** Builds a webhook delivery exactly like Circle: raw JSON body + ECDSA signature headers. */
  webhook(tx: CircleTransaction, notificationId: string = randomUUID()): SignedWebhook {
    const body = JSON.stringify({
      subscriptionId: randomUUID(),
      notificationId,
      notificationType: tx.transactionType === 'INBOUND' ? 'transactions.inbound' : 'transactions.outbound',
      notification: { ...tx },
      timestamp: new Date().toISOString(),
      version: 2,
    });
    const signature = sign('sha256', Buffer.from(body), this.ec.privateKey).toString('base64');
    return {
      body,
      headers: { 'X-Circle-Signature': signature, 'X-Circle-Key-Id': this.keyId, 'Content-Type': 'application/json' },
    };
  }

  private assertCiphertext(ciphertext: string | undefined) {
    if (!ciphertext) throw new Error('fake circle: missing entitySecretCiphertext');
    const plain = privateDecrypt(
      { key: this.rsa.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(ciphertext, 'base64'),
    ).toString('hex');
    if (plain !== this.entitySecret) throw new Error('fake circle: wrong entity secret');
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
