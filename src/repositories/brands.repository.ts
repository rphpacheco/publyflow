import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { brands } from "@/db/schema/companies-brands-contacts";
import { runInTenantContext } from "./tenant-context";

export type Brand = typeof brands.$inferSelect;

export const BrandsRepository = {
  async listByName(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    name: string,
  ): Promise<Brand[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      return tx
        .select()
        .from(brands)
        .where(and(eq(brands.name, name), eq(brands.organizationId, organizationId)));
    });
  },

  async listByOrganization(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
  ): Promise<Brand[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      return tx
        .select()
        .from(brands)
        .where(eq(brands.organizationId, organizationId))
        .orderBy(desc(brands.createdAt));
    });
  },

  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: { name: string; companyId?: string | null },
  ): Promise<Brand> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [row] = await tx
        .insert(brands)
        .values({ organizationId, name: input.name, companyId: input.companyId ?? null })
        .returning();
      return row;
    });
  },

  async findByIdWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    brandId: string,
  ): Promise<Brand | null> {
    const [row] = await tx
      .select()
      .from(brands)
      .where(and(eq(brands.id, brandId), eq(brands.organizationId, organizationId)));
    return row ?? null;
  },
};
