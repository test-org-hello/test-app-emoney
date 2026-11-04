import type { CircleClient } from '../circle/client.js';
import type { WebhookSignatureVerifier } from '../circle/webhookSignature.js';
import type { Db } from '../lib/db.js';
import type { Logger } from '../lib/logger.types.js';
import type { LedgerService } from '../services/ledger.js';
import type { Reconciler } from '../services/reconciler.js';
import type { UserService } from '../services/users.js';
import type { WithdrawalService } from '../services/withdrawals.js';

export interface UsersRouterDeps {
  db: Db;
  users: UserService;
  withdrawals: WithdrawalService;
  reconciler: Reconciler;
}

export interface WebhooksRouterDeps {
  db: Db;
  circle: CircleClient;
  ledger: LedgerService;
  verifier: WebhookSignatureVerifier;
  verifySignature: boolean;
  log: Logger;
}
