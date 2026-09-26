import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalsRepository } from "@/repositories/proposals.repository";
import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";
import { ProposalPublicationsRepository } from "@/repositories/proposal-publications.repository";
import { ProposalResponsesRepository } from "@/repositories/proposal-responses.repository";
import { isPublicTokenFormat } from "@/lib/proposal-sharing";
import { PUBLIC_PROPOSAL_STATUSES, type ProposalStatus } from "@/lib/proposal-themes";
import { parsePresentationSnapshot, parsePublicationContext, type PublicationContext } from "@/lib/presentation/snapshot-schema";
import type { PresentationSnapshotInput } from "@/lib/presentation/types";

export type PublicProposalResult =
  | { state: "not_found" }
  | { state: "unavailable" }
  | {
      state: "available";
      title: string;
      publicationId: string;
      versionNumber: number;
      publishedAt: Date;
      snapshot: PresentationSnapshotInput;
      context: PublicationContext;
      response: {
        action: "ACCEPT" | "REQUEST_CHANGES" | "REJECT";
        respondentName: string;
        respondedAt: Date;
        message: string | null;
      } | null;
    };

export const PublicProposalService = {
  async loadByToken(db: NodePgDatabase<typeof schema>, token: string): Promise<PublicProposalResult> {
    if (!isPublicTokenFormat(token)) return { state: "not_found" };
    const proposal = await ProposalsRepository.findByPublicToken(db, token);
    if (!proposal) return { state: "not_found" };
    if (!PUBLIC_PROPOSAL_STATUSES.includes(proposal.status as ProposalStatus)) return { state: "unavailable" };

    const organizationId = proposal.organizationId;
    return runInTenantContext(db, organizationId, async (tx) => {
      const publication = await ProposalPublicationsRepository.findLatestWithTx(tx, organizationId, proposal.id);
      if (!publication) return { state: "unavailable" } as const;
      const version = await ProposalVersionsRepository.findByIdWithTx(tx, organizationId, publication.versionId);
      if (!version) throw new Error(`Publication ${publication.id} points to a missing version`);
      const response = await ProposalResponsesRepository.findByPublicationWithTx(tx, organizationId, publication.id);

      // Throws on corrupted stored data: a server error, never a half-rendered page.
      const snapshot = parsePresentationSnapshot(version.snapshotJson);
      const context = parsePublicationContext(publication.context);

      return {
        state: "available" as const,
        title: snapshot.proposal.title,
        publicationId: publication.id,
        versionNumber: publication.versionNumber,
        publishedAt: publication.publishedAt,
        snapshot,
        context,
        response: response
          ? {
              action: response.action,
              respondentName: response.respondentName,
              respondedAt: response.respondedAt,
              message: response.message,
            }
          : null,
      };
    });
  },
};
