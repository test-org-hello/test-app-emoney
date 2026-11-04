/**
 * Public API contract between the backend and the web app.
 * Only types live here, so the package never has to be built.
 */

export type TransactionDirection = 'deposit' | 'withdrawal';

/** Our own, simplified lifecycle. The raw Circle state is exposed separately. */
export type TransactionStatus = 'pending' | 'completed' | 'failed';

export type CircleTransactionState =
  | 'INITIATED'
  | 'CLEARED'
  | 'QUEUED'
  | 'SENT'
  | 'STUCK'
  | 'CONFIRMED'
  | 'COMPLETE'
  | 'FAILED'
  | 'DENIED'
  | 'CANCELLED';

export interface Token {
  id: string;
  symbol: string;
  name: string | null;
  decimals: number;
  tokenAddress: string | null;
  blockchain: string;
}

export interface User {
  id: string;
  name: string;
  /** Deposit address of the user's Circle wallet. */
  address: string;
  blockchain: string;
  circleWalletId: string;
  createdAt: string;
}

export interface Balance {
  token: Token;
  /** Spendable now: completed deposits minus non-failed withdrawals. Decimal string. */
  available: string;
  /** Deposits seen by Circle but not yet COMPLETE. Decimal string. */
  incoming: string;
  /** Withdrawals that are reserved but not final yet. Decimal string. */
  outgoing: string;
}

export interface Transaction {
  id: string;
  userId: string;
  direction: TransactionDirection;
  status: TransactionStatus;
  circleState: CircleTransactionState | null;
  circleTransactionId: string | null;
  token: Token;
  amount: string;
  sourceAddress: string | null;
  destinationAddress: string | null;
  txHash: string | null;
  explorerUrl: string | null;
  errorReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserDetails extends User {
  balances: Balance[];
}

export interface CreateUserRequest {
  name: string;
}

export interface CreateWithdrawalRequest {
  tokenId: string;
  destinationAddress: string;
  /** Decimal string, e.g. "1.25". */
  amount: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ListResponse<T> {
  data: T[];
}

export interface ItemResponse<T> {
  data: T;
}
