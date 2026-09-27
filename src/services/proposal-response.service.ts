import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalsRepository } from "@/repositories/proposals.repository";
import { ProposalPublicationsRepository } from "@/repositories/proposal-publications.repository";
import { ProposalResponsesRepository, type ProposalResponse } from "@/repositories/proposal-responses.repository";
import { moveOpportunityIfOpenWithTx } from "./proposal-pipeline";
import { isPublicTokenFormat, RESPONSE_STAGE, RESPONSE_STATUS } from "@/lib/proposal-sharing";
import { PUBLIC_PROPOSAL_STATUSES, type ProposalStatus } from "@/lib/proposal-themes";
import {
  ProposalUnavailableError,
  PublicProposalNotFoundError,
  PublicationAlreadyRespondedError,
  PublicationSupersededError,
} from "@/domain/proposals/errors";
import { DomainEventsRepository } from "@/repositories/domain-events.repository";
import { proposalResponseEvent } from "@/lib/events/proposal-events";

export interface RespondInput {
  publicationId: string;
  action: "ACCEPT" | "REQUEST_CHANGES" | "REJECT";
  name: string;
  email: string;
  message: string | null;
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
  return code === "23505";
}

export const ProposalResponseService = {
  /** Public, no session: token → proposal → latest publication, all inside one locked transaction. */
  async respond(db: NodePgDatabase<typeof schema>, token: string, input: RespondInput): Promise<ProposalResponse> {
    if (!isPublicTokenFormat(token)) throw new PublicProposalNotFoundError();
    const found = await ProposalsRepository.findByPublicToken(db, token);
    if (!found) throw new PublicProposalNotFoundError();
    const organizationId = found.organizationId;

    try {
      return await runInTenantContext(db, organizationId, async (tx) => {
        const proposal = await ProposalsRepository.lockByIdWithTx(tx, organizationId, found.id);
        if (!proposal || !PUBLIC_PROPOSAL_STATUSES.includes(proposal.status as ProposalStatus)) {
          throw new ProposalUnavailableError();
        }

        const latest = await ProposalPublicationsRepository.findLatestWithTx(tx, organizationId, proposal.id);
        if (!latest || latest.id !== input.publicationId) throw new PublicationSupersededError();

        const existing = await ProposalResponsesRepository.findByPublicationWithTx(tx, organizationId, latest.id);
        if (existing) throw new PublicationAlreadyRespondedError();

        const response = await ProposalResponsesRepository.insertWithTx(tx, organizationId, {
          publicationId: latest.id,
          action: input.action,
          respondentName: input.name,
          respondentEmail: input.email,
          message: input.message,
        });
        await DomainEventsRepository.appendWithTx(
          tx,
          organizationId,
          proposalResponseEvent({
            proposalId: proposal.id,
            proposalTitle: proposal.title,
            publicationId: latest.id,
            versionNumber: latest.versionNumber,
            opportunityId: proposal.opportunityId,
            action: input.action,
            respondentName: input.name,
            message: input.message,
          }),
        );
        await ProposalsRepository.setStatusWithTx(tx, organizationId, proposal.id, RESPONSE_STATUS[input.action]);
        await moveOpportunityIfOpenWithTx(tx, organizationId, proposal.opportunityId, RESPONSE_STAGE[input.action]);
        return response;
      });
    } catch (error) {
      // Belt and braces: the unique publication_id also rejects a race.
      if (isUniqueViolation(error)) throw new PublicationAlreadyRespondedError();
      throw error;
    }
  },
};
