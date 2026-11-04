import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';

/**
 * Untyped Supabase client: rows are described by the interfaces below instead of
 * generated schema types, because amounts are read as text (`numeric::text`).
 */
export type DbClient = SupabaseClient;
import type { Transaction, TransactionDirection } from '@circle-wallet/shared';

/** Any Supabase query/rpc response; `data` is typed by the caller of `check<T>()`. */
export interface PostgrestResult {
  data: unknown;
  error: PostgrestError | null;
}

/** Row shapes as returned by the SQL views / tables (see supabase/migrations). */
export interface UserRow {
  id: string;
  name: string;
  circle_wallet_id: string;
  address: string;
  blockchain: string;
  created_at: string;
}

export interface TokenRow {
  id: string;
  symbol: string;
  name: string | null;
  decimals: number;
  token_address: string | null;
  blockchain: string;
}

export interface TransactionApiRow {
  id: string;
  user_id: string;
  direction: TransactionDirection;
  status: Transaction['status'];
  circle_state: Transaction['circleState'];
  circle_tx_id: string | null;
  amount: string;
  source_address: string | null;
  destination_address: string | null;
  tx_hash: string | null;
  error_reason: string | null;
  created_at: string;
  updated_at: string;
  token: TokenRow;
}

export interface BalanceApiRow {
  user_id: string;
  token_id: string;
  available: string;
  incoming: string;
  outgoing: string;
  token: TokenRow;
}

/** `transactions` row joined with the owner's wallet id (amount cast to text in SQL). */
export interface UnsubmittedWithdrawalRow {
  id: string;
  user_id: string;
  token_id: string;
  amount: string;
  destination_address: string;
  submit_attempts: number;
  created_at: string;
  users: { circle_wallet_id: string };
}

export interface InsertUserInput {
  id: string;
  name: string;
  circleWalletId: string;
  address: string;
  blockchain: string;
}

export interface CreateWithdrawalInput {
  userId: string;
  tokenId: string;
  amount: string;
  destination: string;
}

export interface ApplyCircleTxInput {
  userId: string;
  direction: TransactionDirection;
  circleTxId: string;
  state: string;
  tokenId: string;
  amount: string;
  source: string | null;
  destination: string | null;
  txHash: string | null;
  error: string | null;
  refId: string | null;
}

export interface PendingWithdrawal {
  id: string;
  userId: string;
  walletId: string;
  tokenId: string;
  amount: string;
  destination: string;
  submitAttempts: number;
  createdAt: string;
}

export interface PendingCircleTxRow {
  circle_tx_id: string;
}

export interface WebhookProcessedRow {
  processed_at: string | null;
}
