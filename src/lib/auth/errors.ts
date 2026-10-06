import { isAuthRetryableFetchError } from "@supabase/supabase-js";

export class UnauthenticatedError extends Error {
  constructor() {
    super("Não autenticado");
    this.name = "UnauthenticatedError";
  }
}

export class AuthProvisioningError extends Error {
  constructor(public readonly reason: string) {
    super(`Supabase admin call failed: ${reason}`);
    this.name = "AuthProvisioningError";
  }
}

export class AuthUnavailableError extends Error {
  constructor() {
    super("Auth provider unavailable");
    this.name = "AuthUnavailableError";
  }
}

// Network failure or 5xx from Supabase Auth. "No session" / invalid token
// (4xx, AuthSessionMissingError) is NOT a service failure.
export function isAuthServiceFailure(error: unknown): boolean {
  if (!error) return false;
  if (isAuthRetryableFetchError(error)) return true;
  if (error instanceof TypeError) return true; // fetch failed before any response
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && status >= 500;
}
