import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { companies } from "@/db/schema/companies-brands-contacts";
import { runInTenantContext } from "./tenant-context";

export type Company = typeof companies.$inferSelect;

export const CompaniesRepository = {
  async findByName(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    name: string,
  ): Promise<Company | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [row] = await tx.select().from(companies).where(eq(companies.name, name));
      return row ?? null;
    });
  },

  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: { name: string },
  ): Promise<Company> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [row] = await tx.insert(companies).values({ organizationId, name: input.name }).returning();
      return row;
    });
  },
};
