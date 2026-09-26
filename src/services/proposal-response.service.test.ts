import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { expectProposalInvariants } from "@/test/helpers/proposal-invariants";
import { ProposalService } from "./proposal.service";
import { ProposalSendingService } from "./proposal-sending.service";
import { ProposalResponseService } from "./proposal-response.service";
import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";
import {
  ProposalUnavailableError,
  PublicProposalNotFoundError,
  PublicationAlreadyRespondedError,
  PublicationSupersededError,
} from "@/domain/proposals/errors";
import { opportunities } from "@/db/schema/commercial-flow";

function tokenOf(publicPath: string) {
  return publicPath.replace("/p/", "");
}

const maria = { name: "Maria Fernandes", email: "maria@bella.test" };

describe("ProposalResponseService.respond", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it.each([
    ["ACCEPT", "APPROVED", "FECHADO", null],
    ["REQUEST_CHANGES", "CHANGES_REQUESTED", "NEGOCIACAO", "Trocar 2 stories por 1 reel"],
    ["REJECT", "REJECTED", "PERDIDO", null],
  ] as const)("%s → %s and opportunity %s, without a new version", async (action, status, stage, message) => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, opportunity, proposal } = await seedProposal(db);
    const { publication, publicPath } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);

    const response = await ProposalResponseService.respond(db, tokenOf(publicPath), {
      publicationId: publication.id,
      action,
      ...maria,
      message,
    });

    expect(response.action).toBe(action);
    const state = await ProposalSendingService.getSendState(db, organization.id, proposal.id);
    expect(state?.status).toBe(status);
    const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, opportunity.id));
    expect(opp.stage).toBe(stage);
    expect(await ProposalVersionsRepository.listByProposal(db, organization.id, proposal.id)).toHaveLength(1);
    await expectProposalInvariants(db, organization.id, proposal.id);
  });

  it("does not move a closed opportunity but still updates the proposal", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, opportunity, proposal } = await seedProposal(db, { opportunityStage: "FECHADO" });
    const { publication, publicPath } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);

    await ProposalResponseService.respond(db, tokenOf(publicPath), { publicationId: publication.id, action: "REJECT", ...maria, message: null });

    const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, opportunity.id));
    expect(opp.stage).toBe("FECHADO");
    expect((await ProposalSendingService.getSendState(db, organization.id, proposal.id))?.status).toBe("REJECTED");
  });

  it("refuses a second response to the same publication", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const { publication, publicPath } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    const input = { publicationId: publication.id, action: "ACCEPT" as const, ...maria, message: null };

    await ProposalResponseService.respond(db, tokenOf(publicPath), input);
    await expect(ProposalResponseService.respond(db, tokenOf(publicPath), input)).rejects.toBeInstanceOf(
      PublicationAlreadyRespondedError,
    );
  });

  it("answers SUPERSEDED for an old publication, a nonexistent id and another proposal's publication", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const b = await seedProposal(db);
    const first = await ProposalSendingService.publish(db, a.organization.id, a.proposal.id, a.owner.id);
    await ProposalService.update(db, a.organization.id, a.proposal.id, { title: "v2", userId: a.owner.id });
    await ProposalSendingService.publish(db, a.organization.id, a.proposal.id, a.owner.id);
    const publicationOfB = await ProposalSendingService.publish(db, b.organization.id, b.proposal.id, b.owner.id);
    const tokenA = tokenOf(first.publicPath);

    for (const publicationId of [first.publication.id, "00000000-0000-4000-8000-000000000000", publicationOfB.publication.id]) {
      await expect(
        ProposalResponseService.respond(db, tokenA, { publicationId, action: "ACCEPT", ...maria, message: null }),
      ).rejects.toBeInstanceOf(PublicationSupersededError);
    }
    // B untouched: token(A) + publicationId(B) never reaches B.
    expect((await ProposalSendingService.getSendState(db, b.organization.id, b.proposal.id))?.status).toBe("SENT");
  });

  it("refuses unknown tokens and unavailable proposals", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const { publication, publicPath } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    const input = { publicationId: publication.id, action: "ACCEPT" as const, ...maria, message: null };

    await expect(ProposalResponseService.respond(db, "not-a-token", input)).rejects.toBeInstanceOf(PublicProposalNotFoundError);
    await expect(ProposalResponseService.respond(db, "Z".repeat(43), input)).rejects.toBeInstanceOf(PublicProposalNotFoundError);

    await ProposalService.update(db, organization.id, proposal.id, { status: "ARCHIVED", userId: owner.id });
    await expect(ProposalResponseService.respond(db, tokenOf(publicPath), input)).rejects.toBeInstanceOf(ProposalUnavailableError);
  });

  it("two concurrent responses: exactly one is recorded", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const { publication, publicPath } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);

    const results = await Promise.allSettled([
      ProposalResponseService.respond(db, tokenOf(publicPath), { publicationId: publication.id, action: "ACCEPT", ...maria, message: null }),
      ProposalResponseService.respond(db, tokenOf(publicPath), { publicationId: publication.id, action: "REJECT", ...maria, message: null }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(PublicationAlreadyRespondedError);
    await expectProposalInvariants(db, organization.id, proposal.id);
  });

  it("regression: approved → edit → resend opens a new round and keeps the approval on V1", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const v1 = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    await ProposalResponseService.respond(db, tokenOf(v1.publicPath), { publicationId: v1.publication.id, action: "ACCEPT", ...maria, message: null });

    await ProposalService.update(db, organization.id, proposal.id, { title: "Campanha Verão v2", userId: owner.id });
    const edited = await ProposalSendingService.getSendState(db, organization.id, proposal.id);
    expect(edited).toMatchObject({ status: "APPROVED", hasUnsentChanges: true, canSend: true });
    expect(edited?.latestPublication?.response?.action).toBe("ACCEPT");

    const v2 = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    const resent = await ProposalSendingService.getSendState(db, organization.id, proposal.id);
    expect(resent).toMatchObject({ status: "SENT", hasUnsentChanges: false });
    expect(resent?.latestPublication?.versionNumber).toBe(v2.publication.versionNumber);
    expect(resent?.latestPublication?.response).toBeNull();

    const history = await ProposalSendingService.listPublications(db, organization.id, proposal.id);
    expect(history?.map((item) => item.response?.action ?? null)).toEqual([null, "ACCEPT"]);
    await expectProposalInvariants(db, organization.id, proposal.id);
  });
});
