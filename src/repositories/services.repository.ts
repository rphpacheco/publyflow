import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { services } from "@/db/schema/services";
import { runInTenantContext } from "./tenant-context";
import { ServiceNotFoundError } from "@/domain/rate-cards/errors";

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

async function selectServiceById(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  serviceId: string,
): Promise<Service | null> {
  const [service] = await tx
    .select()
    .from(services)
    .where(and(eq(services.id, serviceId), eq(services.organizationId, organizationId)));
  return service ?? null;
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
      // Fix 5: without this check, an unknown/foreign serviceId silently
      // no-ops -- `.returning()` yields no row, which destructures to
      // `undefined` but was mistyped as the non-nullable Service, so
      // PATCH /api/services/:id would return 200 with an empty body
      // instead of a 404.
      if (!service) {
        throw new ServiceNotFoundError(serviceId);
      }
      return service;
    });
  },

  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    serviceId: string,
  ): Promise<Service | null> {
    return runInTenantContext(db, organizationId, (tx) =>
      selectServiceById(tx, organizationId, serviceId),
    );
  },

  async findByIdWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    serviceId: string,
  ): Promise<Service | null> {
    return selectServiceById(tx, organizationId, serviceId);
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
