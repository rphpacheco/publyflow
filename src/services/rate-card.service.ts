import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import {
  RateCardsRepository,
  type RateCard,
  type CreateRateCardInput,
} from "@/repositories/rate-cards.repository";
import {
  RateCardItemsRepository,
  type RateCardItem,
} from "@/repositories/rate-card-items.repository";

export interface DuplicateRateCardInput {
  name: string;
}

export interface DuplicateRateCardResult {
  rateCard: RateCard;
  items: RateCardItem[];
}

export const RateCardService = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateRateCardInput,
  ): Promise<RateCard> {
    return RateCardsRepository.create(db, organizationId, input);
  },

  async listByCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
  ): Promise<RateCard[]> {
    return RateCardsRepository.listByCreator(db, organizationId, creatorId);
  },

  async lock(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    rateCardId: string,
  ): Promise<RateCard> {
    return RateCardsRepository.setLocked(db, organizationId, rateCardId, true);
  },

  async duplicate(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    rateCardId: string,
    input: DuplicateRateCardInput,
  ): Promise<DuplicateRateCardResult> {
    const original = await RateCardsRepository.findById(db, organizationId, rateCardId);
    if (!original) {
      throw new Error(`Rate card ${rateCardId} not found`);
    }

    const originalItems = await RateCardItemsRepository.listByRateCard(
      db,
      organizationId,
      rateCardId,
    );

    const rateCard = await RateCardsRepository.create(db, organizationId, {
      creatorId: original.creatorId,
      name: input.name,
      validFrom: original.validFrom,
      validTo: original.validTo,
    });

    const items: RateCardItem[] = [];
    for (const originalItem of originalItems) {
      const item = await RateCardItemsRepository.create(db, organizationId, {
        rateCardId: rateCard.id,
        serviceId: originalItem.serviceId,
        price: originalItem.price,
        unitDescription: originalItem.unitDescription,
        sortOrder: originalItem.sortOrder,
      });
      items.push(item);
    }

    return { rateCard, items };
  },
};
