import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { BrandsRepository, type Brand } from "@/repositories/brands.repository";

export const BrandService = {
  async listByOrganization(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
  ): Promise<Brand[]> {
    return BrandsRepository.listByOrganization(db, organizationId);
  },
};
