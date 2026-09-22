import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { rateCardItems } from "@/db/schema/rate-cards";
import { runInTenantContext } from "./tenant-context";
import { RateCardItemNotFoundError } from "@/domain/rate-cards/errors";

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

// Shared insert/update/remove/list logic -- see creators.repository.ts for
// the pattern. The plain methods open their own transaction; the
// `*WithTx` siblings let a caller (e.g. RateCardService.duplicate,
// RateCardItemService.addItem/updateItem/removeItem) fold these into a
// larger, caller-owned transaction so they commit or roll back together
// with sibling repository calls (see Fix 2-4).
async function insertRateCardItem(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  input: CreateRateCardItemInput,
): Promise<RateCardItem> {
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
}

async function updateRateCardItem(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  itemId: string,
  rateCardId: string,
  input: UpdateRateCardItemInput,
): Promise<RateCardItem> {
  const [item] = await tx
    .update(rateCardItems)
    .set(input)
    .where(
      and(
        eq(rateCardItems.id, itemId),
        eq(rateCardItems.organizationId, organizationId),
        eq(rateCardItems.rateCardId, rateCardId),
      ),
    )
    .returning();
  if (!item) {
    throw new RateCardItemNotFoundError(itemId, rateCardId);
  }
  return item;
}

async function removeRateCardItem(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  itemId: string,
  rateCardId: string,
): Promise<void> {
  const [item] = await tx
    .delete(rateCardItems)
    .where(
      and(
        eq(rateCardItems.id, itemId),
        eq(rateCardItems.organizationId, organizationId),
        eq(rateCardItems.rateCardId, rateCardId),
      ),
    )
    .returning();
  if (!item) {
    throw new RateCardItemNotFoundError(itemId, rateCardId);
  }
}

async function selectRateCardItemById(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  itemId: string,
): Promise<RateCardItem | null> {
  const [item] = await tx
    .select()
    .from(rateCardItems)
    .where(and(eq(rateCardItems.id, itemId), eq(rateCardItems.organizationId, organizationId)));
  return item ?? null;
}

async function selectRateCardItemsByRateCard(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  rateCardId: string,
): Promise<RateCardItem[]> {
  return tx
    .select()
    .from(rateCardItems)
    .where(and(eq(rateCardItems.organizationId, organizationId), eq(rateCardItems.rateCardId, rateCardId)));
}

export const RateCardItemsRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateRateCardItemInput,
  ): Promise<RateCardItem> {
    return runInTenantContext(db, organizationId, (tx) => insertRateCardItem(tx, organizationId, input));
  },

  async createWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateRateCardItemInput,
  ): Promise<RateCardItem> {
    return insertRateCardItem(tx, organizationId, input);
  },

  async update(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
    rateCardId: string,
    input: UpdateRateCardItemInput,
  ): Promise<RateCardItem> {
    return runInTenantContext(db, organizationId, (tx) =>
      updateRateCardItem(tx, organizationId, itemId, rateCardId, input),
    );
  },

  async updateWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
    rateCardId: string,
    input: UpdateRateCardItemInput,
  ): Promise<RateCardItem> {
    return updateRateCardItem(tx, organizationId, itemId, rateCardId, input);
  },

  async remove(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
    rateCardId: string,
  ): Promise<void> {
    await runInTenantContext(db, organizationId, (tx) =>
      removeRateCardItem(tx, organizationId, itemId, rateCardId),
    );
  },

  async removeWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
    rateCardId: string,
  ): Promise<void> {
    return removeRateCardItem(tx, organizationId, itemId, rateCardId);
  },

  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
  ): Promise<RateCardItem | null> {
    return runInTenantContext(db, organizationId, (tx) => selectRateCardItemById(tx, organizationId, itemId));
  },

  async findByIdWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
  ): Promise<RateCardItem | null> {
    return selectRateCardItemById(tx, organizationId, itemId);
  },

  async listByRateCard(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    rateCardId: string,
  ): Promise<RateCardItem[]> {
    return runInTenantContext(db, organizationId, (tx) =>
      selectRateCardItemsByRateCard(tx, organizationId, rateCardId),
    );
  },

  async listByRateCardWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    rateCardId: string,
  ): Promise<RateCardItem[]> {
    return selectRateCardItemsByRateCard(tx, organizationId, rateCardId);
  },
};
