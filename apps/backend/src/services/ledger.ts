import type { Transaction } from '@circle-wallet/shared';
import type { CircleTransaction } from '../circle/circle.types.js';
import type { Db } from '../lib/db.js';
import type { Logger } from '../lib/logger.types.js';
import type { TokenService } from './tokens.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Applies Circle transaction snapshots to our ledger. Webhooks and the
 * reconciler both end up here, and the SQL function behind it is idempotent
 * and order-independent, so the same snapshot may be applied any number of
 * times from any source.
 */
export class LedgerService {
  constructor(
    private readonly db: Db,
    private readonly tokens: TokenService,
    private readonly log: Logger,
  ) {}

  async apply(tx: CircleTransaction): Promise<Transaction | null> {
    if (tx.operation && tx.operation !== 'TRANSFER') return null;
    if (!tx.walletId || !tx.tokenId || !tx.amounts?.[0]) {
      this.log.debug({ circleTxId: tx.id }, 'skip circle tx without wallet/token/amount');
      return null;
    }

    const user = await this.db.getUserByWalletId(tx.walletId);
    if (!user) {
      this.log.debug({ circleTxId: tx.id, walletId: tx.walletId }, 'skip circle tx of unknown wallet');
      return null;
    }

    await this.tokens.ensure(tx.tokenId);

    const result = await this.db.applyCircleTransaction({
      userId: user.id,
      direction: tx.transactionType === 'INBOUND' ? 'deposit' : 'withdrawal',
      circleTxId: tx.id,
      state: tx.state,
      tokenId: tx.tokenId,
      amount: tx.amounts[0],
      source: tx.sourceAddress ?? null,
      destination: tx.destinationAddress ?? null,
      txHash: tx.txHash || null,
      error: tx.errorReason ?? null,
      refId: tx.refId && UUID_RE.test(tx.refId) ? tx.refId : null,
    });

    if (result) {
      this.log.info(
        { txId: result.id, circleTxId: tx.id, state: tx.state, status: result.status, direction: result.direction },
        'ledger updated from circle',
      );
    }
    return result;
  }
}
