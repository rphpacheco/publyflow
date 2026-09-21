import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { brands } from "@/db/schema/companies-brands-contacts";
import { runInTenantContext } from "@/repositories/tenant-context";
import {
  OpportunitiesRepository,
  type Opportunity,
  type FindOpenForPartyInput,
} from "@/repositories/opportunities.repository";
import { InvalidOpportunityPartyError } from "@/domain/commercial-flow/errors";

export interface CreateOpportunityFromLeadInput {
  leadId: string;
  creatorId: string;
  companyId: string | null;
  brandId: string | null;
}

async function assertValidParty(
  db: NodePgDatabase<typeof schema>,
  organizationId: string,
  input: CreateOpportunityFromLeadInput,
): Promise<void> {
  if (!input.companyId && !input.brandId) {
    throw new InvalidOpportunityPartyError(
      "Opportunity requires at least one of company_id or brand_id",
    );
  }

  if (input.companyId && input.brandId) {
    const brand = await runInTenantContext(db, organizationId, async (tx) => {
      const [row] = await tx.select().from(brands).where(eq(brands.id, input.brandId!));
      return row ?? null;
    });

    if (brand?.companyId && brand.companyId !== input.companyId) {
      throw new InvalidOpportunityPartyError(
        "brand.company_id must match opportunity.company_id when both are set",
      );
    }
  }
}

export const OpportunityService = {
  async createFromLead(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateOpportunityFromLeadInput,
  ): Promise<Opportunity> {
    await assertValidParty(db, organizationId, input);

    return OpportunitiesRepository.create(db, organizationId, {
      creatorId: input.creatorId,
      leadId: input.leadId,
      companyId: input.companyId,
      brandId: input.brandId,
    });
  },

  async findOpenOpportunityForParty(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    party: FindOpenForPartyInput,
  ): Promise<Opportunity | null> {
    return OpportunitiesRepository.findOpenForParty(db, organizationId, party);
  },
};
