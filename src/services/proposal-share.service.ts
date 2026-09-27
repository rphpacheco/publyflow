import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalsRepository } from "@/repositories/proposals.repository";
import { OpportunitiesRepository } from "@/repositories/opportunities.repository";
import { CreatorsRepository } from "@/repositories/creators.repository";
import { leads } from "@/db/schema/commercial-flow";
import { contacts } from "@/db/schema/companies-brands-contacts";

export interface ShareInfo {
  proposalTitle: string;
  creatorName: string;
  contact: { name: string; phone: string | null; email: string | null } | null;
}

export const ProposalShareService = {
  async getShareInfo(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<ShareInfo | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const proposal = await ProposalsRepository.findByIdWithTx(tx, organizationId, proposalId);
      if (!proposal) return null;
      const opportunity = await OpportunitiesRepository.findByIdWithTx(tx, organizationId, proposal.opportunityId);
      if (!opportunity) return null;
      const creator = await CreatorsRepository.findByIdWithTx(tx, organizationId, opportunity.creatorId);
      const [row] = await tx
        .select({ name: contacts.fullName, phone: contacts.phone, email: contacts.email })
        .from(leads)
        .innerJoin(contacts, eq(contacts.id, leads.contactId))
        .where(and(eq(leads.id, opportunity.leadId), eq(leads.organizationId, organizationId)));
      return {
        proposalTitle: proposal.title,
        creatorName: creator?.displayName ?? "",
        contact: row ?? null,
      };
    });
  },
};
