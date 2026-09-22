import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import {
  ServicesRepository,
  type Service,
  type CreateServiceInput,
  type UpdateServiceInput,
} from "@/repositories/services.repository";
import { runInTenantContext } from "@/repositories/tenant-context";
import { CreatorsRepository } from "@/repositories/creators.repository";
import { CreatorNotFoundError } from "@/domain/creators/errors";

export const ServiceService = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateServiceInput,
  ): Promise<Service> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const creatorExists = await CreatorsRepository.existsForOrganizationWithTx(
        tx,
        organizationId,
        input.creatorId,
      );
      if (!creatorExists) {
        throw new CreatorNotFoundError(input.creatorId);
      }
      return ServicesRepository.createWithTx(tx, organizationId, input);
    });
  },

  async update(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    serviceId: string,
    input: UpdateServiceInput,
  ): Promise<Service> {
    return ServicesRepository.update(db, organizationId, serviceId, input);
  },

  async deactivate(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    serviceId: string,
  ): Promise<Service> {
    return ServicesRepository.update(db, organizationId, serviceId, { isActive: false });
  },

  async listByCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
  ): Promise<Service[]> {
    return ServicesRepository.listByCreator(db, organizationId, creatorId);
  },
};
