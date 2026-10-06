export class AiNotConfiguredError extends Error {
  constructor(missing: string) {
    super(`AI provider not configured: ${missing} is missing`);
    this.name = "AiNotConfiguredError";
  }
}
