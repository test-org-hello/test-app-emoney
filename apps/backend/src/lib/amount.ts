/**
 * Amounts travel as decimal strings end to end (API, Circle, Postgres numeric)
 * so we never touch floating point. Postgres stores unconstrained `numeric`
 * (exact, any precision); the precision rule lives here: at most `decimals`
 * significant fractional digits, as defined by the token.
 */
import type { ParseAmountResult } from './amount.types.js';

const DECIMAL_RE = /^(0|[1-9]\d*)(\.\d+)?$/;

export function parseAmount(value: string, decimals: number): ParseAmountResult {
  const v = value.trim();
  if (!DECIMAL_RE.test(v)) {
    return { ok: false, error: 'format', reason: 'Amount must be a positive decimal number, e.g. 1.5' };
  }

  const [int = '0', rawFraction = ''] = v.split('.');
  // Trailing zeros carry no value: "1.500000000" is 1.5 even for a 6-decimals token.
  const fraction = rawFraction.replace(/0+$/, '');
  if (fraction.length > decimals) {
    return { ok: false, error: 'decimals', reason: `Amount has more than ${decimals} decimal places` };
  }
  if (int === '0' && fraction === '') {
    return { ok: false, error: 'zero', reason: 'Amount must be greater than zero' };
  }

  return { ok: true, value: fraction ? `${int}.${fraction}` : int };
}

export const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
