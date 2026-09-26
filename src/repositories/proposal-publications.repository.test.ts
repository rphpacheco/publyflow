import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { runInTenantContext } from "./tenant-context";
import { ProposalsRepository } from "./proposals.repository";
import { ProposalVersionsRepository } from "./proposal-versions.repository";
import { ProposalPublicationsRepository } from "./proposal-publications.repository";
import { ProposalResponsesRepository } from "./proposal-responses.repository";

const context = {
  creator: { displayName: "Thais", instagramHandle: "@thais" },
  clientName: "Bella Cosméticos",
  issuedAt: "2026-09-25T15:00:00.000Z",
};

describe("publication repositories", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("numbers publications per proposal, finds the latest and lists them with responses", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const orgId = organization.id;

    const result = await runInTenantContext(db, orgId, async (tx) => {
      const locked = await ProposalsRepository.lockByIdWithTx(tx, orgId, proposal.id);
      const version = await ProposalVersionsRepository.findLatestWithTx(tx, orgId, proposal.id);
      const first = await ProposalPublicationsRepository.insertWithTx(tx, orgId, {
        proposalId: proposal.id,
        versionId: version!.id,
        versionNumber: version!.versionNumber,
        context,
        publishedBy: owner.id,
        publishedAt: new Date("2026-09-25T15:00:00Z"),
      });
      const response = await ProposalResponsesRepository.insertWithTx(tx, orgId, {
        publicationId: first.id,
        action: "REQUEST_CHANGES",
        respondentName: "Maria",
        respondentEmail: "maria@x.test",
        message: "Trocar stories",
      });
      const second = await ProposalPublicationsRepository.insertWithTx(tx, orgId, {
        proposalId: proposal.id,
        versionId: version!.id,
        versionNumber: version!.versionNumber,
        context,
        publishedBy: owner.id,
        publishedAt: new Date("2026-09-25T15:00:00Z"),
      });
      return {
        locked,
        version,
        first,
        second,
        response,
        latest: await ProposalPublicationsRepository.findLatestWithTx(tx, orgId, proposal.id),
        foundFirst: await ProposalPublicationsRepository.findForProposalWithTx(tx, orgId, proposal.id, first.id),
        foundResponse: await ProposalResponsesRepository.findByPublicationWithTx(tx, orgId, first.id),
        history: await ProposalPublicationsRepository.listWithResponsesWithTx(tx, orgId, proposal.id),
      };
    });

    expect(result.locked?.id).toBe(proposal.id);
    expect(result.version?.versionNumber).toBe(1);
    expect(result.first.publicationNumber).toBe(1);
    expect(result.second.publicationNumber).toBe(2);
    expect(result.latest?.id).toBe(result.second.id);
    expect(result.foundFirst?.id).toBe(result.first.id);
    expect(result.foundResponse?.id).toBe(result.response.id);
    expect(result.history.map((entry) => [entry.publication.publicationNumber, entry.response?.action ?? null])).toEqual([
      [2, null],
      [1, "REQUEST_CHANGES"],
    ]);
  });

  it("never finds a publication through another proposal", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const b = await seedProposal(db);

    const publicationOfB = await runInTenantContext(db, b.organization.id, async (tx) => {
      const version = await ProposalVersionsRepository.findLatestWithTx(tx, b.organization.id, b.proposal.id);
      return ProposalPublicationsRepository.insertWithTx(tx, b.organization.id, {
        proposalId: b.proposal.id,
        versionId: version!.id,
        versionNumber: 1,
        context,
        publishedBy: b.owner.id,
        publishedAt: new Date(),
      });
    });

    const found = await runInTenantContext(db, a.organization.id, (tx) =>
      ProposalPublicationsRepository.findForProposalWithTx(tx, a.organization.id, a.proposal.id, publicationOfB.id),
    );
    expect(found).toBeNull();
  });

  it("finds a proposal by its public token and updates status and token without a version", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, proposal } = await seedProposal(db);
    const token = "T".repeat(43);

    await runInTenantContext(db, organization.id, async (tx) => {
      await ProposalsRepository.setPublicTokenWithTx(tx, organization.id, proposal.id, token);
      await ProposalsRepository.setStatusWithTx(tx, organization.id, proposal.id, "SENT");
    });

    const found = await ProposalsRepository.findByPublicToken(db, token);
    expect(found?.id).toBe(proposal.id);
    expect(found?.status).toBe("SENT");
    expect(await ProposalsRepository.findByPublicToken(db, "U".repeat(43))).toBeNull();
    const versions = await ProposalVersionsRepository.listByProposal(db, organization.id, proposal.id);
    expect(versions).toHaveLength(1);
  });
});
