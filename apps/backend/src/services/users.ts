import { randomUUID } from 'node:crypto';
import type { User, UserDetails } from '@circle-wallet/shared';
import type { CircleClient } from '../circle/client.js';
import type { Db } from '../lib/db.js';
import { notFound } from '../lib/errors.js';
import type { Logger } from '../lib/logger.types.js';
import type { UserServiceConfig } from './users.types.js';

const WALLET_SET_SETTING = 'circle_wallet_set_id';

/**
 * One Circle wallet per user. Its address is the user's deposit address, so an
 * inbound transfer is attributed to a user simply by walletId - no memo/tag
 * matching and no sweeping between wallets.
 */
export class UserService {
  private walletSetId?: Promise<string>;

  constructor(
    private readonly db: Db,
    private readonly circle: CircleClient,
    private readonly config: UserServiceConfig,
    private readonly log: Logger,
  ) {}

  list(): Promise<User[]> {
    return this.db.listUsers();
  }

  async get(id: string): Promise<User> {
    const user = await this.db.getUser(id);
    if (!user) throw notFound('User');
    return user;
  }

  async details(id: string): Promise<UserDetails> {
    const [user, balances] = await Promise.all([this.get(id), this.db.getBalances(id)]);
    return { ...user, balances };
  }

  async create(name: string): Promise<User> {
    const id = randomUUID();
    const walletSetId = await this.getWalletSetId();
    // The user id doubles as Circle's idempotency key and refId: a retried
    // request cannot create a second wallet, and the wallet is traceable back
    // to the user from the Circle console.
    const wallet = await this.circle.createWallet({
      walletSetId,
      blockchain: this.config.CIRCLE_BLOCKCHAIN,
      accountType: this.config.CIRCLE_ACCOUNT_TYPE,
      idempotencyKey: id,
      refId: id,
      name,
    });
    this.log.info({ userId: id, walletId: wallet.id, address: wallet.address }, 'circle wallet created');

    return this.db.insertUser({
      id,
      name,
      circleWalletId: wallet.id,
      address: wallet.address,
      blockchain: wallet.blockchain,
    });
  }

  private getWalletSetId(): Promise<string> {
    if (this.config.CIRCLE_WALLET_SET_ID) return Promise.resolve(this.config.CIRCLE_WALLET_SET_ID);
    this.walletSetId ??= this.resolveWalletSetId().catch((e) => {
      this.walletSetId = undefined;
      throw e;
    });
    return this.walletSetId;
  }

  private async resolveWalletSetId(): Promise<string> {
    const stored = await this.db.getSetting(WALLET_SET_SETTING);
    if (stored) return stored;
    const set = await this.circle.createWalletSet('circle-wallet-app');
    this.log.info({ walletSetId: set.id }, 'circle wallet set created');
    return this.db.setSettingIfAbsent(WALLET_SET_SETTING, set.id);
  }
}
