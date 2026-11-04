import type { CircleTransaction } from '../src/circle/circle.types.js';

/** Fields a test must give when adding a transaction to the fake Circle; the rest gets defaults. */
export type FakeTxInput = Partial<CircleTransaction> & Pick<CircleTransaction, 'walletId' | 'transactionType' | 'state'>;

/** A webhook delivery as Circle sends it: raw JSON body + signature headers. */
export interface SignedWebhook {
  body: string;
  headers: Record<string, string>;
}
