import type { CreateWithdrawalRequest, Transaction } from '@circle-wallet/shared';
import { CircleApiError, type CircleClient } from '../circle/client.js';
import { EVM_ADDRESS_RE, parseAmount } from '../lib/amount.js';
import { DbError, type Db, type PendingWithdrawal } from '../lib/db.js';
import { badRequest, HttpError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import type { LedgerService } from './ledger.js';
import type { UserService } from './users.js';

export const MAX_SUBMIT_ATTEMPTS = 5;

/**
 * Withdrawal = two steps:
 *  1. reserve: `create_withdrawal` checks the balance and inserts a pending
 *     ledger row in one DB transaction (funds are locked from now on);
 *  2. submit: send the transfer to Circle with idempotencyKey = refId = row id.
 * If step 2 fails transiently the row stays pending and the reconciler
 * resubmits it with the same idempotency key, so a transfer is never sent twice.
 * If Circle rejects it permanently (4xx) the row is failed and funds released.
 */
export class WithdrawalService {
  constructor(
    private readonly db: Db,
    private readonly circle: CircleClient,
    private readonly users: UserService,
    private readonly ledger: LedgerService,
    private readonly log: Logger,
  ) {}

  async create(userId: string, req: CreateWithdrawalRequest): Promise<Transaction> {
    const user = await this.users.get(userId);

    const token = await this.db.getToken(req.tokenId);
    if (!token) throw badRequest('Unknown token: deposit it first');

    const amount = parseAmount(req.amount, token.decimals);
    if (!amount.ok) throw badRequest(amount.reason);

    const destination = req.destinationAddress.trim();
    if (!EVM_ADDRESS_RE.test(destination)) throw badRequest('Destination must be an EVM address (0x + 40 hex chars)');
    if (destination.toLowerCase() === user.address.toLowerCase()) {
      throw badRequest('Destination is the user’s own deposit address');
    }

    let tx: Transaction;
    try {
      tx = await this.db.createWithdrawal({ userId, tokenId: token.id, amount: amount.value, destination });
    } catch (e) {
      if (e instanceof DbError && e.message === 'insufficient_funds') {
        throw new HttpError(422, 'insufficient_funds', 'Amount exceeds available balance');
      }
      if (e instanceof DbError && e.message === 'user_not_found') throw new HttpError(404, 'not_found', 'User not found');
      throw e;
    }

    this.log.info({ txId: tx.id, userId, amount: amount.value, token: token.symbol }, 'withdrawal reserved');

    return (
      (await this.submit({
        id: tx.id,
        userId,
        walletId: user.circleWalletId,
        tokenId: token.id,
        amount: amount.value,
        destination,
        submitAttempts: 0,
        createdAt: tx.createdAt,
      })) ?? tx
    );
  }

  /** Sends (or re-sends) a reserved withdrawal to Circle. Safe to call repeatedly. */
  async submit(w: PendingWithdrawal): Promise<Transaction | null> {
    const attempt = w.submitAttempts + 1;
    await this.db.incrementSubmitAttempts(w.id, attempt);

    try {
      const res = await this.circle.createTransfer({
        idempotencyKey: w.id,
        refId: w.id,
        walletId: w.walletId,
        tokenId: w.tokenId,
        destinationAddress: w.destination,
        amount: w.amount,
      });
      this.log.info({ txId: w.id, circleTxId: res.id, state: res.state, attempt }, 'withdrawal submitted to circle');
      // Pull the full snapshot so the ledger row gets circle id/state right away.
      const full = await this.circle.getTransaction(res.id).catch(() => null);
      return (
        (full && (await this.ledger.apply({ ...full, refId: full.refId ?? w.id }))) ??
        (await this.db.getTransaction(w.id))
      );
    } catch (e) {
      if (e instanceof CircleApiError && e.isPermanent) {
        this.log.warn({ txId: w.id, status: e.status, code: e.code, err: e.message }, 'circle rejected withdrawal');
        return this.db.failWithdrawal(w.id, `Rejected by Circle: ${extractMessage(e)}`);
      }
      this.log.error({ txId: w.id, attempt, err: (e as Error).message }, 'withdrawal submit failed, will retry');
      return null;
    }
  }

  /**
   * Retry path used by the reconciler. Before re-sending, look the transfer up
   * by refId: if Circle already has it (e.g. our previous request timed out
   * after Circle accepted it), just adopt it instead of sending again.
   */
  async retry(w: PendingWithdrawal): Promise<void> {
    for await (const tx of this.circle.listTransactions({ refId: w.id, txType: 'OUTBOUND' })) {
      if (tx.walletId === w.walletId) {
        await this.ledger.apply({ ...tx, refId: w.id });
        return;
      }
    }
    if (w.submitAttempts >= MAX_SUBMIT_ATTEMPTS) {
      this.log.warn({ txId: w.id }, 'withdrawal gave up after max submit attempts');
      await this.db.failWithdrawal(w.id, `Could not submit to Circle after ${w.submitAttempts} attempts`);
      return;
    }
    await this.submit(w);
  }
}

function extractMessage(e: CircleApiError): string {
  const body = e.body as { message?: string } | undefined;
  return body?.message ?? e.message;
}
