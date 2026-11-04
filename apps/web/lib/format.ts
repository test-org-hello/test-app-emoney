export const shortAddress = (a: string | null | undefined, size = 6) =>
  a ? `${a.slice(0, size + 2)}…${a.slice(-size + 2)}` : '—';

/** Date/time in the UI language, in the viewer's time zone. */
export const formatDate = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'medium' });

export const FAUCET_URL = 'https://faucet.circle.com';

export const addressExplorerUrl = (blockchain: string, address: string) =>
  blockchain === 'BASE-SEPOLIA' ? `https://sepolia.basescan.org/address/${address}` : null;
