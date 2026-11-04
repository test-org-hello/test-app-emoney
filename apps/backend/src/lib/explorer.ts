const EXPLORERS: Record<string, string> = {
  'BASE-SEPOLIA': 'https://sepolia.basescan.org',
  BASE: 'https://basescan.org',
  'ETH-SEPOLIA': 'https://sepolia.etherscan.io',
  ETH: 'https://etherscan.io',
};

export function explorerTxUrl(blockchain: string, txHash: string | null): string | null {
  const base = EXPLORERS[blockchain];
  return base && txHash ? `${base}/tx/${txHash}` : null;
}
