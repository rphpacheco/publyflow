export class UnauthenticatedError extends Error {
  constructor() {
    super("Não autenticado");
    this.name = "UnauthenticatedError";
  }
}
