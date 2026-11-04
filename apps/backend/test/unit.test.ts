import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseAmount } from '../src/lib/amount.js';
import { WebhookSignatureVerifier } from '../src/circle/webhookSignature.js';

describe('parseAmount', () => {
  it.each([
    ['1', '1'],
    ['1.5', '1.5'],
    ['1.500000', '1.5'],
    ['100.00', '100'],
    ['0.000001', '0.000001'],
    [' 2.25 ', '2.25'],
  ])('accepts %s -> %s', (input, out) => {
    expect(parseAmount(input, 6)).toEqual({ ok: true, value: out });
  });

  it.each(['0', '0.000', '-1', '1e5', 'abc', '01', '.5', '1.', '0.0000001'])('rejects %s', (input) => {
    expect(parseAmount(input, 6).ok).toBe(false);
  });
});

describe('WebhookSignatureVerifier', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const der = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  let fetches = 0;
  const verifier = new WebhookSignatureVerifier(async () => {
    fetches++;
    return { publicKey: der };
  });
  const body = Buffer.from('{"notificationId":"1"}');
  const sig = sign('sha256', body, privateKey).toString('base64');

  it('accepts a valid signature and caches the key', async () => {
    expect(await verifier.verify(body, sig, 'k1')).toBe(true);
    expect(await verifier.verify(body, sig, 'k1')).toBe(true);
    expect(fetches).toBe(1);
  });

  it('rejects tampered body, garbage or missing headers', async () => {
    expect(await verifier.verify(Buffer.from('{"notificationId":"2"}'), sig, 'k1')).toBe(false);
    expect(await verifier.verify(body, 'bm9wZQ==', 'k1')).toBe(false);
    expect(await verifier.verify(body, undefined, 'k1')).toBe(false);
    expect(await verifier.verify(body, sig, undefined)).toBe(false);
  });
});
