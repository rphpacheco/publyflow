import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalsRepository } from "@/repositories/proposals.repository";
import {
  ProposalBlocksRepository,
  type ProposalBlock,
  type CreateProposalBlockInput,
  type UpdateProposalBlockInput,
} from "@/repositories/proposal-blocks.repository";
import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";
import { OrganizationMembersRepository } from "@/repositories/organization-members.repository";
import { ProposalNotFoundError, UserNotOrganizationMemberError } from "@/domain/proposals/errors";

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

export interface AddProposalBlockInput extends CreateProposalBlockInput {
  userId: string;
}

export interface UpdateProposalBlockServiceInput extends UpdateProposalBlockInput {
  userId: string;
}

function contentEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const ProposalBlockService = {
  async addBlock(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: AddProposalBlockInput,
  ): Promise<ProposalBlock> {
    return runInTenantContext(db, organizationId, async (tx) => {
      await assertMember(tx, organizationId, input.userId);

      const proposal = await ProposalsRepository.findByIdWithTx(tx, organizationId, input.proposalId);
      if (!proposal) {
        throw new ProposalNotFoundError(input.proposalId);
      }

      const block = await ProposalBlocksRepository.createWithTx(tx, organizationId, {
        proposalId: input.proposalId,
        blockType: input.blockType,
        content: input.content,
        sortOrder: input.sortOrder,
      });

      await ProposalVersionsRepository.createVersionWithTx(tx, organizationId, input.proposalId, input.userId);

      return block;
    });
  },

  async updateBlock(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    blockId: string,
    proposalId: string,
    input: UpdateProposalBlockServiceInput,
  ): Promise<ProposalBlock> {
    return runInTenantContext(db, organizationId, async (tx) => {
      await assertMember(tx, organizationId, input.userId);

      const blocks = await ProposalBlocksRepository.listByProposalWithTx(tx, organizationId, proposalId);
      const before = blocks.find((row) => row.id === blockId) ?? null;

      const after = await ProposalBlocksRepository.updateWithTx(tx, organizationId, blockId, proposalId, {
        content: input.content,
        sortOrder: input.sortOrder,
      });

      const changed =
        !before || !contentEqual(before.content, after.content) || before.sortOrder !== after.sortOrder;

      if (changed) {
        await ProposalVersionsRepository.createVersionWithTx(tx, organizationId, proposalId, input.userId);
      }

      return after;
    });
  },

  async removeBlock(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    blockId: string,
    proposalId: string,
    userId: string,
  ): Promise<void> {
    await runInTenantContext(db, organizationId, async (tx) => {
      await assertMember(tx, organizationId, userId);
      await ProposalBlocksRepository.removeWithTx(tx, organizationId, blockId, proposalId);
      await ProposalVersionsRepository.createVersionWithTx(tx, organizationId, proposalId, userId);
    });
  },
};
