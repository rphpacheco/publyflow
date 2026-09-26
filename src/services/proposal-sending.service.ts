import { randomBytes } from "node:crypto";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalsRepository } from "@/repositories/proposals.repository";
import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";
import { ProposalPublicationsRepository, type ProposalPublication } from "@/repositories/proposal-publications.repository";
import { ProposalResponsesRepository, type ProposalResponse } from "@/repositories/proposal-responses.repository";
import { OpportunitiesRepository } from "@/repositories/opportunities.repository";
import { assertMember } from "./proposal.service";
import { loadPresentationPartiesWithTx } from "./proposal-presentation.service";
import { moveOpportunityIfOpenWithTx } from "./proposal-pipeline";
import { toPublicationContextJson } from "@/lib/presentation/snapshot-schema";
import { publicPathFor, SENT_STAGE } from "@/lib/proposal-sharing";
import { PUBLIC_PROPOSAL_STATUSES, type ProposalStatus } from "@/lib/proposal-themes";
import { OpportunityNotFoundError, ProposalArchivedError, ProposalNotFoundError } from "@/domain/proposals/errors";

export function generatePublicToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Spec §2/§5.2. `canSend` informs the UI; publish() is the authority. */
export function computeSendFlags(input: {
  status: ProposalStatus;
  latestVersionNumber: number;
  latestPublicationVersionNumber: number | null;
}): { hasUnsentChanges: boolean; canSend: boolean } {
  const hasUnsentChanges =
    input.latestPublicationVersionNumber === null || input.latestVersionNumber !== input.latestPublicationVersionNumber;
  const canSend = input.status !== "ARCHIVED" && (input.status === "DRAFT" || hasUnsentChanges);
  return { hasUnsentChanges, canSend };
}

export interface SendStateResponse {
  action: ProposalResponse["action"];
  respondentName: string;
  respondentEmail: string;
  message: string | null;
  respondedAt: Date;
}

export interface SendState {
  status: ProposalStatus;
  publicPath: string | null;
  latestPublication: { id: string; versionNumber: number; publishedAt: Date; response: SendStateResponse | null } | null;
  latestVersionNumber: number;
  hasUnsentChanges: boolean;
  canSend: boolean;
}

export interface PublicationHistoryItem {
  id: string;
  publicationNumber: number;
  versionNumber: number;
  publishedAt: Date;
  response: SendStateResponse | null;
}

function toResponseView(response: ProposalResponse | null): SendStateResponse | null {
  if (!response) return null;
  return {
    action: response.action,
    respondentName: response.respondentName,
    respondentEmail: response.respondentEmail,
    message: response.message,
    respondedAt: response.respondedAt,
  };
}

export const ProposalSendingService = {
  async publish(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
    userId: string,
  ): Promise<{ publication: ProposalPublication; publicPath: string; created: boolean }> {
    return runInTenantContext(db, organizationId, async (tx) => {
      await assertMember(tx, organizationId, userId);

      const proposal = await ProposalsRepository.lockByIdWithTx(tx, organizationId, proposalId);
      if (!proposal) throw new ProposalNotFoundError(proposalId);
      if (proposal.status === "ARCHIVED") throw new ProposalArchivedError(proposalId);

      const token = proposal.publicToken ?? generatePublicToken();
      if (!proposal.publicToken) {
        await ProposalsRepository.setPublicTokenWithTx(tx, organizationId, proposalId, token);
      }

      const latestVersion = await ProposalVersionsRepository.findLatestWithTx(tx, organizationId, proposalId);
      if (!latestVersion) throw new ProposalNotFoundError(proposalId);
      const latestPublication = await ProposalPublicationsRepository.findLatestWithTx(tx, organizationId, proposalId);

      // Idempotent (also under concurrency: the second caller waits on the
      // row lock and then sees the version already published).
      if (
        proposal.status !== "DRAFT" &&
        latestPublication &&
        latestPublication.versionNumber === latestVersion.versionNumber
      ) {
        return { publication: latestPublication, publicPath: publicPathFor(token), created: false };
      }

      const opportunity = await OpportunitiesRepository.findByIdWithTx(tx, organizationId, proposal.opportunityId);
      if (!opportunity) throw new OpportunityNotFoundError(proposal.opportunityId);
      const parties = await loadPresentationPartiesWithTx(tx, organizationId, opportunity);
      if (!parties) throw new OpportunityNotFoundError(proposal.opportunityId);

      const publishedAt = new Date();
      const publication = await ProposalPublicationsRepository.insertWithTx(tx, organizationId, {
        proposalId,
        versionId: latestVersion.id,
        versionNumber: latestVersion.versionNumber,
        context: toPublicationContextJson(parties, publishedAt),
        publishedBy: userId,
        publishedAt,
      });

      await ProposalsRepository.setStatusWithTx(tx, organizationId, proposalId, "SENT");
      await moveOpportunityIfOpenWithTx(tx, organizationId, proposal.opportunityId, SENT_STAGE);

      return { publication, publicPath: publicPathFor(token), created: true };
    });
  },

  /** One consistent read (REPEATABLE READ): proposal, latest version, latest publication, response. */
  async getSendState(db: NodePgDatabase<typeof schema>, organizationId: string, proposalId: string): Promise<SendState | null> {
    return runInTenantContext(
      db,
      organizationId,
      async (tx) => {
        const proposal = await ProposalsRepository.findByIdWithTx(tx, organizationId, proposalId);
        if (!proposal) return null;
        const latestVersion = await ProposalVersionsRepository.findLatestWithTx(tx, organizationId, proposalId);
        const latestPublication = await ProposalPublicationsRepository.findLatestWithTx(tx, organizationId, proposalId);
        const response = latestPublication
          ? await ProposalResponsesRepository.findByPublicationWithTx(tx, organizationId, latestPublication.id)
          : null;

        const status = proposal.status as ProposalStatus;
        const latestVersionNumber = latestVersion?.versionNumber ?? 0;
        const flags = computeSendFlags({
          status,
          latestVersionNumber,
          latestPublicationVersionNumber: latestPublication?.versionNumber ?? null,
        });

        return {
          status,
          publicPath:
            proposal.publicToken && PUBLIC_PROPOSAL_STATUSES.includes(status) ? publicPathFor(proposal.publicToken) : null,
          latestPublication: latestPublication
            ? {
                id: latestPublication.id,
                versionNumber: latestPublication.versionNumber,
                publishedAt: latestPublication.publishedAt,
                response: toResponseView(response),
              }
            : null,
          latestVersionNumber,
          ...flags,
        };
      },
      { isolationLevel: "repeatable read" },
    );
  },

  async listPublications(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    proposalId: string,
  ): Promise<PublicationHistoryItem[] | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const proposal = await ProposalsRepository.findByIdWithTx(tx, organizationId, proposalId);
      if (!proposal) return null;
      const rows = await ProposalPublicationsRepository.listWithResponsesWithTx(tx, organizationId, proposalId);
      return rows.map(({ publication, response }) => ({
        id: publication.id,
        publicationNumber: publication.publicationNumber,
        versionNumber: publication.versionNumber,
        publishedAt: publication.publishedAt,
        response: toResponseView(response),
      }));
    });
  },
};
