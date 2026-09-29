import { eq, and, asc } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { creators } from "@/db/schema/creators";
import { users } from "@/db/schema/organizations";
import { runInTenantContext } from "./tenant-context";

export type Creator = typeof creators.$inferSelect;
export type CreatorWithEmail = Creator & { email: string };

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

async function selectCreatorExists(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  creatorId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: creators.id })
    .from(creators)
    .where(and(eq(creators.id, creatorId), eq(creators.organizationId, organizationId)));
  return Boolean(row);
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
      return tx
        .select()
        .from(creators)
        .where(eq(creators.organizationId, organizationId))
        .orderBy(asc(creators.displayName));
    });
  },

  async existsForOrganization(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
  ): Promise<boolean> {
    return runInTenantContext(db, organizationId, (tx) =>
      selectCreatorExists(tx, organizationId, creatorId),
    );
  },

  async existsForOrganizationWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
  ): Promise<boolean> {
    return selectCreatorExists(tx, organizationId, creatorId);
  },

  async findByIdWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
  ): Promise<Creator | null> {
    const [row] = await tx
      .select()
      .from(creators)
      .where(and(eq(creators.id, creatorId), eq(creators.organizationId, organizationId)));
    return row ?? null;
  },

  async findByUserIdWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    userId: string,
  ): Promise<Creator | null> {
    const [row] = await tx
      .select()
      .from(creators)
      .where(and(eq(creators.userId, userId), eq(creators.organizationId, organizationId)));
    return row ?? null;
  },

  async updateWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
    input: { displayName: string; instagramHandle: string | null },
  ): Promise<Creator | null> {
    const [row] = await tx
      .update(creators)
      .set({ displayName: input.displayName, instagramHandle: input.instagramHandle })
      .where(and(eq(creators.id, creatorId), eq(creators.organizationId, organizationId)))
      .returning();
    return row ?? null;
  },

  async listWithEmailByOrganization(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
  ): Promise<CreatorWithEmail[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const rows = await tx
        .select({ creator: creators, email: users.email })
        .from(creators)
        .innerJoin(users, eq(users.id, creators.userId))
        .where(eq(creators.organizationId, organizationId))
        .orderBy(asc(creators.displayName));
      return rows.map((row) => ({ ...row.creator, email: row.email }));
    });
  },
};
