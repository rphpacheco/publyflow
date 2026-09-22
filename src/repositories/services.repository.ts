import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { services } from "@/db/schema/services";
import { runInTenantContext } from "./tenant-context";

export type Service = typeof services.$inferSelect;

export interface CreateServiceInput {
  creatorId: string;
  name: string;
  description?: string | null;
  unitDescription?: string | null;
}

export interface UpdateServiceInput {
  name?: string;
  description?: string | null;
  unitDescription?: string | null;
  isActive?: boolean;
}

export const ServicesRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateServiceInput,
  ): Promise<Service> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [service] = await tx
        .insert(services)
        .values({
          organizationId,
          creatorId: input.creatorId,
          name: input.name,
          description: input.description ?? null,
          unitDescription: input.unitDescription ?? null,
        })
        .returning();
      return service;
    });
  },

  async update(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    serviceId: string,
    input: UpdateServiceInput,
  ): Promise<Service> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [service] = await tx
        .update(services)
        .set(input)
        .where(and(eq(services.id, serviceId), eq(services.organizationId, organizationId)))
        .returning();
      return service;
    });
  },

  async listByCreator(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    creatorId: string,
  ): Promise<Service[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      return tx
        .select()
        .from(services)
        .where(and(eq(services.organizationId, organizationId), eq(services.creatorId, creatorId)));
    });
  },
};
