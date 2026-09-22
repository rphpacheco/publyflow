import { and, count, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { proposalVersions } from "@/db/schema/proposals";
import { runInTenantContext } from "./tenant-context";
import { ProposalsRepository } from "./proposals.repository";
import { ProposalItemsRepository, type ProposalItem } from "./proposal-items.repository";
import { ProposalBlocksRepository, type ProposalBlock } from "./proposal-blocks.repository";
import { ProposalNotFoundError } from "@/domain/proposals/errors";

export type ProposalVersion = typeof proposalVersions.$inferSelect;

export interface ProposalSnapshot {
  proposal: { title: string; template: string; status: string };
  items: ProposalItem[];
  blocks: ProposalBlock[];
}

export const ProposalVersionsRepository = {
  async buildSnapshotWithTx(
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
  },

  async createVersionWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
    createdBy: string,
  ): Promise<ProposalVersion> {
    const snapshot = await ProposalVersionsRepository.buildSnapshotWithTx(tx, organizationId, proposalId);

    const [{ value: existingCount }] = await tx
      .select({ value: count() })
      .from(proposalVersions)
      .where(and(eq(proposalVersions.proposalId, proposalId), eq(proposalVersions.organizationId, organizationId)));

    const [version] = await tx
      .insert(proposalVersions)
      .values({
        organizationId,
        proposalId,
        versionNumber: existingCount + 1,
        snapshotJson: snapshot,
        createdBy,
      })
      .returning();
    return version;
  },

  async listByProposal(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<ProposalVersion[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      return tx
        .select()
        .from(proposalVersions)
        .where(and(eq(proposalVersions.organizationId, organizationId), eq(proposalVersions.proposalId, proposalId)));
    });
  },
};
