export class InvalidOpportunityPartyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOpportunityPartyError";
  }
}

// Thrown by CommercialInquiryService.discard/markFalsePositive/resolve when
// the inquiry id does not resolve to a row in the caller's organization.
export class InquiryNotFoundError extends Error {
  constructor(inquiryId: string) {
    super(`Commercial inquiry ${inquiryId} not found`);
    this.name = "InquiryNotFoundError";
  }
}

// Thrown by CommercialInquiryService.discard/markFalsePositive/resolve when
// the inquiry is already in a terminal status (DISCARDED, FALSE_POSITIVE,
// CONVERTED) — those lifecycle transitions are one-way per spec §3, and
// acting on an already-resolved inquiry again (e.g. calling /convert twice)
// must not silently duplicate Leads/Opportunities or re-link status fields.
export class InquiryAlreadyResolvedError extends Error {
  constructor(inquiryId: string, status: string) {
    super(`Commercial inquiry ${inquiryId} is already resolved (status: ${status})`);
    this.name = "InquiryAlreadyResolvedError";
  }
}

// Thrown when an opportunityId does not resolve to a row visible to the
// caller's organization — used by the detail route and by
// OpportunityService.changeStage (Task 7).
export class OpportunityNotFoundError extends Error {
  constructor(opportunityId: string) {
    super(`Opportunity ${opportunityId} not found`);
    this.name = "OpportunityNotFoundError";
  }
}

// Thrown by CommercialInquiryService.resolve (via resolvePartyIdFromGuess)
// when a company/brand guess matches more than one existing row by exact
// name -- companies.name/brands.name have no uniqueness constraint, so this
// can genuinely happen. Rather than arbitrarily picking one (which could
// silently link the inquiry to the wrong company), resolve() refuses and
// the caller must resolve the ambiguity explicitly (e.g. by passing an
// explicit companyId/brandId instead of relying on the guess).
export class AmbiguousPartyGuessError extends Error {
  constructor(guess: string) {
    super(`Multiple companies/brands match the name "${guess}" — cannot resolve automatically`);
    this.name = "AmbiguousPartyGuessError";
  }
}
