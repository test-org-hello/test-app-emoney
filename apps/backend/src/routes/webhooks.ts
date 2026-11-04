import express, { Router } from 'express';
import type { CircleClient } from '../circle/client.js';
import type { WebhookSignatureVerifier } from '../circle/webhookSignature.js';
import type { Db } from '../lib/db.js';
import type { Logger } from '../lib/logger.js';
import type { LedgerService } from '../services/ledger.js';

interface CircleNotification {
  subscriptionId?: string;
  notificationId?: string;
  notificationType?: string;
  notification?: { id?: string } & Record<string, unknown>;
  timestamp?: string;
  version?: number;
}

/**
 * POST /webhooks/circle
 *  1. verify the ECDSA signature over the raw body;
 *  2. dedupe by notificationId (Circle delivers at least once);
 *  3. for transactions.* re-read the transaction from the Circle API and apply
 *     that snapshot: the API is authoritative and the newest state wins even
 *     if notifications arrive out of order.
 * Any failure returns 5xx so Circle retries; the reconciler is a second net.
 */
export function webhooksRouter(deps: {
  db: Db;
  circle: CircleClient;
  ledger: LedgerService;
  verifier: WebhookSignatureVerifier;
  verifySignature: boolean;
  log: Logger;
}): Router {
  const r = Router();

  // Circle validates the endpoint URL with HEAD when a subscription is created.
  r.head('/circle', (_req, res) => void res.sendStatus(200));
  r.get('/circle', (_req, res) => void res.json({ ok: true }));

  r.post('/circle', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');

    if (deps.verifySignature) {
      const ok = await deps.verifier.verify(raw, req.header('x-circle-signature'), req.header('x-circle-key-id'));
      if (!ok) {
        deps.log.warn({ keyId: req.header('x-circle-key-id') }, 'webhook signature invalid');
        res.status(401).json({ error: { code: 'invalid_signature', message: 'Invalid signature' } });
        return;
      }
    }

    let payload: CircleNotification;
    try {
      payload = JSON.parse(raw.toString('utf8')) as CircleNotification;
    } catch {
      res.status(400).json({ error: { code: 'bad_request', message: 'Body is not JSON' } });
      return;
    }

    const type = payload.notificationType ?? 'unknown';
    const notificationId = payload.notificationId;
    deps.log.info({ type, notificationId, circleTxId: payload.notification?.id }, 'webhook received');

    if (!notificationId) {
      // e.g. the test ping sent when the subscription is created
      res.sendStatus(200);
      return;
    }

    const isNew = await deps.db.recordWebhook(notificationId, type, payload);
    if (!isNew) {
      res.sendStatus(200);
      return;
    }

    try {
      if (type.startsWith('transactions.') && payload.notification?.id) {
        const tx = await deps.circle.getTransaction(payload.notification.id);
        await deps.ledger.apply(tx);
      }
      await deps.db.markWebhook(notificationId, null);
      res.sendStatus(200);
    } catch (e) {
      const message = (e as Error).message;
      deps.log.error({ err: e, notificationId }, 'webhook processing failed');
      await deps.db.markWebhook(notificationId, message).catch(() => undefined);
      res.status(500).json({ error: { code: 'processing_failed', message: 'Will be retried' } });
    }
  });

  return r;
}
