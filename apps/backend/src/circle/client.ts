import { constants, publicEncrypt, randomUUID } from 'node:crypto';
import type {
  CircleClientOptions,
  CircleEnvelope,
  CircleErrorBody,
  EntityPublicKeyResponse,
  TokenResponse,
  TransactionResponse,
  TransactionsResponse,
  WalletSetResponse,
  WalletsResponse,
  CircleNotificationPublicKey,
  CircleRequestInit,
  CircleToken,
  CircleTransaction,
  CircleWallet,
  CreateTransferParams,
  CreateTransferResult,
  CreateWalletParams,
  ListTransactionsQuery,
} from './circle.types.js';

/**
 * Thin typed client for the parts of the Circle Developer-Controlled Wallets
 * API this app needs. Plain fetch on purpose: the base URL comes from
 * CIRCLE_BASE_URL, every request/response is visible, and there is no SDK
 * magic around idempotency keys (we choose them ourselves so retries are safe).
 */

export class CircleApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | string | undefined,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'CircleApiError';
  }

  /** 4xx other than rate limiting / conflicts: retrying the same request will not help. */
  get isPermanent(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 409 && this.status !== 429;
  }
}

export class CircleClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private entityPublicKey?: Promise<string>;

  constructor(private readonly opts: CircleClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  // -- low level -------------------------------------------------------------

  async request<T>(method: string, path: string, init: CircleRequestInit = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(init.query ?? {})) {
      if (v !== undefined && v !== '') {
        url.searchParams.set(k, String(v));
      }
    }

    const res = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Request-Id': randomUUID(),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = text;
    }

    if (!res.ok) {
      const err = (json ?? {}) as CircleErrorBody;
      throw new CircleApiError(
        res.status,
        err.code,
        `Circle ${method} ${path} failed with ${res.status}: ${err.message ?? text ?? res.statusText}`,
        json,
      );
    }
    return (json as CircleEnvelope<T>).data;
  }

  /**
   * Every mutating Developer-Controlled Wallets call needs a fresh ciphertext
   * of the entity secret, RSA-OAEP(SHA-256) encrypted with Circle's public key.
   */
  async entitySecretCiphertext(): Promise<string> {
    this.entityPublicKey ??= this.request<EntityPublicKeyResponse>('GET', '/v1/w3s/config/entity/publicKey')
      .then((d) => d.publicKey)
      .catch((e) => {
        this.entityPublicKey = undefined;
        throw e;
      });
    const publicKey = await this.entityPublicKey;
    return encryptEntitySecret(this.opts.entitySecret, publicKey);
  }

  // -- wallets ---------------------------------------------------------------

  async createWalletSet(name: string, idempotencyKey: string = randomUUID()) {
    const data = await this.request<WalletSetResponse>('POST', '/v1/w3s/developer/walletSets', {
      body: { idempotencyKey, name, entitySecretCiphertext: await this.entitySecretCiphertext() },
    });
    return data.walletSet;
  }

  async createWallet(params: CreateWalletParams): Promise<CircleWallet> {
    const data = await this.request<WalletsResponse>('POST', '/v1/w3s/developer/wallets', {
      body: {
        idempotencyKey: params.idempotencyKey,
        entitySecretCiphertext: await this.entitySecretCiphertext(),
        walletSetId: params.walletSetId,
        blockchains: [params.blockchain],
        accountType: params.accountType,
        count: 1,
        metadata: [{ name: params.name, refId: params.refId }],
      },
    });
    const wallet = data.wallets[0];
    if (!wallet) {
      throw new Error('Circle returned no wallet');
    }
    return wallet;
  }

  // -- transactions ----------------------------------------------------------

  async createTransfer(params: CreateTransferParams): Promise<CreateTransferResult> {
    return this.request<CreateTransferResult>('POST', '/v1/w3s/developer/transactions/transfer', {
      body: {
        idempotencyKey: params.idempotencyKey,
        entitySecretCiphertext: await this.entitySecretCiphertext(),
        walletId: params.walletId,
        tokenId: params.tokenId,
        destinationAddress: params.destinationAddress,
        amounts: [params.amount],
        feeLevel: params.feeLevel ?? 'MEDIUM',
        refId: params.refId,
      },
    });
  }

  async getTransaction(id: string): Promise<CircleTransaction> {
    const data = await this.request<TransactionResponse>('GET', `/v1/w3s/transactions/${encodeURIComponent(id)}`);
    return data.transaction;
  }

  /** Iterates over all pages (max page size is 50). */
  async *listTransactions(query: ListTransactionsQuery): AsyncGenerator<CircleTransaction> {
    let pageAfter: string | undefined;
    for (;;) {
      const data = await this.request<TransactionsResponse>('GET', '/v1/w3s/transactions', {
        query: {
          walletIds: query.walletIds?.join(','),
          txType: query.txType,
          from: query.from,
          refId: query.refId,
          blockchain: query.blockchain,
          order: 'ASC',
          pageSize: 50,
          pageAfter,
        },
      });
      const txs = data.transactions ?? [];
      yield* txs;
      if (txs.length < 50) {
        return;
      }
      pageAfter = txs[txs.length - 1]!.id;
    }
  }

  async getToken(id: string): Promise<CircleToken> {
    const data = await this.request<TokenResponse>('GET', `/v1/w3s/tokens/${encodeURIComponent(id)}`);
    return data.token;
  }

  // -- notifications ---------------------------------------------------------

  async getNotificationPublicKey(keyId: string): Promise<CircleNotificationPublicKey> {
    return this.request<CircleNotificationPublicKey>('GET', `/v2/notifications/publicKey/${encodeURIComponent(keyId)}`);
  }
}

export function encryptEntitySecret(entitySecretHex: string, publicKeyPem: string): string {
  return publicEncrypt(
    { key: publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(entitySecretHex, 'hex'),
  ).toString('base64');
}
