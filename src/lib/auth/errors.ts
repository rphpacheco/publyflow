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
