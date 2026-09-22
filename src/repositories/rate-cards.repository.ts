import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { rateCards } from "@/db/schema/rate-cards";
import { runInTenantContext } from "./tenant-context";
import { RateCardNotFoundError } from "@/domain/rate-cards/errors";

export type RateCard = typeof rateCards.$inferSelect;

export interface CreateRateCardInput {
  creatorId: string;
  name: string;
  validFrom?: Date | null;
  validTo?: Date | null;
}

// Shared insert/query logic -- see creators.repository.ts for the pattern.
// The plain methods open their own transaction; the `*WithTx` siblings let
// a caller (e.g. RateCardService.duplicate, RateCardItemService.addItem)
// fold these reads/writes into a larger, caller-owned transaction so they
// commit or roll back together with sibling repository calls.
async function insertRateCard(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  input: CreateRateCardInput,
): Promise<RateCard> {
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
}

async function selectRateCardById(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  rateCardId: string,
): Promise<RateCard | null> {
  const [rateCard] = await tx
    .select()
    .from(rateCards)
    .where(and(eq(rateCards.id, rateCardId), eq(rateCards.organizationId, organizationId)));
  return rateCard ?? null;
}

export const RateCardsRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateRateCardInput,
  ): Promise<RateCard> {
    return runInTenantContext(db, organizationId, (tx) => insertRateCard(tx, organizationId, input));
  },

  async createWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateRateCardInput,
  ): Promise<RateCard> {
    return insertRateCard(tx, organizationId, input);
  },

  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    rateCardId: string,
  ): Promise<RateCard | null> {
    return runInTenantContext(db, organizationId, (tx) =>
      selectRateCardById(tx, organizationId, rateCardId),
    );
  },

  async findByIdWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    rateCardId: string,
  ): Promise<RateCard | null> {
    return selectRateCardById(tx, organizationId, rateCardId);
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

  // Fix 5: `.returning()` yields no row when rateCardId doesn't resolve to
  // a row in this organization (nonexistent, or belongs to another org).
  // Previously this destructured to `undefined` but was mistyped as the
  // non-nullable RateCard, so RateCardService.lock() would resolve
  // successfully without locking anything -- a future caller (the
  // Proposals subsystem) could misread that as "locked".
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
      if (!rateCard) {
        throw new RateCardNotFoundError(rateCardId);
      }
      return rateCard;
    });
  },
};
