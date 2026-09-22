import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { RateCardsRepository } from "@/repositories/rate-cards.repository";
import {
  RateCardItemsRepository,
  type RateCardItem,
  type CreateRateCardItemInput,
  type UpdateRateCardItemInput,
} from "@/repositories/rate-card-items.repository";
import { RateCardLockedError } from "@/domain/rate-cards/errors";

async function assertNotLocked(
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  rateCardId: string,
): Promise<void> {
  const rateCard = await RateCardsRepository.findById(db, organizationId, rateCardId);
  if (rateCard?.isLocked) {
    throw new RateCardLockedError(rateCardId);
  }
}

export const RateCardItemService = {
  async addItem(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateRateCardItemInput,
  ): Promise<RateCardItem> {
    await assertNotLocked(db, organizationId, input.rateCardId);
    return RateCardItemsRepository.create(db, organizationId, input);
  },

  async updateItem(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
    rateCardId: string,
    input: UpdateRateCardItemInput,
  ): Promise<RateCardItem> {
    await assertNotLocked(db, organizationId, rateCardId);
    return RateCardItemsRepository.update(db, organizationId, itemId, input);
  },

  async removeItem(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
    rateCardId: string,
  ): Promise<void> {
    await assertNotLocked(db, organizationId, rateCardId);
    return RateCardItemsRepository.remove(db, organizationId, itemId);
  },
};
