import type { CircleClient } from './circle/client.js';
import type { WebhookSignatureVerifier } from './circle/webhookSignature.js';
import type { AuthVerifier } from './lib/auth.types.js';
import type { Db } from './lib/db.js';
import type { Logger } from './lib/logger.types.js';
import type { LedgerService } from './services/ledger.js';
import type { Reconciler } from './services/reconciler.js';
import type { UserService } from './services/users.js';
import type { WithdrawalService } from './services/withdrawals.js';

export interface AppDeps {
  db: Db;
  circle: CircleClient;
  users: UserService;
  ledger: LedgerService;
  withdrawals: WithdrawalService;
  reconciler: Reconciler;
  verifier: WebhookSignatureVerifier;
  /** Resolves Supabase Auth access tokens; every /api route requires one. */
  authVerifier: AuthVerifier;
  log: Logger;
  corsOrigin: string;
  verifyWebhookSignature: boolean;
}

export interface ContainerOptions {
  /** Replaces the Circle API transport (tests, mocks). */
  fetchImpl?: typeof fetch;
  /** Replaces the Supabase token check (tests). */
  authVerifier?: AuthVerifier;
}
