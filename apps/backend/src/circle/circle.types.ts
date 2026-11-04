import type { CircleTransactionState } from '@circle-wallet/shared';

/** Types of the Circle Developer-Controlled Wallets API used by this app. */

export type CircleBlockchainTxType = 'INBOUND' | 'OUTBOUND';
export type CircleAccountType = 'SCA' | 'EOA';
export type CircleFeeLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface CircleWallet {
  id: string;
  address: string;
  blockchain: string;
  state: string;
  walletSetId: string;
  accountType?: string;
  refId?: string;
  name?: string;
}

export interface CircleTransaction {
  id: string;
  state: CircleTransactionState;
  blockchain: string;
  transactionType: CircleBlockchainTxType;
  walletId?: string;
  tokenId?: string;
  amounts?: string[];
  sourceAddress?: string;
  destinationAddress?: string;
  txHash?: string;
  refId?: string;
  errorReason?: string;
  operation?: string;
  createDate: string;
  updateDate: string;
}

export interface CircleToken {
  id: string;
  blockchain: string;
  tokenAddress?: string;
  standard?: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  isNative?: boolean;
}

export interface CircleNotificationPublicKey {
  id: string;
  algorithm: string;
  publicKey: string;
  createDate: string;
}

/** Webhook delivery envelope (notifications v2). */
export interface CircleNotification {
  subscriptionId?: string;
  notificationId?: string;
  notificationType?: string;
  notification?: { id?: string } & Record<string, unknown>;
  timestamp?: string;
  version?: number;
}

export interface CircleClientOptions {
  baseUrl: string;
  apiKey: string;
  entitySecret: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export type CircleQuery = Record<string, string | number | undefined>;

export interface CircleRequestInit {
  query?: CircleQuery;
  body?: unknown;
}

export interface CreateWalletParams {
  walletSetId: string;
  blockchain: string;
  accountType: CircleAccountType;
  idempotencyKey: string;
  name?: string;
  refId?: string;
}

export interface CreateTransferParams {
  /** Must be a UUID v4; repeating it returns the original transaction. */
  idempotencyKey: string;
  walletId: string;
  tokenId: string;
  destinationAddress: string;
  amount: string;
  refId?: string;
  feeLevel?: CircleFeeLevel;
}

export interface CreateTransferResult {
  id: string;
  state: CircleTransactionState;
}

export interface ListTransactionsQuery {
  walletIds?: string[];
  txType?: CircleBlockchainTxType;
  from?: string;
  refId?: string;
  blockchain?: string;
}

/** Loads the webhook signing key (base64 DER/SPKI) by key id. */
export type NotificationPublicKeyFetcher = (keyId: string) => Promise<Pick<CircleNotificationPublicKey, 'publicKey'>>;

// -- response bodies (`data` of the Circle envelope) ---------------------------

export interface CircleEnvelope<T> {
  data: T;
}

export interface CircleErrorBody {
  code?: number | string;
  message?: string;
}

export interface EntityPublicKeyResponse {
  publicKey: string;
}

export interface EntitySecretRegistrationResponse {
  recoveryFile?: string;
}

export interface WalletSetResponse {
  walletSet: { id: string };
}

export interface WalletsResponse {
  wallets: CircleWallet[];
}

export interface TransactionResponse {
  transaction: CircleTransaction;
}

export interface TransactionsResponse {
  transactions: CircleTransaction[];
}

export interface TokenResponse {
  token: CircleToken;
}

export interface NotificationSubscription {
  id: string;
  endpoint: string;
  enabled: boolean;
}
