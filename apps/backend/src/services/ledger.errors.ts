/** A Circle transaction whose amount cannot be recorded exactly for its token. */
export class InvalidCircleAmountError extends Error {
  constructor(
    readonly circleTxId: string,
    readonly amount: string,
    reason: string,
  ) {
    super(`Circle transaction ${circleTxId}: amount "${amount}" rejected: ${reason}`);
    this.name = 'InvalidCircleAmountError';
  }
}
