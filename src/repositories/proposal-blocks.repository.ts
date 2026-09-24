import { and, asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { proposalBlocks } from "@/db/schema/proposals";
import { runInTenantContext } from "./tenant-context";
import { ProposalBlockNotFoundError } from "@/domain/proposals/errors";

export type ProposalBlock = typeof proposalBlocks.$inferSelect;

export interface CreateProposalBlockInput {
  proposalId: string;
  blockType: ProposalBlock["blockType"];
  content: unknown;
  sortOrder?: number;
}

export interface UpdateProposalBlockInput {
  content?: unknown;
  sortOrder?: number;
}

async function insertProposalBlock(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  input: CreateProposalBlockInput,
): Promise<ProposalBlock> {
  const [block] = await tx
    .insert(proposalBlocks)
    .values({
      organizationId,
      proposalId: input.proposalId,
      blockType: input.blockType,
      content: input.content,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();
  return block;
}

async function updateProposalBlock(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  blockId: string,
  proposalId: string,
  input: UpdateProposalBlockInput,
): Promise<ProposalBlock> {
  const [block] = await tx
    .update(proposalBlocks)
    .set(input)
    .where(
      and(
        eq(proposalBlocks.id, blockId),
        eq(proposalBlocks.organizationId, organizationId),
        eq(proposalBlocks.proposalId, proposalId),
      ),
    )
    .returning();
  if (!block) {
    throw new ProposalBlockNotFoundError(blockId, proposalId);
  }
  return block;
}

async function removeProposalBlock(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  blockId: string,
  proposalId: string,
): Promise<void> {
  const [block] = await tx
    .delete(proposalBlocks)
    .where(
      and(
        eq(proposalBlocks.id, blockId),
        eq(proposalBlocks.organizationId, organizationId),
        eq(proposalBlocks.proposalId, proposalId),
      ),
    )
    .returning();
  if (!block) {
    throw new ProposalBlockNotFoundError(blockId, proposalId);
  }
}

async function selectProposalBlocksByProposal(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  proposalId: string,
): Promise<ProposalBlock[]> {
  return tx
    .select()
    .from(proposalBlocks)
    .where(and(eq(proposalBlocks.organizationId, organizationId), eq(proposalBlocks.proposalId, proposalId)))
    .orderBy(asc(proposalBlocks.sortOrder), asc(proposalBlocks.createdAt));
}

export const ProposalBlocksRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateProposalBlockInput,
  ): Promise<ProposalBlock> {
    return runInTenantContext(db, organizationId, (tx) => insertProposalBlock(tx, organizationId, input));
  },

  async createWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateProposalBlockInput,
  ): Promise<ProposalBlock> {
    return insertProposalBlock(tx, organizationId, input);
  },

  async update(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    blockId: string,
    proposalId: string,
    input: UpdateProposalBlockInput,
  ): Promise<ProposalBlock> {
    return runInTenantContext(db, organizationId, (tx) =>
      updateProposalBlock(tx, organizationId, blockId, proposalId, input),
    );
  },

  async updateWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    blockId: string,
    proposalId: string,
    input: UpdateProposalBlockInput,
  ): Promise<ProposalBlock> {
    return updateProposalBlock(tx, organizationId, blockId, proposalId, input);
  },

  async remove(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    blockId: string,
    proposalId: string,
  ): Promise<void> {
    await runInTenantContext(db, organizationId, (tx) =>
      removeProposalBlock(tx, organizationId, blockId, proposalId),
    );
  },

  async removeWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    blockId: string,
    proposalId: string,
  ): Promise<void> {
    return removeProposalBlock(tx, organizationId, blockId, proposalId);
  },

  async listByProposal(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<ProposalBlock[]> {
    return runInTenantContext(db, organizationId, (tx) =>
      selectProposalBlocksByProposal(tx, organizationId, proposalId),
    );
  },

  async listByProposalWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<ProposalBlock[]> {
    return selectProposalBlocksByProposal(tx, organizationId, proposalId);
  },
};
