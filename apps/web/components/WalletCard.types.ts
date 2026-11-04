export interface WalletCardProps {
  userId: string;
  /** Called when the user no longer exists (e.g. stale ?user= in the URL). */
  onMissing: () => void;
}
