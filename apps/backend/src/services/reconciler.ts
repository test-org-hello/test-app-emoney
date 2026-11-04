import type { CircleClient } from '../circle/client.js';
import type { Db } from '../lib/db.js';
import type { Logger } from '../lib/logger.types.js';
import type { LedgerService } from './ledger.js';
import type { WithdrawalService } from './withdrawals.js';

const CURSOR_SETTING = 'reconcile_cursor';
const OVERLAP_MS = 10 * 60_000;
const WALLET_CHUNK = 20;

/**
 * Safety net for webhooks: Circle delivers at least once, but a webhook can
 * still be missed (endpoint down, tunnel not running, subscription not set up
 * yet). Periodically:
 *  1. resubmit withdrawals that never reached Circle;
 *  2. refresh non-final transactions from Circle;
 *  3. pull recent transactions of all user wallets (catches missed deposits).
 * Everything goes through the same idempotent ledger path as webhooks.
 */
export class Reconciler {
  private running = false;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: Db,
    private readonly circle: CircleClient,
    private readonly ledger: LedgerService,
    private readonly withdrawals: WithdrawalService,
    private readonly log: Logger,
  ) {}

  start(intervalMs: number): void {
    if (intervalMs <= 0) {
      return;
    }
    const tick = () => void this.runOnce().catch((e) => this.log.error({ err: e }, 'reconcile failed'));
    this.timer = setInterval(tick, intervalMs);
    this.timer.unref();
    setTimeout(tick, 2_000).unref();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  async runOnce(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.resubmitStuckWithdrawals();
      await this.refreshPending();
      await this.backfill();
    } finally {
      this.running = false;
    }
  }

  /** Full re-sync of a single user's wallet (used by POST /api/users/:id/sync). */
  async syncWallet(walletId: string): Promise<number> {
    let n = 0;
    for await (const tx of this.circle.listTransactions({ walletIds: [walletId] })) {
      if (await this.ledger.apply(tx)) {
        n++;
      }
    }
    return n;
  }

  private async resubmitStuckWithdrawals() {
    const stuck = await this.db.listUnsubmittedWithdrawals(new Date(Date.now() - 20_000));
    for (const w of stuck) {
      await this.withdrawals.retry(w).catch((e) => this.log.error({ err: e, txId: w.id }, 'withdrawal retry failed'));
    }
  }

  private async refreshPending() {
    const ids = await this.db.listPendingCircleTxIds();
    for (const id of ids) {
      try {
        await this.ledger.apply(await this.circle.getTransaction(id));
      } catch (e) {
        this.log.error({ err: e, circleTxId: id }, 'refresh pending failed');
      }
    }
  }

  private async backfill() {
    const startedAt = new Date();
    const cursor = await this.db.getSetting(CURSOR_SETTING);
    const from = cursor ? new Date(new Date(cursor).getTime() - OVERLAP_MS).toISOString() : undefined;

    const users = await this.db.listUsers();
    for (let i = 0; i < users.length; i += WALLET_CHUNK) {
      const walletIds = users.slice(i, i + WALLET_CHUNK).map((u) => u.circleWalletId);
      for await (const tx of this.circle.listTransactions({ walletIds, from })) {
        await this.ledger.apply(tx);
      }
    }

    await this.db.setSetting(CURSOR_SETTING, startedAt.toISOString());
  }
}
