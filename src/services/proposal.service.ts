import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalsRepository, type Proposal, type CreateProposalInput, type UpdateProposalInput } from "@/repositories/proposals.repository";
import { ProposalVersionService } from "./proposal-version.service";
import { OpportunitiesRepository } from "@/repositories/opportunities.repository";
import { OrganizationMembersRepository } from "@/repositories/organization-members.repository";
import { UserNotOrganizationMemberError, OpportunityNotFoundError } from "@/domain/proposals/errors";

async function assertMember(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  userId: string,
): Promise<void> {
  const isMember = await OrganizationMembersRepository.existsForOrganizationWithTx(tx, organizationId, userId);
  if (!isMember) {
    throw new UserNotOrganizationMemberError(userId, organizationId);
  }
}

export interface CreateProposalServiceInput extends CreateProposalInput {
  userId: string;
}

export interface UpdateProposalServiceInput extends UpdateProposalInput {
  userId: string;
}

export const ProposalService = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateProposalServiceInput,
  ): Promise<Proposal> {
    return runInTenantContext(db, organizationId, async (tx) => {
      await assertMember(tx, organizationId, input.userId);

      const opportunity = await OpportunitiesRepository.findByIdWithTx(tx, organizationId, input.opportunityId);
      if (!opportunity) {
        throw new OpportunityNotFoundError(input.opportunityId);
      }

      const proposal = await ProposalsRepository.createWithTx(tx, organizationId, {
        opportunityId: input.opportunityId,
        title: input.title,
        template: input.template,
      });

      await ProposalVersionService.createVersionWithTx(tx, organizationId, proposal.id, input.userId);

      return proposal;
    });
  },

  async update(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
    input: UpdateProposalServiceInput,
  ): Promise<Proposal> {
    return runInTenantContext(db, organizationId, async (tx) => {
      await assertMember(tx, organizationId, input.userId);

      const before = await ProposalsRepository.findByIdWithTx(tx, organizationId, proposalId);
      const after = await ProposalsRepository.updateWithTx(tx, organizationId, proposalId, {
        title: input.title,
        template: input.template,
        status: input.status,
      });

      const changed =
        !before ||
        before.title !== after.title ||
        before.template !== after.template ||
        before.status !== after.status;

      if (changed) {
        await ProposalVersionService.createVersionWithTx(tx, organizationId, proposalId, input.userId);
      }

      return after;
    });
  },
};
