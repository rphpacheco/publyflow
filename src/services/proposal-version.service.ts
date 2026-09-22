import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import {
  ProposalVersionsRepository,
  type ProposalVersion,
} from "@/repositories/proposal-versions.repository";
import { ProposalsRepository } from "@/repositories/proposals.repository";
import { ProposalItemsRepository, type ProposalItem } from "@/repositories/proposal-items.repository";
import { ProposalBlocksRepository, type ProposalBlock } from "@/repositories/proposal-blocks.repository";
import { ProposalNotFoundError } from "@/domain/proposals/errors";

export interface ProposalSnapshot {
  proposal: { title: string; template: string; status: string };
  items: ProposalItem[];
  blocks: ProposalBlock[];
}

async function buildSnapshotWithTx(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  proposalId: string,
): Promise<ProposalSnapshot> {
  const proposal = await ProposalsRepository.findByIdWithTx(tx, organizationId, proposalId);
  if (!proposal) {
    throw new ProposalNotFoundError(proposalId);
  }
  const items = await ProposalItemsRepository.listByProposalWithTx(tx, organizationId, proposalId);
  const blocks = await ProposalBlocksRepository.listByProposalWithTx(tx, organizationId, proposalId);
  return {
    proposal: { title: proposal.title, template: proposal.template, status: proposal.status },
    items,
    blocks,
  };
}

export const ProposalVersionService = {
  async createVersionWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
    createdBy: string,
  ): Promise<ProposalVersion> {
    const snapshot = await buildSnapshotWithTx(tx, organizationId, proposalId);
    const existingCount = await ProposalVersionsRepository.countByProposalWithTx(
      tx,
      organizationId,
      proposalId,
    );
    return ProposalVersionsRepository.insertWithTx(
      tx,
      organizationId,
      proposalId,
      existingCount + 1,
      snapshot,
      createdBy,
    );
  },

  async listByProposal(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<ProposalVersion[]> {
    return ProposalVersionsRepository.listByProposal(db, organizationId, proposalId);
  },
};
