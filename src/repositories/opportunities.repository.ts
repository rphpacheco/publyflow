import { and, eq, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { opportunities, opportunityStageHistory, leads } from "@/db/schema/commercial-flow";
import { runInTenantContext } from "./tenant-context";

export type Opportunity = typeof opportunities.$inferSelect;

export interface CreateOpportunityInput {
  creatorId: string;
  leadId: string;
  companyId: string | null;
  brandId: string | null;
}

export interface FindOpenForPartyInput {
  contactId?: string;
  companyId?: string;
  brandId?: string;
}

export const OpportunitiesRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateOpportunityInput,
  ): Promise<Opportunity> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [opportunity] = await tx
        .insert(opportunities)
        .values({
          organizationId,
          creatorId: input.creatorId,
          leadId: input.leadId,
          companyId: input.companyId,
          brandId: input.brandId,
          stage: "NOVO_LEAD",
          status: "OPEN",
        })
        .returning();

      await tx.insert(opportunityStageHistory).values({
        opportunityId: opportunity.id,
        fromStage: null,
        toStage: "NOVO_LEAD",
      });

      return opportunity;
    });
  },

  async findOpenForParty(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    party: FindOpenForPartyInput,
  ): Promise<Opportunity | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const conditions = [];
      if (party.companyId) conditions.push(eq(opportunities.companyId, party.companyId));
      if (party.brandId) conditions.push(eq(opportunities.brandId, party.brandId));
      if (party.contactId) {
        conditions.push(eq(leads.contactId, party.contactId));
      }

      if (conditions.length === 0) return null;

      const [opportunity] = await tx
        .select({ opportunity: opportunities })
        .from(opportunities)
        .innerJoin(leads, eq(leads.id, opportunities.leadId))
        .where(and(eq(opportunities.status, "OPEN"), or(...conditions)))
        .limit(1);

      return opportunity?.opportunity ?? null;
    });
  },
};
