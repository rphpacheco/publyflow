export class InvalidOpportunityPartyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOpportunityPartyError";
  }
}
