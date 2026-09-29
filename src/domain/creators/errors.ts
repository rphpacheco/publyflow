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

export class CreatorEmailTakenError extends Error {
  constructor() {
    super("Já existe um creator com este e-mail.");
    this.name = "CreatorEmailTakenError";
  }
}

export const ACCESS_ERRORS = {
  otherOrganization: "Este e-mail já tem acesso a outra organização.",
  team: "Esta pessoa já faz parte da equipe.",
  notInvited: "Este creator ainda não foi convidado.",
} as const;

export class CreatorAccessConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreatorAccessConflictError";
  }
}
