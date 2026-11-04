/**
 * One-time setup of the Circle Entity Secret.
 *
 *   pnpm --filter @circle-wallet/backend circle:entity-secret
 *
 * - uses CIRCLE_ENTITY_SECRET from .env if present, otherwise generates a new
 *   random 32-byte secret;
 * - registers its ciphertext with Circle (POST /v1/w3s/config/entity/entitySecret);
 * - writes the recovery file next to this package (git-ignored).
 * Needs CIRCLE_BASE_URL and CIRCLE_API_KEY. An entity can register a secret
 * only once - rotate/reset it in the Circle console if needed.
 */
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EntitySecretRegistrationResponse } from '../src/circle/circle.types.js';
import { CircleClient } from '../src/circle/client.js';

const baseUrl = process.env.CIRCLE_BASE_URL;
const apiKey = process.env.CIRCLE_API_KEY;
if (!baseUrl || !apiKey) {
  console.error('Set CIRCLE_BASE_URL and CIRCLE_API_KEY in apps/backend/.env first.');
  process.exit(1);
}

const existing = process.env.CIRCLE_ENTITY_SECRET;
if (existing && /^(ab)+$/i.test(existing)) {
  console.error('CIRCLE_ENTITY_SECRET is the fake-circle mock value. Clear it in .env so a real one is generated.');
  process.exit(1);
}
console.log(`Circle API: ${baseUrl}`);
const entitySecret = existing && /^[0-9a-f]{64}$/i.test(existing) ? existing : randomBytes(32).toString('hex');

const circle = new CircleClient({ baseUrl, apiKey, entitySecret });

try {
  const data = await circle.request<EntitySecretRegistrationResponse>('POST', '/v1/w3s/config/entity/entitySecret', {
    body: { entitySecretCiphertext: await circle.entitySecretCiphertext() },
  });
  if (data?.recoveryFile) {
    const file = resolve(import.meta.dirname, `../recovery_file_${Date.now()}.dat`);
    writeFileSync(file, data.recoveryFile);
    console.log(`Recovery file saved to ${file} - keep it somewhere safe.`);
  }
  console.log('Entity secret registered.');
} catch (e) {
  const err = e as Error & { cause?: { code?: string; message?: string } };
  const cause = err.cause ? ` (${err.cause.code ?? err.cause.message})` : '';
  console.error(`Registration failed: ${err.message}${cause}`);
  if (err.message === 'fetch failed') console.error(`Cannot reach ${baseUrl} - check CIRCLE_BASE_URL and network.`);
  if (existing) process.exit(1);
  console.error('(If a secret is already registered for this entity, reuse it or reset it in the Circle console.)');
  process.exit(1);
}

if (!existing) {
  console.log('\nAdd this line to apps/backend/.env:\n');
  console.log(`CIRCLE_ENTITY_SECRET=${entitySecret}\n`);
}
