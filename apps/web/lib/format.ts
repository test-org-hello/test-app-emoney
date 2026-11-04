export const shortAddress = (a: string | null | undefined, size = 6) =>
  a ? `${a.slice(0, size + 2)}…${a.slice(-size + 2)}` : '—';

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'medium' });

export const FAUCET_URL = 'https://faucet.circle.com';

export const addressExplorerUrl = (blockchain: string, address: string) =>
  blockchain === 'BASE-SEPOLIA' ? `https://sepolia.basescan.org/address/${address}` : null;
