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

export const CreatorsRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateCreatorInput,
  ): Promise<Creator> {
    return runInTenantContext(db, organizationId, async (tx) => {
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
    });
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
