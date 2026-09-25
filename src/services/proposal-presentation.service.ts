import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalsRepository } from "@/repositories/proposals.repository";
import { OpportunitiesRepository } from "@/repositories/opportunities.repository";
import { CreatorsRepository } from "@/repositories/creators.repository";
import { CompaniesRepository } from "@/repositories/companies.repository";
import { BrandsRepository } from "@/repositories/brands.repository";
import { ProposalVersionService, type ProposalSnapshot } from "./proposal-version.service";
import type { ProposalStatus } from "@/lib/proposal-themes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PreviewSource {
  snapshot: ProposalSnapshot;
  status: ProposalStatus;
  creator: { displayName: string; instagramHandle: string | null };
  clientName: string | null;
}

async function resolveClientName(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  brandId: string | null,
  companyId: string | null,
): Promise<string | null> {
  if (brandId) {
    const brand = await BrandsRepository.findByIdWithTx(tx, organizationId, brandId);
    if (brand) return brand.name;
  }
  if (companyId) {
    const company = await CompaniesRepository.findByIdWithTx(tx, organizationId, companyId);
    if (company) return company.name;
  }
  return null;
}

export const ProposalPresentationService = {
  /**
   * Everything the preview page needs, scoped to the session's organization.
   * Null when the id is malformed, unknown, or belongs to another
   * organization -- the page turns that into a 404 without revealing which.
   */
  async loadPreviewSource(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<PreviewSource | null> {
    if (!UUID.test(proposalId)) return null;

    return runInTenantContext(db, organizationId, async (tx) => {
      const proposal = await ProposalsRepository.findByIdWithTx(tx, organizationId, proposalId);
      if (!proposal) return null;

      const opportunity = await OpportunitiesRepository.findByIdWithTx(tx, organizationId, proposal.opportunityId);
      if (!opportunity) return null;

      const creator = await CreatorsRepository.findByIdWithTx(tx, organizationId, opportunity.creatorId);
      if (!creator) return null;

      const clientName = await resolveClientName(tx, organizationId, opportunity.brandId, opportunity.companyId);
      const snapshot = await ProposalVersionService.buildSnapshotWithTx(tx, organizationId, proposalId);

      return {
        snapshot,
        status: proposal.status,
        creator: { displayName: creator.displayName, instagramHandle: creator.instagramHandle },
        clientName,
      };
    });
  },
};
