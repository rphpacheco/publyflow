// Thrown when the AI providers could not classify an incoming message. The
// message is not stored, so the user can simply send it again.
export class MessageClassificationError extends Error {
  constructor(cause: unknown) {
    super("Message classification failed", { cause });
    this.name = "MessageClassificationError";
  }
}
