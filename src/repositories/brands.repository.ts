import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { brands } from "@/db/schema/companies-brands-contacts";
import { runInTenantContext } from "./tenant-context";

export type Brand = typeof brands.$inferSelect;

export const BrandsRepository = {
  async findByName(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    name: string,
  ): Promise<Brand | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [row] = await tx.select().from(brands).where(eq(brands.name, name));
      return row ?? null;
    });
  },
};
