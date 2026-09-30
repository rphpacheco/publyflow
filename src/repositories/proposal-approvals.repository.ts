import { and, desc, eq, isNull, max } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { proposalApprovals, proposals } from "@/db/schema/proposals";
import { opportunities } from "@/db/schema/commercial-flow";
import { creators } from "@/db/schema/creators";
import { organizationMembers, users } from "@/db/schema/organizations";

export type ProposalApproval = typeof proposalApprovals.$inferSelect;
export type ApprovalDecision = NonNullable<ProposalApproval["decision"]>;

export interface CreatorAccessForProposal {
  creatorId: string;
  creatorUserId: string;
  creatorDisplayName: string;
  hasAccess: boolean;
}

export const ProposalApprovalsRepository = {
  /** Caller must hold the proposal row lock (numbers are max + 1). */
  async insertWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: { proposalId: string; versionId: string; versionNumber: number; requestedBy: string },
  ): Promise<ProposalApproval> {
    const [{ current }] = await tx
      .select({ current: max(proposalApprovals.requestNumber) })
      .from(proposalApprovals)
      .where(and(eq(proposalApprovals.proposalId, input.proposalId), eq(proposalApprovals.organizationId, organizationId)));
    const [approval] = await tx
      .insert(proposalApprovals)
      .values({ organizationId, requestNumber: (current ?? 0) + 1, ...input })
      .returning();
    return approval;
  },

  async findLatestWithTx(tx: NodePgDatabase<typeof schema>, organizationId: string, proposalId: string): Promise<ProposalApproval | null> {
    const [approval] = await tx
      .select()
      .from(proposalApprovals)
      .where(and(eq(proposalApprovals.proposalId, proposalId), eq(proposalApprovals.organizationId, organizationId)))
      .orderBy(desc(proposalApprovals.requestNumber))
      .limit(1);
    return approval ?? null;
  },

  async findLatestWithRequesterWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<{ approval: ProposalApproval; requestedByName: string } | null> {
    const [row] = await tx
      .select({ approval: proposalApprovals, requestedByName: users.fullName })
      .from(proposalApprovals)
      .innerJoin(users, eq(users.id, proposalApprovals.requestedBy))
      .where(and(eq(proposalApprovals.proposalId, proposalId), eq(proposalApprovals.organizationId, organizationId)))
      .orderBy(desc(proposalApprovals.requestNumber))
      .limit(1);
    return row ?? null;
  },

  /** Written once: returns null when the request was already decided. */
  async decideWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    approvalId: string,
    input: { decision: ApprovalDecision; decidedBy: string; decidedAt: Date; message: string | null },
  ): Promise<ProposalApproval | null> {
    const [approval] = await tx
      .update(proposalApprovals)
      .set(input)
      .where(
        and(eq(proposalApprovals.id, approvalId), eq(proposalApprovals.organizationId, organizationId), isNull(proposalApprovals.decision)),
      )
      .returning();
    return approval ?? null;
  },

  /** The proposal's creator and whether it holds a CREATOR membership in this organization (spec D §4.1). */
  async creatorAccessForProposalWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<CreatorAccessForProposal | null> {
    const [row] = await tx
      .select({
        creatorId: creators.id,
        creatorUserId: creators.userId,
        creatorDisplayName: creators.displayName,
        membershipUserId: organizationMembers.userId,
      })
      .from(proposals)
      .innerJoin(opportunities, and(eq(opportunities.id, proposals.opportunityId), eq(opportunities.organizationId, organizationId)))
      .innerJoin(creators, and(eq(creators.id, opportunities.creatorId), eq(creators.organizationId, organizationId)))
      .leftJoin(
        organizationMembers,
        and(
          eq(organizationMembers.userId, creators.userId),
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.role, "CREATOR"),
        ),
      )
      .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId)));
    if (!row) return null;
    return {
      creatorId: row.creatorId,
      creatorUserId: row.creatorUserId,
      creatorDisplayName: row.creatorDisplayName,
      hasAccess: row.membershipUserId !== null,
    };
  },
};
