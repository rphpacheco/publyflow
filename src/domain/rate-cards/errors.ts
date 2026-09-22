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

// Thrown by RateCardItemsRepository.update/remove when no row matches the
// combination of itemId + organizationId + rateCardId — i.e. the item exists
// but does not actually belong to the rate card the caller claimed. Without
// this check a caller could pass a real (locked) item's id while claiming an
// unrelated (unlocked) rateCardId in the request body: the service's lock
// check would pass against the wrong card, and the write must not then
// silently succeed (or silently no-op) against the real, locked item.
export class RateCardItemNotFoundError extends Error {
  constructor(itemId: string, rateCardId: string) {
    super(`Rate card item ${itemId} not found on rate card ${rateCardId}`);
    this.name = "RateCardItemNotFoundError";
  }
}
