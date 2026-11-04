import type { User } from '@circle-wallet/shared';

export interface DepositModalProps {
  user: User;
  opened: boolean;
  onClose: () => void;
}
