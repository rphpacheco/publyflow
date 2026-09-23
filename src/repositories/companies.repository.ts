import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { companies } from "@/db/schema/companies-brands-contacts";
import { runInTenantContext } from "./tenant-context";

export type Company = typeof companies.$inferSelect;

export const CompaniesRepository = {
  async listByName(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    name: string,
  ): Promise<Company[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      return tx
        .select()
        .from(companies)
        .where(and(eq(companies.name, name), eq(companies.organizationId, organizationId)));
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

  async listByOrganization(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
  ): Promise<Company[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      return tx
        .select()
        .from(companies)
        .where(eq(companies.organizationId, organizationId))
        .orderBy(desc(companies.createdAt));
    });
  },

  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    companyId: string,
  ): Promise<Company | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [row] = await tx
        .select()
        .from(companies)
        .where(and(eq(companies.id, companyId), eq(companies.organizationId, organizationId)));
      return row ?? null;
    });
  },
};
