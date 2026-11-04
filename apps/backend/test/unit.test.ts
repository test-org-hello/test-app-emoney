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
    ['1.500000000', '1.5'], // trailing zeros are not extra precision
    ['123456789012345678901234567890.5', '123456789012345678901234567890.5'], // no integer-digit cap
    [' 2.25 ', '2.25'],
  ])('accepts %s -> %s', (input, out) => {
    expect(parseAmount(input, 6)).toEqual({ ok: true, value: out });
  });

  it.each([
    ['0', 'zero'],
    ['0.000', 'zero'],
    ['-1', 'format'],
    ['1e5', 'format'],
    ['abc', 'format'],
    ['01', 'format'],
    ['.5', 'format'],
    ['1.', 'format'],
    ['0.0000001', 'decimals'],
  ])('rejects %s (%s)', (input, error) => {
    expect(parseAmount(input, 6)).toMatchObject({ ok: false, error });
  });
});

describe('WebhookSignatureVerifier', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const der = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  let fetches = 0;
  const verifier = new WebhookSignatureVerifier(() => {
    fetches++;
    return Promise.resolve({ publicKey: der });
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
