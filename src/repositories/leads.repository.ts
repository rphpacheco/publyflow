import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { leads } from "@/db/schema/commercial-flow";
import { runInTenantContext } from "./tenant-context";

export type Lead = typeof leads.$inferSelect;

export interface CreateLeadInput {
  creatorId: string;
  inquiryId: string | null;
  contactId: string;
  companyId: string | null;
  brandId: string | null;
  qualified: boolean;
}

export const LeadsRepository = {
  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    leadId: string,
  ): Promise<Lead | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [lead] = await tx.select().from(leads).where(eq(leads.id, leadId));
      return lead ?? null;
    });
  },

  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateLeadInput,
  ): Promise<Lead> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [lead] = await tx
        .insert(leads)
        .values({
          organizationId,
          creatorId: input.creatorId,
          inquiryId: input.inquiryId,
          contactId: input.contactId,
          companyId: input.companyId,
          brandId: input.brandId,
          qualified: input.qualified,
        })
        .returning();
      return lead;
    });
  },
};
