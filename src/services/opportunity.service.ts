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

// Split out so `createFromLead` (opens its own transaction for the brand
// lookup) and `createFromLeadWithTx` (runs the same check against a
// caller-supplied transaction, so it can participate in a larger atomic
// flow like CommercialInquiryService.resolve) share one validation
// implementation instead of duplicating it.
async function checkValidParty(
  tx: NodePgDatabase<typeof schema>,
  input: CreateOpportunityFromLeadInput,
): Promise<void> {
  if (!input.companyId && !input.brandId) {
    throw new InvalidOpportunityPartyError(
      "Opportunity requires at least one of company_id or brand_id",
    );
  }

  if (input.companyId && input.brandId) {
    const [brand] = await tx.select().from(brands).where(eq(brands.id, input.brandId));

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
    await runInTenantContext(db, organizationId, (tx) => checkValidParty(tx, input));

    return OpportunitiesRepository.create(db, organizationId, {
      creatorId: input.creatorId,
      leadId: input.leadId,
      companyId: input.companyId,
      brandId: input.brandId,
    });
  },

  // Same as `createFromLead`, but against a transaction the caller already
  // opened (and already set `app.current_org_id` on). Use this when the
  // Opportunity insert must be atomic with other writes — e.g.
  // CommercialInquiryService.resolve, where the Lead insert, the
  // Opportunity insert, and the inquiry status update all need to commit
  // or roll back together.
  async createFromLeadWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateOpportunityFromLeadInput,
  ): Promise<Opportunity> {
    await checkValidParty(tx, input);

    return OpportunitiesRepository.createWithTx(tx, organizationId, {
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

  async findOpenOpportunityForPartyWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    party: FindOpenForPartyInput,
  ): Promise<Opportunity | null> {
    return OpportunitiesRepository.findOpenForPartyWithTx(tx, organizationId, party);
  },
};
