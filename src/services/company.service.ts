import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { CompaniesRepository, type Company } from "@/repositories/companies.repository";

export const CompanyService = {
  async listByOrganization(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
  ): Promise<Company[]> {
    return CompaniesRepository.listByOrganization(db, organizationId);
  },

  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    companyId: string,
  ): Promise<Company | null> {
    return CompaniesRepository.findById(db, organizationId, companyId);
  },
};
