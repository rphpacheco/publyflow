import { and, desc, eq, ne, sql } from "drizzle-orm";
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

  async findByIdWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    companyId: string,
  ): Promise<Company | null> {
    const [row] = await tx
      .select()
      .from(companies)
      .where(and(eq(companies.id, companyId), eq(companies.organizationId, organizationId)));
    return row ?? null;
  },

  async lockByIdWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    companyId: string,
  ): Promise<Company | null> {
    const [row] = await tx
      .select()
      .from(companies)
      .where(and(eq(companies.id, companyId), eq(companies.organizationId, organizationId)))
      .for("update");
    return row ?? null;
  },

  // Case-insensitive, trimmed comparison; no index (small per-org volume, spec D9).
  async findOtherByNameCiWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    name: string,
    excludeId: string,
  ): Promise<Company | null> {
    const [row] = await tx
      .select()
      .from(companies)
      .where(
        and(
          eq(companies.organizationId, organizationId),
          ne(companies.id, excludeId),
          sql`lower(trim(${companies.name})) = lower(trim(${name}))`,
        ),
      )
      .limit(1);
    return row ?? null;
  },

  async updateNameWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    companyId: string,
    name: string,
  ): Promise<Company> {
    const [row] = await tx
      .update(companies)
      .set({ name })
      .where(and(eq(companies.id, companyId), eq(companies.organizationId, organizationId)))
      .returning();
    return row;
  },
};
