// Thrown by RateCardItemService.addItem/updateItem/removeItem when the
// parent Rate Card has isLocked === true. Rate Cards become immutable
// once any of their items is copied into a Proposal (per design spec
// Decisão #1) — the lock itself is set by RateCardService.lock(), called
// by the future Proposals subsystem, not by anything in this plan.
export class RateCardLockedError extends Error {
  constructor(rateCardId: string) {
    super(`Rate card ${rateCardId} is locked and cannot be modified`);
    this.name = "RateCardLockedError";
  }
}
