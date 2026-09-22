import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import {
  ServicesRepository,
  type Service,
  type CreateServiceInput,
  type UpdateServiceInput,
} from "@/repositories/services.repository";

export const ServiceService = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateServiceInput,
  ): Promise<Service> {
    return ServicesRepository.create(db, organizationId, input);
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
