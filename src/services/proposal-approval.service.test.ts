import { describe, it, expect, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { ProposalApprovalService } from "./proposal-approval.service";
import { ProposalService } from "./proposal.service";
import { organizationMembers } from "@/db/schema/organizations";
import { domainEvents } from "@/db/schema/domain-events";
import {
  ApprovalNotRequiredError,
  ApprovalStaleError,
  NoPendingApprovalError,
  NotProposalCreatorError,
  ProposalArchivedError,
} from "@/domain/proposals/errors";

describe("ProposalApprovalService", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup({ access = true } = {}) {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const seeded = await seedProposal(db);
    if (access) {
      await db.insert(organizationMembers).values({ organizationId: seeded.organization.id, userId: seeded.creator.userId, role: "CREATOR" });
    }
    return { db, ...seeded };
  }

  async function events(db: Awaited<ReturnType<typeof setup>>["db"], organizationId: string, eventType: string) {
    return db.select().from(domainEvents).where(and(eq(domainEvents.organizationId, organizationId), eq(domainEvents.eventType, eventType)));
  }

  it("request: creates request 1 for the latest version and emits approval_requested", async () => {
    const { db, organization, owner, proposal } = await setup();
    const result = await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    expect(result.created).toBe(true);
    expect(result.approval).toMatchObject({ requestNumber: 1, versionNumber: 1, decision: null, requestedBy: owner.id });
    const emitted = await events(db, organization.id, "proposal.approval_requested");
    expect(emitted).toHaveLength(1);
    expect(emitted[0].payload).toMatchObject({ proposal_id: proposal.id, approval_id: result.approval.id, creator_display_name: "Thais" });
  });

  it("request: idempotent while pending or approved for the same version", async () => {
    const { db, organization, owner, creator, proposal } = await setup();
    const first = await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    const again = await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    expect(again).toMatchObject({ created: false, approval: { id: first.approval.id } });
    await ProposalApprovalService.approve(db, organization.id, proposal.id, creator.userId, first.approval.id, null);
    expect((await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id)).created).toBe(false);
  });

  it("request: new request after changes_requested and after an edit (stale)", async () => {
    const { db, organization, owner, creator, proposal } = await setup();
    const requested = await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    await ProposalApprovalService.requestChanges(db, organization.id, proposal.id, creator.userId, requested.approval.id, "Trocar o preço");
    const afterChanges = await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    expect(afterChanges).toMatchObject({ created: true, approval: { requestNumber: 2, versionNumber: 1 } });

    await ProposalService.update(db, organization.id, proposal.id, { title: "Campanha Verão 2", userId: owner.id });
    const afterEdit = await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    expect(afterEdit).toMatchObject({ created: true, approval: { requestNumber: 3, versionNumber: 2 } });
  });

  it("request: 'not required' when the creator has no access; archived proposal rejected", async () => {
    const noAccess = await setup({ access: false });
    await expect(ProposalApprovalService.request(noAccess.db, noAccess.organization.id, noAccess.proposal.id, noAccess.owner.id)).rejects.toBeInstanceOf(
      ApprovalNotRequiredError,
    );
    await cleanup();
    const { db, organization, owner, proposal } = await setup();
    await ProposalService.update(db, organization.id, proposal.id, { status: "ARCHIVED", userId: owner.id });
    await expect(ProposalApprovalService.request(db, organization.id, proposal.id, owner.id)).rejects.toBeInstanceOf(ProposalArchivedError);
  });

  it("approve: records the decision and emits creator_approved; second decision fails", async () => {
    const { db, organization, owner, creator, proposal } = await setup();
    const requested = await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    const approved = await ProposalApprovalService.approve(db, organization.id, proposal.id, creator.userId, requested.approval.id, "Perfeito");
    expect(approved).toMatchObject({ decision: "APPROVED", decidedBy: creator.userId, message: "Perfeito" });
    expect(await events(db, organization.id, "proposal.creator_approved")).toHaveLength(1);
    await expect(
      ProposalApprovalService.approve(db, organization.id, proposal.id, creator.userId, requested.approval.id, null),
    ).rejects.toBeInstanceOf(NoPendingApprovalError);
  });

  it("approve: no request → NoPending; stale → ApprovalStale; non-creator user → NotProposalCreator", async () => {
    const { db, organization, owner, creator, proposal } = await setup();
    await expect(
      ProposalApprovalService.approve(db, organization.id, proposal.id, creator.userId, "00000000-0000-0000-0000-000000000000", null),
    ).rejects.toBeInstanceOf(NoPendingApprovalError);
    const requested = await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    await expect(
      ProposalApprovalService.approve(db, organization.id, proposal.id, owner.id, requested.approval.id, null),
    ).rejects.toBeInstanceOf(NotProposalCreatorError);
    await ProposalService.update(db, organization.id, proposal.id, { title: "Mudou", userId: owner.id });
    await expect(
      ProposalApprovalService.approve(db, organization.id, proposal.id, creator.userId, requested.approval.id, null),
    ).rejects.toBeInstanceOf(ApprovalStaleError);
  });

  it("approve: an approvalId naming a superseded request is stale even against the current latest", async () => {
    const { db, organization, owner, creator, proposal } = await setup();
    const reqA = await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    await ProposalService.update(db, organization.id, proposal.id, { title: "Campanha Verão 2", userId: owner.id });
    const reqB = await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    expect(reqB.approval.id).not.toBe(reqA.approval.id);

    await expect(
      ProposalApprovalService.approve(db, organization.id, proposal.id, creator.userId, reqA.approval.id, null),
    ).rejects.toBeInstanceOf(ApprovalStaleError);

    const approved = await ProposalApprovalService.approve(db, organization.id, proposal.id, creator.userId, reqB.approval.id, null);
    expect(approved).toMatchObject({ id: reqB.approval.id, decision: "APPROVED" });
  });

  it("requestChanges: stores the trimmed message and emits creator_changes_requested", async () => {
    const { db, organization, owner, creator, proposal } = await setup();
    const requested = await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    const decided = await ProposalApprovalService.requestChanges(
      db,
      organization.id,
      proposal.id,
      creator.userId,
      requested.approval.id,
      "  Trocar a capa  ",
    );
    expect(decided).toMatchObject({ decision: "CHANGES_REQUESTED", message: "Trocar a capa" });
    expect(await events(db, organization.id, "proposal.creator_changes_requested")).toHaveLength(1);
  });
});
