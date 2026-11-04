import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js';
import type { Balance, Token, Transaction, User } from '@circle-wallet/shared';
import type {
  ApplyCircleTxInput,
  BalanceApiRow,
  CreateWithdrawalInput,
  InsertUserInput,
  PendingCircleTxRow,
  PendingWithdrawal,
  PostgrestResult,
  TokenRow,
  TransactionApiRow,
  UnsubmittedWithdrawalRow,
  UserRow,
  WebhookProcessedRow,
} from './db.types.js';
import { explorerTxUrl } from './explorer.js';

export class DbError extends Error {
  constructor(readonly pg: PostgrestError) {
    super(pg.message);
    this.name = 'DbError';
  }
}

function check<T>(res: PostgrestResult<T>): T {
  if (res.error) throw new DbError(res.error);
  return res.data;
}

const toToken = (r: TokenRow): Token => ({
  id: r.id,
  symbol: r.symbol,
  name: r.name,
  decimals: r.decimals,
  tokenAddress: r.token_address,
  blockchain: r.blockchain,
});

const toUser = (r: UserRow): User => ({
  id: r.id,
  name: r.name,
  address: r.address,
  blockchain: r.blockchain,
  circleWalletId: r.circle_wallet_id,
  createdAt: r.created_at,
});

const toTransaction = (r: TransactionApiRow): Transaction => ({
  id: r.id,
  userId: r.user_id,
  direction: r.direction,
  status: r.status,
  circleState: r.circle_state,
  circleTransactionId: r.circle_tx_id,
  token: toToken(r.token),
  amount: r.amount,
  sourceAddress: r.source_address,
  destinationAddress: r.destination_address,
  txHash: r.tx_hash,
  explorerUrl: explorerTxUrl(r.token.blockchain, r.tx_hash),
  errorReason: r.error_reason,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toBalance = (r: BalanceApiRow): Balance => ({
  token: toToken(r.token),
  available: r.available,
  incoming: r.incoming,
  outgoing: r.outgoing,
});

/** All database access of the backend. */
export class Db {
  readonly client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  // -- settings --------------------------------------------------------------

  async getSetting(key: string): Promise<string | null> {
    const row = check(await this.client.from('app_settings').select('value').eq('key', key).maybeSingle());
    return row?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    check(await this.client.from('app_settings').upsert({ key, value, updated_at: new Date().toISOString() }));
  }

  async setSettingIfAbsent(key: string, value: string): Promise<string> {
    check(
      await this.client
        .from('app_settings')
        .upsert({ key, value }, { onConflict: 'key', ignoreDuplicates: true }),
    );
    return (await this.getSetting(key)) ?? value;
  }

  // -- users -----------------------------------------------------------------

  async listUsers(): Promise<User[]> {
    const rows = check(await this.client.from('users').select('*').order('created_at', { ascending: true }));
    return (rows as UserRow[]).map(toUser);
  }

  async getUser(id: string): Promise<User | null> {
    const row = check(await this.client.from('users').select('*').eq('id', id).maybeSingle());
    return row ? toUser(row as UserRow) : null;
  }

  async getUserByWalletId(walletId: string): Promise<User | null> {
    const row = check(await this.client.from('users').select('*').eq('circle_wallet_id', walletId).maybeSingle());
    return row ? toUser(row as UserRow) : null;
  }

  async insertUser(u: InsertUserInput): Promise<User> {
    const row = check(
      await this.client
        .from('users')
        .insert({
          id: u.id,
          name: u.name,
          circle_wallet_id: u.circleWalletId,
          address: u.address,
          blockchain: u.blockchain,
        })
        .select('*')
        .single(),
    );
    return toUser(row as UserRow);
  }

  // -- tokens ----------------------------------------------------------------

  async getToken(id: string): Promise<Token | null> {
    const row = check(await this.client.from('tokens').select('*').eq('id', id).maybeSingle());
    return row ? toToken(row as TokenRow) : null;
  }

  async upsertToken(t: Token): Promise<void> {
    check(
      await this.client.from('tokens').upsert(
        {
          id: t.id,
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
          token_address: t.tokenAddress,
          blockchain: t.blockchain,
        },
        { onConflict: 'id' },
      ),
    );
  }

  // -- balances & history ----------------------------------------------------

  async getBalances(userId: string): Promise<Balance[]> {
    const rows = check(await this.client.from('user_balances_api').select('*').eq('user_id', userId));
    return (rows as BalanceApiRow[]).map(toBalance).sort((a, b) => a.token.symbol.localeCompare(b.token.symbol));
  }

  async listTransactions(userId: string, limit = 100): Promise<Transaction[]> {
    const rows = check(
      await this.client
        .from('transactions_api')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit),
    );
    return (rows as TransactionApiRow[]).map(toTransaction);
  }

  // -- ledger writes (all through SQL functions, see migration) --------------

  async createWithdrawal(p: CreateWithdrawalInput): Promise<Transaction> {
    const rows = check(
      await this.client.rpc('create_withdrawal', {
        p_user_id: p.userId,
        p_token_id: p.tokenId,
        p_amount: p.amount,
        p_destination: p.destination,
      }),
    ) as TransactionApiRow[];
    return toTransaction(rows[0]!);
  }

  async applyCircleTransaction(i: ApplyCircleTxInput): Promise<Transaction | null> {
    const rows = check(
      await this.client.rpc('apply_circle_transaction', {
        p_user_id: i.userId,
        p_direction: i.direction,
        p_circle_tx_id: i.circleTxId,
        p_state: i.state,
        p_token_id: i.tokenId,
        p_amount: i.amount,
        p_source: i.source,
        p_destination: i.destination,
        p_tx_hash: i.txHash,
        p_error: i.error,
        p_ref_id: i.refId,
      }),
    ) as TransactionApiRow[];
    return rows[0] ? toTransaction(rows[0]) : null;
  }

  async failWithdrawal(id: string, error: string): Promise<Transaction | null> {
    const rows = check(await this.client.rpc('fail_withdrawal', { p_id: id, p_error: error })) as TransactionApiRow[];
    return rows[0] ? toTransaction(rows[0]) : null;
  }

  async getTransaction(id: string): Promise<Transaction | null> {
    const row = check(await this.client.from('transactions_api').select('*').eq('id', id).maybeSingle());
    return row ? toTransaction(row as TransactionApiRow) : null;
  }

  async incrementSubmitAttempts(id: string, attempts: number): Promise<void> {
    check(await this.client.from('transactions').update({ submit_attempts: attempts }).eq('id', id));
  }

  /** Withdrawals reserved in the ledger but not (provably) accepted by Circle yet. */
  async listUnsubmittedWithdrawals(olderThan: Date): Promise<PendingWithdrawal[]> {
    const rows = check(
      await this.client
        .from('transactions')
        .select('id, user_id, token_id, amount::text, destination_address, submit_attempts, created_at, users!inner(circle_wallet_id)')
        .eq('direction', 'withdrawal')
        .eq('status', 'pending')
        .is('circle_tx_id', null)
        .lt('created_at', olderThan.toISOString())
        .limit(50),
    ) as unknown as UnsubmittedWithdrawalRow[];
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      walletId: r.users.circle_wallet_id,
      tokenId: r.token_id,
      amount: r.amount, // cast to text in SQL: numeric -> JSON number would lose precision
      destination: r.destination_address,
      submitAttempts: r.submit_attempts,
      createdAt: r.created_at,
    }));
  }

  /** Circle ids of transactions that are not final yet. */
  async listPendingCircleTxIds(limit = 100): Promise<string[]> {
    const rows = check(
      await this.client
        .from('transactions')
        .select('circle_tx_id')
        .eq('status', 'pending')
        .not('circle_tx_id', 'is', null)
        .limit(limit),
    ) as PendingCircleTxRow[];
    return [...new Set(rows.map((r) => r.circle_tx_id))];
  }

  // -- webhooks --------------------------------------------------------------

  /** Returns false if this notification was already processed successfully. */
  async recordWebhook(id: string, type: string, payload: unknown): Promise<boolean> {
    check(
      await this.client
        .from('webhook_events')
        .upsert({ notification_id: id, notification_type: type, payload }, { onConflict: 'notification_id', ignoreDuplicates: true }),
    );
    const row = check(
      await this.client.from('webhook_events').select('processed_at').eq('notification_id', id).single(),
    ) as WebhookProcessedRow;
    return row.processed_at === null;
  }

  async markWebhook(id: string, error: string | null): Promise<void> {
    check(
      await this.client
        .from('webhook_events')
        .update(error ? { error } : { processed_at: new Date().toISOString(), error: null })
        .eq('notification_id', id),
    );
  }
}
