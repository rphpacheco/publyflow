import { expect } from "vitest";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalsRepository } from "@/repositories/proposals.repository";
import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";
import { ProposalPublicationsRepository } from "@/repositories/proposal-publications.repository";
import { ProposalResponsesRepository } from "@/repositories/proposal-responses.repository";

const EXPECTED_ACTION = { CHANGES_REQUESTED: "REQUEST_CHANGES", APPROVED: "ACCEPT", REJECTED: "REJECT" } as const;

/** Spec §2 invariants 1–4 for one proposal. */
export async function expectProposalInvariants(db: NodePgDatabase<typeof schema>, organizationId: string, proposalId: string) {
  await runInTenantContext(db, organizationId, async (tx) => {
    const proposal = await ProposalsRepository.findByIdWithTx(tx, organizationId, proposalId);
    expect(proposal).not.toBeNull();
    const latestVersion = await ProposalVersionsRepository.findLatestWithTx(tx, organizationId, proposalId);
    const latest = await ProposalPublicationsRepository.findLatestWithTx(tx, organizationId, proposalId);
    const response = latest ? await ProposalResponsesRepository.findByPublicationWithTx(tx, organizationId, latest.id) : null;
    const status = proposal!.status;

    if (["SENT", "CHANGES_REQUESTED", "APPROVED", "REJECTED"].includes(status)) {
      expect(latest, `status ${status} requires a publication`).not.toBeNull();
    }
    if (status === "SENT") {
      expect(response, "SENT requires the latest publication to be unanswered").toBeNull();
    }
    if (status === "CHANGES_REQUESTED" || status === "APPROVED" || status === "REJECTED") {
      expect(response?.action).toBe(EXPECTED_ACTION[status]);
    }
    if (latest) {
      expect(latest.versionNumber).toBeLessThanOrEqual(latestVersion!.versionNumber);
    }
  });
}
