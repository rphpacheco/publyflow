import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { ProposalService } from "./proposal.service";
import { ProposalSendingService } from "./proposal-sending.service";
import { ProposalResponseService } from "./proposal-response.service";
import { PublicProposalService } from "./public-proposal.service";
import { creators } from "@/db/schema/creators";
import { proposalVersions } from "@/db/schema/proposals";

function tokenOf(publicPath: string) {
  return publicPath.replace("/p/", "");
}

describe("PublicProposalService.loadByToken", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("loads the latest publication with validated snapshot and frozen context", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, creator, proposal } = await seedProposal(db, { theme: "EDITORIAL" });
    const { publication, publicPath } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    await db.update(creators).set({ displayName: "Outro Nome" }).where(eq(creators.id, creator.id));

    const result = await PublicProposalService.loadByToken(db, tokenOf(publicPath));

    expect(result.state).toBe("available");
    if (result.state !== "available") return;
    expect(result.publicationId).toBe(publication.id);
    expect(result.title).toBe("Campanha Verão");
    expect(result.snapshot.proposal.theme).toBe("EDITORIAL");
    expect(result.context.creator.displayName).toBe("Thais");
    expect(result.context.clientName).toBe("Bella Cosméticos");
    expect(result.context.issuedAt).toBeInstanceOf(Date);
    expect(result.response).toBeNull();
  });

  it("shows the recorded response and follows the token to the newest publication", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const v1 = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    await ProposalResponseService.respond(db, tokenOf(v1.publicPath), {
      publicationId: v1.publication.id,
      action: "REQUEST_CHANGES",
      name: "Maria",
      email: "maria@x.test",
      message: "Trocar stories",
    });

    const answered = await PublicProposalService.loadByToken(db, tokenOf(v1.publicPath));
    expect(answered.state === "available" && answered.response?.message).toBe("Trocar stories");

    await ProposalService.update(db, organization.id, proposal.id, { title: "v2", userId: owner.id });
    const v2 = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    const next = await PublicProposalService.loadByToken(db, tokenOf(v1.publicPath));
    expect(next.state === "available" && next.publicationId).toBe(v2.publication.id);
    expect(next.state === "available" && next.response).toBeNull();
  });

  it("not_found for malformed or unknown tokens; unavailable without content for DRAFT/ARCHIVED", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const { publicPath } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);

    expect(await PublicProposalService.loadByToken(db, "abc")).toEqual({ state: "not_found" });
    expect(await PublicProposalService.loadByToken(db, "Q".repeat(43))).toEqual({ state: "not_found" });

    await ProposalService.update(db, organization.id, proposal.id, { status: "ARCHIVED", userId: owner.id });
    expect(await PublicProposalService.loadByToken(db, tokenOf(publicPath))).toEqual({ state: "unavailable" });
    await ProposalService.update(db, organization.id, proposal.id, { status: "DRAFT", userId: owner.id });
    expect(await PublicProposalService.loadByToken(db, tokenOf(publicPath))).toEqual({ state: "unavailable" });
  });

  it("accepts a legacy snapshot with `template` and rejects a corrupted one", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const { publication, publicPath } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);

    // Rewriting a version is only possible because proposal_versions has no
    // immutability trigger; this simulates rows stored before the rename.
    await db
      .update(proposalVersions)
      .set({ snapshotJson: { proposal: { title: "Antiga", template: "FASHION", status: "DRAFT" }, items: [], blocks: [] } })
      .where(eq(proposalVersions.id, publication.versionId));
    const legacy = await PublicProposalService.loadByToken(db, tokenOf(publicPath));
    expect(legacy.state === "available" && legacy.snapshot.proposal.template).toBe("FASHION");

    await db.update(proposalVersions).set({ snapshotJson: { broken: true } }).where(eq(proposalVersions.id, publication.versionId));
    await expect(PublicProposalService.loadByToken(db, tokenOf(publicPath))).rejects.toThrow();
  });
});
