import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalsRepository, type Proposal } from "@/repositories/proposals.repository";
import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";
import {
  ProposalApprovalsRepository,
  type ApprovalDecision,
  type CreatorAccessForProposal,
  type ProposalApproval,
} from "@/repositories/proposal-approvals.repository";
import { DomainEventsRepository } from "@/repositories/domain-events.repository";
import { assertMember } from "./proposal.service";
import { deriveApprovalState } from "@/lib/proposals/approval-state";
import { PROPOSAL_EVENT, proposalApprovalEvent } from "@/lib/events/proposal-events";
import {
  ApprovalNotRequiredError,
  ApprovalStaleError,
  NoPendingApprovalError,
  NotProposalCreatorError,
  ProposalArchivedError,
  ProposalNotFoundError,
} from "@/domain/proposals/errors";

type Tx = NodePgDatabase<typeof schema>;

/** Lock the proposal, then read everything the approval rules need (spec D §8). */
async function loadLocked(tx: Tx, organizationId: string, proposalId: string) {
  const proposal = await ProposalsRepository.lockByIdWithTx(tx, organizationId, proposalId);
  if (!proposal) throw new ProposalNotFoundError(proposalId);
  const latestVersion = await ProposalVersionsRepository.findLatestWithTx(tx, organizationId, proposalId);
  if (!latestVersion) throw new ProposalNotFoundError(proposalId);
  const access = await ProposalApprovalsRepository.creatorAccessForProposalWithTx(tx, organizationId, proposalId);
  if (!access) throw new ProposalNotFoundError(proposalId);
  const latest = await ProposalApprovalsRepository.findLatestWithTx(tx, organizationId, proposalId);
  return { proposal, latestVersion, access, latest };
}

function eventFor(
  eventType: Parameters<typeof proposalApprovalEvent>[0]["eventType"],
  proposal: Proposal,
  access: CreatorAccessForProposal,
  approval: ProposalApproval,
  userId: string,
) {
  return proposalApprovalEvent({
    eventType,
    proposalId: proposal.id,
    proposalTitle: proposal.title,
    opportunityId: proposal.opportunityId,
    versionNumber: approval.versionNumber,
    approvalId: approval.id,
    publicationId: null,
    creatorDisplayName: access.creatorDisplayName,
    userId,
  });
}

async function decide(
  db: Tx,
  organizationId: string,
  proposalId: string,
  userId: string,
  approvalId: string,
  decision: ApprovalDecision,
  message: string | null,
): Promise<ProposalApproval> {
  return runInTenantContext(db, organizationId, async (tx) => {
    const { proposal, latestVersion, access, latest } = await loadLocked(tx, organizationId, proposalId);
    if (access.creatorUserId !== userId) throw new NotProposalCreatorError();
    if (!latest || latest.decision !== null) throw new NoPendingApprovalError();
    // Must name the request it answers: a stale client (an older version of
    // the page) can only agree with the request it was shown, never with
    // whatever became latest in the meantime.
    if (latest.id !== approvalId || latest.versionNumber !== latestVersion.versionNumber) throw new ApprovalStaleError();

    const decided = await ProposalApprovalsRepository.decideWithTx(tx, organizationId, latest.id, {
      decision,
      decidedBy: userId,
      decidedAt: new Date(),
      message,
    });
    if (!decided) throw new NoPendingApprovalError();

    await DomainEventsRepository.appendWithTx(
      tx,
      organizationId,
      eventFor(
        decision === "APPROVED" ? PROPOSAL_EVENT.CREATOR_APPROVED : PROPOSAL_EVENT.CREATOR_CHANGES_REQUESTED,
        proposal,
        access,
        decided,
        userId,
      ),
    );
    return decided;
  });
}

export const ProposalApprovalService = {
  /** Spec D §4.3 — OWNER/MANAGER. */
  async request(db: Tx, organizationId: string, proposalId: string, userId: string): Promise<{ approval: ProposalApproval; created: boolean }> {
    return runInTenantContext(db, organizationId, async (tx) => {
      await assertMember(tx, organizationId, userId);
      const { proposal, latestVersion, access, latest } = await loadLocked(tx, organizationId, proposalId);
      if (proposal.status === "ARCHIVED") throw new ProposalArchivedError(proposalId);
      if (!access.hasAccess) throw new ApprovalNotRequiredError();

      const state = deriveApprovalState({ required: true, latestVersionNumber: latestVersion.versionNumber, latest });
      if (latest && (state === "pending" || state === "approved")) return { approval: latest, created: false };

      const approval = await ProposalApprovalsRepository.insertWithTx(tx, organizationId, {
        proposalId,
        versionId: latestVersion.id,
        versionNumber: latestVersion.versionNumber,
        requestedBy: userId,
      });
      await DomainEventsRepository.appendWithTx(tx, organizationId, eventFor(PROPOSAL_EVENT.APPROVAL_REQUESTED, proposal, access, approval, userId));
      return { approval, created: true };
    });
  },

  /** Spec D §4.4 — the owning CREATOR only. */
  async approve(
    db: Tx,
    organizationId: string,
    proposalId: string,
    userId: string,
    approvalId: string,
    message: string | null,
  ): Promise<ProposalApproval> {
    const trimmed = message?.trim() || null;
    return decide(db, organizationId, proposalId, userId, approvalId, "APPROVED", trimmed);
  },

  async requestChanges(
    db: Tx,
    organizationId: string,
    proposalId: string,
    userId: string,
    approvalId: string,
    message: string,
  ): Promise<ProposalApproval> {
    return decide(db, organizationId, proposalId, userId, approvalId, "CHANGES_REQUESTED", message.trim());
  },
};
