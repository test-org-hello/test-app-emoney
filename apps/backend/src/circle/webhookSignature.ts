import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import type { NotificationPublicKeyFetcher } from './circle.types.js';

/**
 * Verifies Circle webhook signatures.
 *
 * Circle signs the raw request body with ECDSA/SHA-256 and sends
 *   X-Circle-Signature: base64 signature
 *   X-Circle-Key-Id:    id of the signing key
 * The public key (base64 DER/SPKI) is served at GET /v2/notifications/publicKey/{keyId}.
 * Keys are immutable per id, so they are cached forever.
 */
export class WebhookSignatureVerifier {
  private readonly cache = new Map<string, Promise<KeyObject>>();

  constructor(private readonly fetchPublicKey: NotificationPublicKeyFetcher) {}

  async verify(rawBody: Buffer, signatureB64: string | undefined, keyId: string | undefined): Promise<boolean> {
    if (!signatureB64 || !keyId) {
      return false;
    }

    let key = this.cache.get(keyId);
    if (!key) {
      key = this.fetchPublicKey(keyId).then(({ publicKey }) =>
        createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' }),
      );
      this.cache.set(keyId, key);
      key.catch(() => this.cache.delete(keyId));
    }

    // A failure to fetch the key propagates (-> 5xx, Circle retries later);
    // only a bad signature yields `false`.
    const publicKey = await key;
    try {
      return verify('sha256', rawBody, publicKey, Buffer.from(signatureB64, 'base64'));
    } catch {
      return false;
    }
  }
}
