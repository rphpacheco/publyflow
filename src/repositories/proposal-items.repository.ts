import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { proposalItems } from "@/db/schema/proposals";
import { runInTenantContext } from "./tenant-context";
import { ProposalItemNotFoundError } from "@/domain/proposals/errors";

export type ProposalItem = typeof proposalItems.$inferSelect;

export interface CreateProposalItemInput {
  proposalId: string;
  rateCardItemId: string | null;
  description: string;
  unitPrice: number;
  quantity?: number;
  sortOrder?: number;
}

export interface UpdateProposalItemInput {
  description?: string;
  unitPrice?: number;
  quantity?: number;
  sortOrder?: number;
}

async function insertProposalItem(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  input: CreateProposalItemInput,
): Promise<ProposalItem> {
  const [item] = await tx
    .insert(proposalItems)
    .values({
      organizationId,
      proposalId: input.proposalId,
      rateCardItemId: input.rateCardItemId,
      description: input.description,
      unitPrice: input.unitPrice,
      quantity: input.quantity ?? 1,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();
  return item;
}

async function updateProposalItem(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  itemId: string,
  proposalId: string,
  input: UpdateProposalItemInput,
): Promise<ProposalItem> {
  const [item] = await tx
    .update(proposalItems)
    .set(input)
    .where(
      and(
        eq(proposalItems.id, itemId),
        eq(proposalItems.organizationId, organizationId),
        eq(proposalItems.proposalId, proposalId),
      ),
    )
    .returning();
  if (!item) {
    throw new ProposalItemNotFoundError(itemId, proposalId);
  }
  return item;
}

async function removeProposalItem(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  itemId: string,
  proposalId: string,
): Promise<void> {
  const [item] = await tx
    .delete(proposalItems)
    .where(
      and(
        eq(proposalItems.id, itemId),
        eq(proposalItems.organizationId, organizationId),
        eq(proposalItems.proposalId, proposalId),
      ),
    )
    .returning();
  if (!item) {
    throw new ProposalItemNotFoundError(itemId, proposalId);
  }
}

async function selectProposalItemsByProposal(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  proposalId: string,
): Promise<ProposalItem[]> {
  return tx
    .select()
    .from(proposalItems)
    .where(and(eq(proposalItems.organizationId, organizationId), eq(proposalItems.proposalId, proposalId)));
}

export const ProposalItemsRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateProposalItemInput,
  ): Promise<ProposalItem> {
    return runInTenantContext(db, organizationId, (tx) => insertProposalItem(tx, organizationId, input));
  },

  async createWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateProposalItemInput,
  ): Promise<ProposalItem> {
    return insertProposalItem(tx, organizationId, input);
  },

  async update(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
    proposalId: string,
    input: UpdateProposalItemInput,
  ): Promise<ProposalItem> {
    return runInTenantContext(db, organizationId, (tx) =>
      updateProposalItem(tx, organizationId, itemId, proposalId, input),
    );
  },

  async updateWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
    proposalId: string,
    input: UpdateProposalItemInput,
  ): Promise<ProposalItem> {
    return updateProposalItem(tx, organizationId, itemId, proposalId, input);
  },

  async remove(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
    proposalId: string,
  ): Promise<void> {
    await runInTenantContext(db, organizationId, (tx) =>
      removeProposalItem(tx, organizationId, itemId, proposalId),
    );
  },

  async removeWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    itemId: string,
    proposalId: string,
  ): Promise<void> {
    return removeProposalItem(tx, organizationId, itemId, proposalId);
  },

  async listByProposal(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<ProposalItem[]> {
    return runInTenantContext(db, organizationId, (tx) =>
      selectProposalItemsByProposal(tx, organizationId, proposalId),
    );
  },

  async listByProposalWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<ProposalItem[]> {
    return selectProposalItemsByProposal(tx, organizationId, proposalId);
  },
};
