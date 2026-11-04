import { createApp } from './app.js';
import type { AppDeps, ContainerOptions } from './app.types.js';
import { CircleClient } from './circle/client.js';
import { WebhookSignatureVerifier } from './circle/webhookSignature.js';
import type { Config } from './config.types.js';
import { supabaseAuthVerifier } from './lib/auth.js';
import { Db } from './lib/db.js';
import type { Logger } from './lib/logger.types.js';
import { LedgerService } from './services/ledger.js';
import { Reconciler } from './services/reconciler.js';
import { TokenService } from './services/tokens.js';
import { UserService } from './services/users.js';
import { WithdrawalService } from './services/withdrawals.js';

/** Wires all services together. Tests can swap the Circle API (`fetchImpl`) and the auth check. */
export function buildContainer(
  config: Config,
  log: Logger,
  opts: ContainerOptions = {},
) {
  const db = new Db(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
  const circle = new CircleClient({
    baseUrl: config.CIRCLE_BASE_URL,
    apiKey: config.CIRCLE_API_KEY,
    entitySecret: config.CIRCLE_ENTITY_SECRET,
    fetchImpl: opts.fetchImpl,
  });
  const tokens = new TokenService(db, circle);
  const users = new UserService(db, circle, config, log);
  const ledger = new LedgerService(db, tokens, log);
  const withdrawals = new WithdrawalService(db, circle, users, ledger, log);
  const reconciler = new Reconciler(db, circle, ledger, withdrawals, log);
  const verifier = new WebhookSignatureVerifier((keyId) => circle.getNotificationPublicKey(keyId));

  const deps: AppDeps = {
    db,
    circle,
    users,
    ledger,
    withdrawals,
    reconciler,
    verifier,
    authVerifier: opts.authVerifier ?? supabaseAuthVerifier(db.client),
    log,
    corsOrigin: config.CORS_ORIGIN,
    verifyWebhookSignature: config.CIRCLE_WEBHOOK_VERIFY_SIGNATURE,
  };
  return { ...deps, app: createApp(deps) };
}
