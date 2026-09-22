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

// Thrown when a Rate Card id does not resolve to a row visible to the
// caller's organization — either it doesn't exist at all, or it belongs to
// another organization. Postgres FK constraints bypass RLS, so without this
// check a caller could pass a foreign org's rateCardId and have the FK
// happily accept it, silently creating a rate_card_items row whose
// organization_id is the caller's org but whose rate_card_id points at
// another organization's rate card. Thrown by RateCardsRepository.setLocked
// (see Fix 5) and by RateCardItemService.addItem/updateItem/removeItem
// whenever RateCardsRepository.findById(WithTx) returns null — distinct
// from RateCardLockedError, which requires the rate card to actually exist.
export class RateCardNotFoundError extends Error {
  constructor(rateCardId: string) {
    super(`Rate card ${rateCardId} not found`);
    this.name = "RateCardNotFoundError";
  }
}

// Thrown when a Service id does not resolve to a row visible to the
// caller's organization (same FK-bypasses-RLS exposure as
// RateCardNotFoundError, one field over: RateCardItemsRepository.create
// never validated serviceId belonged to the caller's org). Also thrown by
// ServicesRepository.update (see Fix 5) when no row matches the WHERE
// clause.
export class ServiceNotFoundError extends Error {
  constructor(serviceId: string) {
    super(`Service ${serviceId} not found`);
    this.name = "ServiceNotFoundError";
  }
}

// Thrown by RateCardItemService.addItem when the resolved service belongs
// to a different creator than the rate card it's being added to — the
// per-creator catalog invariant requires a rate card's items to all be
// services of that same rate card's creator, even when the service is a
// perfectly valid row within the caller's own organization.
export class ServiceMismatchError extends Error {
  constructor(serviceId: string, rateCardId: string) {
    super(`Service ${serviceId} does not belong to the creator of rate card ${rateCardId}`);
    this.name = "ServiceMismatchError";
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
