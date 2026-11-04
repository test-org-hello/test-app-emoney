/**
 * Amounts travel as decimal strings end to end (API, Circle, Postgres numeric)
 * so we never touch floating point.
 */
const DECIMAL_RE = /^(0|[1-9]\d{0,19})(\.\d+)?$/;

export function parseAmount(value: string, decimals: number): { ok: true; value: string } | { ok: false; reason: string } {
  const v = value.trim();
  if (!DECIMAL_RE.test(v)) return { ok: false, reason: 'Amount must be a positive decimal number, e.g. 1.5' };

  const fraction = v.split('.')[1] ?? '';
  if (fraction.length > decimals) {
    return { ok: false, reason: `Amount has more than ${decimals} decimal places` };
  }
  if (/^0(\.0*)?$/.test(v)) return { ok: false, reason: 'Amount must be greater than zero' };

  // Normalise: drop trailing zeros of the fraction.
  const normalised = fraction ? `${v.split('.')[0]}.${fraction}`.replace(/\.?0+$/, '') : v;
  return { ok: true, value: normalised };
}

export const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
