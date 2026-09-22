import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { proposals } from "@/db/schema/proposals";
import { runInTenantContext } from "./tenant-context";
import { ProposalNotFoundError } from "@/domain/proposals/errors";

export type Proposal = typeof proposals.$inferSelect;

export interface CreateProposalInput {
  opportunityId: string;
  title: string;
  template: Proposal["template"];
}

export interface UpdateProposalInput {
  title?: string;
  template?: Proposal["template"];
  status?: Proposal["status"];
}

async function insertProposal(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  input: CreateProposalInput,
): Promise<Proposal> {
  const [proposal] = await tx
    .insert(proposals)
    .values({
      organizationId,
      opportunityId: input.opportunityId,
      title: input.title,
      template: input.template,
    })
    .returning();
  return proposal;
}

async function selectProposalById(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  proposalId: string,
): Promise<Proposal | null> {
  const [proposal] = await tx
    .select()
    .from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)));
  return proposal ?? null;
}

async function updateProposal(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  proposalId: string,
  input: UpdateProposalInput,
): Promise<Proposal> {
  const [proposal] = await tx
    .update(proposals)
    .set(input)
    .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)))
    .returning();
  if (!proposal) {
    throw new ProposalNotFoundError(proposalId);
  }
  return proposal;
}

async function selectProposalsByOpportunity(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  opportunityId: string,
): Promise<Proposal[]> {
  return tx
    .select()
    .from(proposals)
    .where(and(eq(proposals.organizationId, organizationId), eq(proposals.opportunityId, opportunityId)));
}

export const ProposalsRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateProposalInput,
  ): Promise<Proposal> {
    return runInTenantContext(db, organizationId, (tx) => insertProposal(tx, organizationId, input));
  },

  async createWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateProposalInput,
  ): Promise<Proposal> {
    return insertProposal(tx, organizationId, input);
  },

  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<Proposal | null> {
    return runInTenantContext(db, organizationId, (tx) => selectProposalById(tx, organizationId, proposalId));
  },

  async findByIdWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<Proposal | null> {
    return selectProposalById(tx, organizationId, proposalId);
  },

  async update(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
    input: UpdateProposalInput,
  ): Promise<Proposal> {
    return runInTenantContext(db, organizationId, (tx) => updateProposal(tx, organizationId, proposalId, input));
  },

  async updateWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
    input: UpdateProposalInput,
  ): Promise<Proposal> {
    return updateProposal(tx, organizationId, proposalId, input);
  },

  async listByOpportunity(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    opportunityId: string,
  ): Promise<Proposal[]> {
    return runInTenantContext(db, organizationId, (tx) =>
      selectProposalsByOpportunity(tx, organizationId, opportunityId),
    );
  },

  async listByOpportunityWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    opportunityId: string,
  ): Promise<Proposal[]> {
    return selectProposalsByOpportunity(tx, organizationId, opportunityId);
  },
};
