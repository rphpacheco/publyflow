import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { rateCardItems } from "@/db/schema/rate-cards";
import { runInTenantContext } from "./tenant-context";

export type RateCardItem = typeof rateCardItems.$inferSelect;

export interface CreateRateCardItemInput {
  rateCardId: string;
  serviceId: string;
  price: number;
  unitDescription?: string | null;
  sortOrder?: number;
}

export interface UpdateRateCardItemInput {
  price?: number;
  unitDescription?: string | null;
  sortOrder?: number;
}

export const RateCardItemsRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateRateCardItemInput,
  ): Promise<RateCardItem> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [item] = await tx
        .insert(rateCardItems)
        .values({
          organizationId,
          rateCardId: input.rateCardId,
          serviceId: input.serviceId,
          price: input.price,
          unitDescription: input.unitDescription ?? null,
          sortOrder: input.sortOrder ?? 0,
        })
        .returning();
      return item;
    });
  },

  async update(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
    input: UpdateRateCardItemInput,
  ): Promise<RateCardItem> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [item] = await tx
        .update(rateCardItems)
        .set(input)
        .where(and(eq(rateCardItems.id, itemId), eq(rateCardItems.organizationId, organizationId)))
        .returning();
      return item;
    });
  },

  async remove(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
  ): Promise<void> {
    await runInTenantContext(db, organizationId, async (tx) => {
      await tx
        .delete(rateCardItems)
        .where(and(eq(rateCardItems.id, itemId), eq(rateCardItems.organizationId, organizationId)));
    });
  },

  async listByRateCard(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    rateCardId: string,
  ): Promise<RateCardItem[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      return tx
        .select()
        .from(rateCardItems)
        .where(
          and(eq(rateCardItems.organizationId, organizationId), eq(rateCardItems.rateCardId, rateCardId)),
        );
    });
  },
};
