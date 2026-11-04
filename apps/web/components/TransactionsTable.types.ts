import type { Transaction } from '@circle-wallet/shared';

export interface TransactionsTableProps {
  userId: string;
}

export interface TransactionRowProps {
  tx: Transaction;
}

/** How a ledger status is shown in the table. */
export interface StatusBadge {
  color: string;
  /** Key in the `history` messages namespace. */
  labelKey: 'statusPending' | 'statusCompleted' | 'statusFailed';
}
