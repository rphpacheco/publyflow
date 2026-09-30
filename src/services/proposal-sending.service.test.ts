import { describe, it, expect, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { expectProposalInvariants } from "@/test/helpers/proposal-invariants";
import { ProposalService } from "./proposal.service";
import { ProposalApprovalService } from "./proposal-approval.service";
import { ProposalSendingService, computeSendFlags } from "./proposal-sending.service";
import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";
import { ApprovalRequiredError, ProposalArchivedError } from "@/domain/proposals/errors";
import { opportunities, opportunityStageHistory } from "@/db/schema/commercial-flow";
import { creators } from "@/db/schema/creators";
import { organizationMembers } from "@/db/schema/organizations";
import { domainEvents } from "@/db/schema/domain-events";

describe("computeSendFlags (spec §5.2)", () => {
  it.each([
    ["DRAFT", 1, null, true, true],
    ["DRAFT", 3, 3, false, true],
    ["SENT", 2, 2, false, false],
    ["SENT", 3, 2, true, true],
    ["CHANGES_REQUESTED", 2, 2, false, false],
    ["CHANGES_REQUESTED", 3, 2, true, true],
    ["APPROVED", 2, 2, false, false],
    ["APPROVED", 3, 2, true, true],
    ["REJECTED", 2, 2, false, false],
    ["REJECTED", 3, 2, true, true],
    ["ARCHIVED", 3, 2, true, false],
  ] as const)("%s latest v%s published v%s", (status, latest, published, hasUnsentChanges, canSend) => {
    expect(computeSendFlags({ status, latestVersionNumber: latest, latestPublicationVersionNumber: published })).toEqual({
      hasUnsentChanges,
      canSend,
    });
  });
});

describe("ProposalSendingService.publish", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("first send: token, frozen context, SENT, PROPOSTA_ENVIADA with history, no new version", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, opportunity, proposal } = await seedProposal(db);

    const result = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);

    expect(result.created).toBe(true);
    expect(result.publicPath).toMatch(/^\/p\/[A-Za-z0-9_-]{43}$/);
    expect(result.publication.versionNumber).toBe(1);
    expect(result.publication.publicationNumber).toBe(1);
    expect(result.publication.context).toMatchObject({
      creator: { displayName: "Thais", instagramHandle: "@thais" },
      clientName: "Bella Cosméticos",
    });
    expect(await ProposalVersionsRepository.listByProposal(db, organization.id, proposal.id)).toHaveLength(1);

    const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, opportunity.id));
    expect(opp.stage).toBe("PROPOSTA_ENVIADA");
    const history = await db.select().from(opportunityStageHistory).where(eq(opportunityStageHistory.opportunityId, opportunity.id));
    expect(history.some((row) => row.toStage === "PROPOSTA_ENVIADA")).toBe(true);

    const state = await ProposalSendingService.getSendState(db, organization.id, proposal.id);
    expect(state).toMatchObject({ status: "SENT", publicPath: result.publicPath, hasUnsentChanges: false, canSend: false, latestVersionNumber: 1 });
    await expectProposalInvariants(db, organization.id, proposal.id);
  });

  it("is idempotent without changes and keeps the same token", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);

    const first = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    const again = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);

    expect(again.created).toBe(false);
    expect(again.publication.id).toBe(first.publication.id);
    expect(again.publicPath).toBe(first.publicPath);
  });

  it("after an edit creates a new publication of the latest version and keeps the previous one", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);

    const first = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    await ProposalService.update(db, organization.id, proposal.id, { title: "Campanha Verão v2", userId: owner.id });

    const edited = await ProposalSendingService.getSendState(db, organization.id, proposal.id);
    expect(edited).toMatchObject({ status: "SENT", hasUnsentChanges: true, canSend: true, latestVersionNumber: 2 });

    const second = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    expect(second.created).toBe(true);
    expect(second.publication.versionNumber).toBe(2);
    expect(second.publication.publicationNumber).toBe(2);
    expect(second.publicPath).toBe(first.publicPath);

    const history = await ProposalSendingService.listPublications(db, organization.id, proposal.id);
    expect(history?.map((item) => item.versionNumber)).toEqual([2, 1]);
    await expectProposalInvariants(db, organization.id, proposal.id);
  });

  it("freezes the context: renaming the creator afterwards does not change the publication", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, creator, proposal } = await seedProposal(db);

    const { publication } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    await db.update(creators).set({ displayName: "Thais Nova" }).where(eq(creators.id, creator.id));

    const history = await ProposalSendingService.listPublications(db, organization.id, proposal.id);
    expect(history?.[0].id).toBe(publication.id);
    expect((publication.context as { creator: { displayName: string } }).creator.displayName).toBe("Thais");
  });

  it("refuses an archived proposal", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    await ProposalService.update(db, organization.id, proposal.id, { status: "ARCHIVED", userId: owner.id });

    await expect(ProposalSendingService.publish(db, organization.id, proposal.id, owner.id)).rejects.toBeInstanceOf(
      ProposalArchivedError,
    );
  });

  it("does not move a closed opportunity", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, opportunity, proposal } = await seedProposal(db, { opportunityStage: "PERDIDO" });

    await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);

    const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, opportunity.id));
    expect(opp.stage).toBe("PERDIDO");
  });

  it("resending from DRAFT (unarchived) always creates a publication and re-enables the link", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);

    const first = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    await ProposalService.update(db, organization.id, proposal.id, { status: "ARCHIVED", userId: owner.id });
    await ProposalService.update(db, organization.id, proposal.id, { status: "DRAFT", userId: owner.id });

    const drafted = await ProposalSendingService.getSendState(db, organization.id, proposal.id);
    expect(drafted).toMatchObject({ status: "DRAFT", publicPath: null, canSend: true });

    const again = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    expect(again.created).toBe(true);
    expect(again.publicPath).toBe(first.publicPath);
    await expectProposalInvariants(db, organization.id, proposal.id);
  });

  it("two concurrent sends after an edit create exactly one publication (idempotent under concurrency)", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    await ProposalService.update(db, organization.id, proposal.id, { title: "v2", userId: owner.id });

    const results = await Promise.all([
      ProposalSendingService.publish(db, organization.id, proposal.id, owner.id),
      ProposalSendingService.publish(db, organization.id, proposal.id, owner.id),
    ]);

    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(results[0].publication.id).toBe(results[1].publication.id);
    const history = await ProposalSendingService.listPublications(db, organization.id, proposal.id);
    expect(history).toHaveLength(2);
  });

  it("returns null state/history for a proposal of another organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const b = await seedProposal(db);

    expect(await ProposalSendingService.getSendState(db, b.organization.id, a.proposal.id)).toBeNull();
    expect(await ProposalSendingService.listPublications(db, b.organization.id, a.proposal.id)).toBeNull();
  });
});

