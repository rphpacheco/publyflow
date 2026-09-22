import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { rateCards } from "@/db/schema/rate-cards";
import { runInTenantContext } from "./tenant-context";

export type RateCard = typeof rateCards.$inferSelect;

export interface CreateRateCardInput {
  creatorId: string;
  name: string;
  validFrom?: Date | null;
  validTo?: Date | null;
}

export const RateCardsRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateRateCardInput,
  ): Promise<RateCard> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [rateCard] = await tx
        .insert(rateCards)
        .values({
          organizationId,
          creatorId: input.creatorId,
          name: input.name,
          validFrom: input.validFrom ?? null,
          validTo: input.validTo ?? null,
        })
        .returning();
      return rateCard;
    });
  },

  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    rateCardId: string,
  ): Promise<RateCard | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [rateCard] = await tx
        .select()
        .from(rateCards)
        .where(and(eq(rateCards.id, rateCardId), eq(rateCards.organizationId, organizationId)));
      return rateCard ?? null;
    });
  },

  async listByCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
  ): Promise<RateCard[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      return tx
        .select()
        .from(rateCards)
        .where(and(eq(rateCards.organizationId, organizationId), eq(rateCards.creatorId, creatorId)));
    });
  },

  async setLocked(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    rateCardId: string,
    locked: boolean,
  ): Promise<RateCard> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [rateCard] = await tx
        .update(rateCards)
        .set({ isLocked: locked })
        .where(and(eq(rateCards.id, rateCardId), eq(rateCards.organizationId, organizationId)))
        .returning();
      return rateCard;
    });
  },
};
