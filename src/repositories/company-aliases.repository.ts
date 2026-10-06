import { and, asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { companyAliases } from "@/db/schema/companies-brands-contacts";

type Db = NodePgDatabase<typeof schema>;
export type CompanyAlias = typeof companyAliases.$inferSelect;

const sameName = (name: string) => sql`lower(trim(${companyAliases.name})) = lower(trim(${name}))`;

export const CompanyAliasesRepository = {
  listByCompanyWithTx(tx: Db, organizationId: string, companyId: string): Promise<CompanyAlias[]> {
    return tx.select().from(companyAliases)
      .where(and(eq(companyAliases.organizationId, organizationId), eq(companyAliases.companyId, companyId)))
      .orderBy(asc(companyAliases.name));
  },

  async findOwnerCiWithTx(tx: Db, organizationId: string, name: string): Promise<CompanyAlias | null> {
    const [row] = await tx.select().from(companyAliases)
      .where(and(eq(companyAliases.organizationId, organizationId), sameName(name))).limit(1);
    return row ?? null;
  },

  async insertIfAbsentWithTx(tx: Db, organizationId: string, companyId: string, name: string): Promise<boolean> {
    const rows = await tx.insert(companyAliases).values({ organizationId, companyId, name: name.trim() })
      .onConflictDoNothing().returning({ id: companyAliases.id });
    return rows.length > 0;
  },

  async moveWithTx(tx: Db, organizationId: string, fromCompanyId: string, toCompanyId: string): Promise<number> {
    const rows = await tx.update(companyAliases).set({ companyId: toCompanyId })
      .where(and(eq(companyAliases.organizationId, organizationId), eq(companyAliases.companyId, fromCompanyId)))
      .returning({ id: companyAliases.id });
    return rows.length;
  },

  async deleteWithTx(tx: Db, organizationId: string, companyId: string, aliasId: string): Promise<boolean> {
    const rows = await tx.delete(companyAliases)
      .where(and(eq(companyAliases.organizationId, organizationId), eq(companyAliases.companyId, companyId), eq(companyAliases.id, aliasId)))
      .returning({ id: companyAliases.id });
    return rows.length > 0;
  },

  async deleteByIdWithTx(tx: Db, organizationId: string, aliasId: string): Promise<void> {
    await tx.delete(companyAliases).where(and(eq(companyAliases.organizationId, organizationId), eq(companyAliases.id, aliasId)));
  },
};
