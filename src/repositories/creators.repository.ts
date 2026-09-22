import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { creators } from "@/db/schema/creators";
import { runInTenantContext } from "./tenant-context";

export type Creator = typeof creators.$inferSelect;

export interface CreateCreatorInput {
  userId: string;
  displayName: string;
  instagramHandle?: string | null;
}

// Shared insert logic -- see conversations.repository.ts for the pattern.
// `create` opens its own transaction; `createWithTx` lets a caller (e.g.
// CreatorService.onboardCreator) fold this insert into a larger,
// caller-owned transaction so it commits or rolls back together with the
// sibling `users` insert.
async function insertCreator(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  input: CreateCreatorInput,
): Promise<Creator> {
  const [creator] = await tx
    .insert(creators)
    .values({
      organizationId,
      userId: input.userId,
      displayName: input.displayName,
      instagramHandle: input.instagramHandle ?? null,
    })
    .returning();
  return creator;
}

export const CreatorsRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateCreatorInput,
  ): Promise<Creator> {
    return runInTenantContext(db, organizationId, (tx) => insertCreator(tx, organizationId, input));
  },

  async createWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateCreatorInput,
  ): Promise<Creator> {
    return insertCreator(tx, organizationId, input);
  },

  async listByOrganization(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
  ): Promise<Creator[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      return tx.select().from(creators).where(eq(creators.organizationId, organizationId));
    });
  },
};
