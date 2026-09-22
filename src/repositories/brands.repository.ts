import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { brands } from "@/db/schema/companies-brands-contacts";
import { runInTenantContext } from "./tenant-context";

export type Brand = typeof brands.$inferSelect;

export const BrandsRepository = {
  // Explicit organization predicate, belt-and-suspenders alongside the RLS
  // policy: `name` alone is not org-scoped.
  async findByName(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    name: string,
  ): Promise<Brand | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [row] = await tx
        .select()
        .from(brands)
        .where(and(eq(brands.name, name), eq(brands.organizationId, organizationId)));
      return row ?? null;
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
};
