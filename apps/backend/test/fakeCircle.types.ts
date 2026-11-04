import type { CircleTransaction } from '../src/circle/circle.types.js';

/** Fields a test must give when adding a transaction to the fake Circle; the rest gets defaults. */
export type FakeTxInput = Partial<CircleTransaction> &
  Pick<CircleTransaction, 'walletId' | 'transactionType' | 'state'>;

/** A webhook delivery as Circle sends it: raw JSON body + signature headers. */
export interface SignedWebhook {
  body: string;
  headers: Record<string, string>;
}

/** Union of the JSON bodies the backend sends to the Circle endpoints the fake implements. */
export interface FakeRequestBody {
  idempotencyKey?: string;
  entitySecretCiphertext?: string;
  // wallets
  walletSetId?: string;
  blockchains?: string[];
  accountType?: string;
  metadata?: { name?: string; refId?: string }[];
  // transfers
  walletId?: string;
  tokenId?: string;
  destinationAddress?: string;
  amounts?: string[];
  refId?: string;
}

/** Body of POST /_fake/deposit on the local mock server (scripts/fake-circle.ts). */
export interface FakeDepositRequest {
  address?: string;
  amount?: string;
}
