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

// Shared insert logic — see conversations.repository.ts for the pattern.
// `create` opens its own transaction; `createWithTx` lets a caller fold
// this insert into a larger, caller-owned transaction (e.g.
// CommercialInquiryService.resolve, which needs the Lead insert to commit
// or roll back together with the Opportunity insert and the inquiry status
// update).
async function insertLead(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  input: CreateLeadInput,
): Promise<Lead> {
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
    return runInTenantContext(db, organizationId, (tx) => insertLead(tx, organizationId, input));
  },

  async createWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateLeadInput,
  ): Promise<Lead> {
    return insertLead(tx, organizationId, input);
  },
};