describe("approval gate (spec D §4.5)", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setupWithAccess() {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const seeded = await seedProposal(db);
    await db.insert(organizationMembers).values({ organizationId: seeded.organization.id, userId: seeded.creator.userId, role: "CREATOR" });
    return { db, ...seeded };
  }

  it("creator without access: publishes as before, no approval data", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const result = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    expect(result.publication).toMatchObject({ approvalId: null, sentWithoutApproval: false });
    const state = await ProposalSendingService.getSendState(db, organization.id, proposal.id);
    expect(state?.approval).toEqual({ state: "not_required", required: false, creatorName: "Thais", current: null });
  });

  it("required and not approved → ApprovalRequiredError, nothing published", async () => {
    const { db, organization, owner, proposal } = await setupWithAccess();
    await expect(ProposalSendingService.publish(db, organization.id, proposal.id, owner.id)).rejects.toBeInstanceOf(ApprovalRequiredError);
    await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    await expect(ProposalSendingService.publish(db, organization.id, proposal.id, owner.id)).rejects.toBeInstanceOf(ApprovalRequiredError);
    expect(await ProposalSendingService.listPublications(db, organization.id, proposal.id)).toEqual([]);
  });

  it("approved → publication stores approval_id; history shows the approver", async () => {
    const { db, organization, owner, creator, proposal } = await setupWithAccess();
    const { approval } = await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    await ProposalApprovalService.approve(db, organization.id, proposal.id, creator.userId, null);
    const result = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    expect(result.publication).toMatchObject({ approvalId: approval.id, sentWithoutApproval: false });
    const [item] = (await ProposalSendingService.listPublications(db, organization.id, proposal.id))!;
    expect(item).toMatchObject({ approvedByName: "Thais", sentWithoutApproval: false });
  });

  it("withoutApproval → flag stored, event emitted; ignored when approved", async () => {
    const { db, organization, owner, proposal } = await setupWithAccess();
    const result = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id, { withoutApproval: true });
    expect(result.publication).toMatchObject({ approvalId: null, sentWithoutApproval: true });
    const emitted = await db
      .select()
      .from(domainEvents)
      .where(and(eq(domainEvents.organizationId, organization.id), eq(domainEvents.eventType, "proposal.sent_without_approval")));
    expect(emitted).toHaveLength(1);
    expect(emitted[0].payload).toMatchObject({ publication_id: result.publication.id, creator_display_name: "Thais" });
    const [item] = (await ProposalSendingService.listPublications(db, organization.id, proposal.id))!;
    expect(item).toMatchObject({ approvedByName: null, sentWithoutApproval: true });
  });

  it("idempotent re-publish of an already-published version is not gated", async () => {
    const { db, organization, owner, proposal } = await setupWithAccess();
    await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id, { withoutApproval: true });
    const again = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    expect(again.created).toBe(false);
  });

  it("send-state exposes the approval block", async () => {
    const { db, organization, owner, creator, proposal } = await setupWithAccess();
    expect((await ProposalSendingService.getSendState(db, organization.id, proposal.id))?.approval).toEqual({
      state: "none",
      required: true,
      creatorName: "Thais",
      current: null,
    });
    await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    await ProposalApprovalService.requestChanges(db, organization.id, proposal.id, creator.userId, "Ajustar preço");
    const state = await ProposalSendingService.getSendState(db, organization.id, proposal.id);
    expect(state?.approval).toMatchObject({
      state: "changes_requested",
      required: true,
      current: { versionNumber: 1, requestedByName: "Owner", decision: "CHANGES_REQUESTED", message: "Ajustar preço" },
    });
  });
});
