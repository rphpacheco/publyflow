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
import { runInTenantContext } from "@/repositories/tenant-context";
import { RateCardNotFoundError } from "@/domain/rate-cards/errors";

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

  // Same rule as lock(), but for callers (e.g. ProposalItemService.addItem)
  // that already hold a transaction and need locking folded into it rather
  // than opening a second one. This is the call boundary future locking
  // rules (audit logging, a re-lock guard, notifications) get added to --
  // callers outside RateCardService must never reach past it into
  // RateCardsRepository directly.
  async lockWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    rateCardId: string,
  ): Promise<RateCard> {
    return RateCardsRepository.setLockedWithTx(tx, organizationId, rateCardId, true);
  },

  // Fix 2-4: the read of the original card + its items, the new card
  // insert, and every item insert now share ONE transaction via
  // runInTenantContext, using the *WithTx repository variants throughout.
  // Previously each step opened its own transaction, so a failure partway
  // through item copying (e.g. the Nth item insert throwing) left a
  // half-copied rate card committed with no rollback.
  async duplicate(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    rateCardId: string,
    input: DuplicateRateCardInput,
  ): Promise<DuplicateRateCardResult> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const original = await RateCardsRepository.findByIdWithTx(tx, organizationId, rateCardId);
      if (!original) {
        throw new RateCardNotFoundError(rateCardId);
      }

      const originalItems = await RateCardItemsRepository.listByRateCardWithTx(
        tx,
        organizationId,
        rateCardId,
      );

      const rateCard = await RateCardsRepository.createWithTx(tx, organizationId, {
        creatorId: original.creatorId,
        name: input.name,
        validFrom: original.validFrom,
        validTo: original.validTo,
      });

      const items: RateCardItem[] = [];
      for (const originalItem of originalItems) {
        const item = await RateCardItemsRepository.createWithTx(tx, organizationId, {
          rateCardId: rateCard.id,
          serviceId: originalItem.serviceId,
          price: originalItem.price,
          unitDescription: originalItem.unitDescription,
          sortOrder: originalItem.sortOrder,
        });
        items.push(item);
      }

      return { rateCard, items };
    });
  },
};
