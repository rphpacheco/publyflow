// Thrown when a creatorId does not resolve to a row visible to the
// caller's organization — either it doesn't exist at all, or it belongs
// to another organization. Postgres FK constraints bypass RLS, so without
// an explicit check, a caller could pass a foreign org's creatorId and
// have the FK happily accept it (e.g. InboxService.ingestManualMessage,
// ServiceService.create, RateCardService.create all accept a
// caller-supplied creatorId with no prior organization membership).
export class CreatorNotFoundError extends Error {
  constructor(creatorId: string) {
    super(`Creator ${creatorId} not found`);
    this.name = "CreatorNotFoundError";
  }
}
