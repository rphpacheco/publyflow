// Postgres deadlock (two transactions locking the same pair of `users` rows
// in opposite orders). changeEmail locks in ascending id order, but the
// access actions lock the creator's user and then, if a concurrent transfer
// moved it, the new one -- a rare race can still produce one, and it must
// surface as a retryable 409 rather than an uncaught 500.
export function isDeadlockError(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
  return code === "40P01";
}

export const DEADLOCK_MESSAGE = "Não foi possível salvar agora. Tente novamente.";
