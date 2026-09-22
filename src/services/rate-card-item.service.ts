import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { RateCardsRepository, type RateCard } from "@/repositories/rate-cards.repository";
import { ServicesRepository } from "@/repositories/services.repository";
import {
  RateCardItemsRepository,
  type RateCardItem,
  type CreateRateCardItemInput,
  type UpdateRateCardItemInput,
} from "@/repositories/rate-card-items.repository";
import { runInTenantContext } from "@/repositories/tenant-context";
import {
  RateCardLockedError,
  RateCardNotFoundError,
  ServiceNotFoundError,
  ServiceMismatchError,
} from "@/domain/rate-cards/errors";

// Fix 1 + Fix 2-4: resolves the rate card via findByIdWithTx (inside the
// caller's transaction) and throws RateCardNotFoundError when it's null --
// nonexistent, or belongs to another organization. Previously
// `rateCard?.isLocked` was falsy for a null rateCard too, so a foreign-org
// rateCardId would silently sail past this check and only get caught (or
// not) by the Postgres FK, which bypasses RLS.
//
// Doing the lookup inside the same transaction as the write (rather than
// in its own runInTenantContext, as before) closes the TOCTOU window: a
// concurrent RateCardService.lock() call can no longer land between this
// check committing and the write's own transaction opening.
async function assertNotLocked(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  rateCardId: string,
): Promise<RateCard> {
  const rateCard = await RateCardsRepository.findByIdWithTx(tx, organizationId, rateCardId);
  if (!rateCard) {
    throw new RateCardNotFoundError(rateCardId);
  }
  if (rateCard.isLocked) {
    throw new RateCardLockedError(rateCardId);
  }
  return rateCard;
}

export const RateCardItemService = {
  async addItem(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateRateCardItemInput,
  ): Promise<RateCardItem> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const rateCard = await assertNotLocked(tx, organizationId, input.rateCardId);

      // Fix 1: RateCardItemsRepository.create never validated that
      // serviceId belongs to the caller's org AND the same creator as the
      // rate card -- same FK-bypasses-RLS exposure as the rateCardId one,
      // one field over.
      const service = await ServicesRepository.findByIdWithTx(tx, organizationId, input.serviceId);
      if (!service) {
        throw new ServiceNotFoundError(input.serviceId);
      }
      if (service.creatorId !== rateCard.creatorId) {
        throw new ServiceMismatchError(input.serviceId, input.rateCardId);
      }

      return RateCardItemsRepository.createWithTx(tx, organizationId, input);
    });
  },

  async updateItem(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
    rateCardId: string,
    input: UpdateRateCardItemInput,
  ): Promise<RateCardItem> {
    return runInTenantContext(db, organizationId, async (tx) => {
      await assertNotLocked(tx, organizationId, rateCardId);
      return RateCardItemsRepository.updateWithTx(tx, organizationId, itemId, rateCardId, input);
    });
  },

  async removeItem(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
    rateCardId: string,
  ): Promise<void> {
    await runInTenantContext(db, organizationId, async (tx) => {
      await assertNotLocked(tx, organizationId, rateCardId);
      return RateCardItemsRepository.removeWithTx(tx, organizationId, itemId, rateCardId);
    });
  },
};
