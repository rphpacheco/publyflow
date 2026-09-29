import { and, eq, exists, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { proposals } from "@/db/schema/proposals";
import { opportunities } from "@/db/schema/commercial-flow";
import { runInTenantContext } from "./tenant-context";
import { ProposalNotFoundError } from "@/domain/proposals/errors";

export type Proposal = typeof proposals.$inferSelect;

export interface CreateProposalInput {
  opportunityId: string;
  title: string;
  theme: Proposal["theme"];
}

export interface UpdateProposalInput {
  title?: string;
  theme?: Proposal["theme"];
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
      theme: input.theme,
    })
    .returning();
  return proposal;
}

async function selectProposalById(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  proposalId: string,
  creatorScope: string | null = null,
): Promise<Proposal | null> {
  const conditions = [eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)];
  if (creatorScope !== null) {
    conditions.push(
      exists(
        tx
          .select({ one: sql`1` })
          .from(opportunities)
          .where(
            and(
              eq(opportunities.id, proposals.opportunityId),
              eq(opportunities.organizationId, organizationId),
              eq(opportunities.creatorId, creatorScope),
            ),
          ),
      ),
    );
  }
  const [proposal] = await tx.select().from(proposals).where(and(...conditions));
  return proposal ?? null;
}

async function selectCreatorIdForProposal(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  proposalId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ creatorId: opportunities.creatorId })
    .from(proposals)
    .innerJoin(
      opportunities,
      and(eq(opportunities.id, proposals.opportunityId), eq(opportunities.organizationId, organizationId)),
    )
    .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)));
  return row?.creatorId ?? null;
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
    creatorScope: string | null = null,
  ): Promise<Proposal | null> {
    return runInTenantContext(db, organizationId, (tx) =>
      selectProposalById(tx, organizationId, proposalId, creatorScope),
    );
  },

  async creatorIdForProposal(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<string | null> {
    return runInTenantContext(db, organizationId, (tx) =>
      selectCreatorIdForProposal(tx, organizationId, proposalId),
    );
  },

  async isInCreatorScope(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
    creatorScope: string | null,
  ): Promise<boolean> {
    const owner = await ProposalsRepository.creatorIdForProposal(db, organizationId, proposalId);
    if (owner === null) return false;
    return creatorScope === null || owner === creatorScope;
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

  /** Row lock: serializes publish/respond on the same proposal. */
  async lockByIdWithTx(tx: NodePgDatabase<typeof schema>, organizationId: string, proposalId: string): Promise<Proposal | null> {
    const [proposal] = await tx
      .select()
      .from(proposals)
      .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)))
      .for("update");
    return proposal ?? null;
  },

  /** Commercial status change from sending/responding: never creates a version. */
  async setStatusWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
    status: Proposal["status"],
  ): Promise<Proposal> {
    return updateProposal(tx, organizationId, proposalId, { status });
  },

  async setPublicTokenWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
    token: string,
  ): Promise<Proposal> {
    const [proposal] = await tx
      .update(proposals)
      .set({ publicToken: token })
      .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)))
      .returning();
    if (!proposal) throw new ProposalNotFoundError(proposalId);
    return proposal;
  },

  /**
   * The only lookup without an organization from a session: the public link
   * derives the organization from the proposal it finds. Today the app
   * connects as a superuser so RLS does not filter this; the RLS hardening
   * subproject must give this lookup an explicit privileged path.
   */
  async findByPublicToken(db: NodePgDatabase<typeof schema>, token: string): Promise<Proposal | null> {
    const [proposal] = await db.select().from(proposals).where(eq(proposals.publicToken, token));
    return proposal ?? null;
  },
};
