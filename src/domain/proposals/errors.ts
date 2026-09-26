// Thrown when a proposalId does not resolve to a row visible to the
// caller's organization.
export class ProposalNotFoundError extends Error {
  constructor(proposalId: string) {
    super(`Proposal ${proposalId} not found`);
    this.name = "ProposalNotFoundError";
  }
}

// Thrown when an opportunityId does not resolve to a row visible to the
// caller's organization — e.g. ProposalService.create with a foreign or
// nonexistent opportunityId.
export class OpportunityNotFoundError extends Error {
  constructor(opportunityId: string) {
    super(`Opportunity ${opportunityId} not found`);
    this.name = "OpportunityNotFoundError";
  }
}

// Thrown when the userId supplied to a mutating endpoint does not resolve
// to an organization_members row for the request's organizationId — a
// userId that is a valid row in `users` but not a member of this
// organization must not be accepted as an author of a proposal_versions
// snapshot.
export class UserNotOrganizationMemberError extends Error {
  constructor(userId: string, organizationId: string) {
    super(`User ${userId} is not a member of organization ${organizationId}`);
    this.name = "UserNotOrganizationMemberError";
  }
}

// Thrown when a proposal_item references a rate_card_item whose Rate
// Card's creator_id does not match the creator_id of the Proposal's
// Opportunity — the per-creator catalog invariant, extended through the
// Proposal -> Opportunity -> Creator chain.
export class RateCardItemCreatorMismatchError extends Error {
  constructor(rateCardItemId: string, opportunityId: string) {
    super(
      `Rate card item ${rateCardItemId} does not belong to the creator of opportunity ${opportunityId}`,
    );
    this.name = "RateCardItemCreatorMismatchError";
  }
}

// Thrown when a proposal_items id does not resolve to a row visible to the
// caller's organization and proposal.
export class ProposalItemNotFoundError extends Error {
  constructor(itemId: string, proposalId: string) {
    super(`Proposal item ${itemId} not found on proposal ${proposalId}`);
    this.name = "ProposalItemNotFoundError";
  }
}

// Thrown when a proposal_blocks id does not resolve to a row visible to
// the caller's organization and proposal.
export class ProposalBlockNotFoundError extends Error {
  constructor(blockId: string, proposalId: string) {
    super(`Proposal block ${blockId} not found on proposal ${proposalId}`);
    this.name = "ProposalBlockNotFoundError";
  }
}

// Sending an archived proposal: it must be unarchived first.
export class ProposalArchivedError extends Error {
  constructor(proposalId: string) {
    super(`Proposal ${proposalId} is archived`);
    this.name = "ProposalArchivedError";
  }
}

// The public link exists but the proposal is DRAFT or ARCHIVED.
export class ProposalUnavailableError extends Error {
  constructor() {
    super("Esta proposta não está mais disponível.");
    this.name = "ProposalUnavailableError";
  }
}

// Unknown or malformed public token.
export class PublicProposalNotFoundError extends Error {
  constructor() {
    super("Proposta não encontrada.");
    this.name = "PublicProposalNotFoundError";
  }
}

// The client answered a publication that is not the proposal's latest
// (old, nonexistent or another proposal's).
export class PublicationSupersededError extends Error {
  readonly code = "SUPERSEDED";
  constructor() {
    super("Esta proposta foi atualizada. Recarregue para ver a versão atual.");
    this.name = "PublicationSupersededError";
  }
}

export class PublicationAlreadyRespondedError extends Error {
  readonly code = "ALREADY_RESPONDED";
  constructor() {
    super("Esta proposta já foi respondida.");
    this.name = "PublicationAlreadyRespondedError";
  }
}

// PATCH may only move to DRAFT from ARCHIVED (unarchive); the commercial
// statuses change only by sending or by the client's response.
export class ProposalStatusTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Proposal status cannot change from ${from} to ${to}`);
    this.name = "ProposalStatusTransitionError";
  }
}
