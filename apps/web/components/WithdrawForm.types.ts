export interface WithdrawFormProps {
  userId: string;
}

/** Idempotency-Key bound to one withdrawal intent (token + destination + amount). */
export interface WithdrawAttempt {
  intent: string;
  key: string;
}
