import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { companies, companyAliases } from "@/db/schema/companies-brands-contacts";
import { runInTenantContext } from "./tenant-context";

export type Company = typeof companies.$inferSelect;

export const CompaniesRepository = {
  async listByName(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    name: string,
  ): Promise<Company[]> {
    // Exact name (existing behavior) OR an alias equal to the guess (case/space-insensitive), deduplicated.
    return runInTenantContext(db, organizationId, async (tx) => {
      const byName = await tx
        .select()
        .from(companies)
        .where(and(eq(companies.name, name), eq(companies.organizationId, organizationId)));
      const byAlias = await tx
        .select({ company: companies })
        .from(companyAliases)
        .innerJoin(companies, and(eq(companies.id, companyAliases.companyId), eq(companies.organizationId, organizationId)))
        .where(and(eq(companyAliases.organizationId, organizationId), sql`lower(trim(${companyAliases.name})) = lower(trim(${name}))`));
      const result = new Map(byName.map((c) => [c.id, c]));
      for (const row of byAlias) result.set(row.company.id, row.company);
      return [...result.values()];
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
