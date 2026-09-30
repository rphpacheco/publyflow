import { describe, it, expect, afterEach } from "vitest";
import { notificationCopy } from "./proposal-notifications";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { organizationMembers } from "@/db/schema/organizations";
import { ProposalApprovalService } from "@/services/proposal-approval.service";
import { EventDrainService } from "@/services/event-drain.service";
import { NotificationsRepository } from "@/repositories/notifications.repository";

const event = (eventType: string) =>
  ({ eventType, payload: { proposal_id: "p1", proposal_title: "Campanha Verão", respondent_name: "Maria" } }) as never;

const approvalEvent = (eventType: string) =>
  ({
    eventType,
    payload: { proposal_id: "p1", proposal_title: "Campanha Verão", creator_display_name: "Thais" },
  }) as never;

describe("notificationCopy", () => {
  it.each([
    ["proposal.approved", "Proposta aceita", 'Maria aceitou "Campanha Verão".'],
    ["proposal.changes_requested", "Ajustes pedidos", 'Maria pediu ajustes em "Campanha Verão".'],
    ["proposal.rejected", "Proposta recusada", 'Maria recusou "Campanha Verão".'],
  ])("%s", (type, title, body) => {
    expect(notificationCopy(event(type))).toEqual({ kind: type, title, body, linkPath: "/proposals/p1" });
  });

  it("returns null for events that do not notify", () => {
    expect(notificationCopy(event("proposal.sent"))).toBeNull();
  });

  it.each([
    ["proposal.approval_requested", "Aprovação pedida", 'Revise e aprove "Campanha Verão".'],
    ["proposal.creator_approved", "Creator aprovou", 'Thais aprovou "Campanha Verão".'],
    ["proposal.creator_changes_requested", "Creator pediu ajustes", 'Thais pediu ajustes em "Campanha Verão".'],
    ["proposal.sent_without_approval", "Enviada sem sua aprovação", '"Campanha Verão" foi enviada ao cliente sem sua aprovação.'],
  ])("%s", (type, title, body) => {
    expect(notificationCopy(approvalEvent(type))).toEqual({ kind: type, title, body, linkPath: "/proposals/p1" });
  });
});

describe("approval notifications end-to-end through the drain", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("request → drain: only the owning creator is notified", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, creator, proposal } = await seedProposal(db);
    await db.insert(organizationMembers).values({ organizationId: organization.id, userId: creator.userId, role: "CREATOR" });

    await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    await EventDrainService.drain(db);

    const forCreator = await NotificationsRepository.listForUser(db, organization.id, creator.userId, 10);
    expect(forCreator.items).toHaveLength(1);
    expect(forCreator.items[0]).toMatchObject({ title: "Aprovação pedida", body: 'Revise e aprove "Campanha Verão".' });
    const forOwner = await NotificationsRepository.listForUser(db, organization.id, owner.id, 10);
    expect(forOwner.items).toHaveLength(0);
  });

  it("approve → drain: only OWNER (staff) is notified", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, creator, proposal } = await seedProposal(db);
    await db.insert(organizationMembers).values({ organizationId: organization.id, userId: creator.userId, role: "CREATOR" });

    await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    await ProposalApprovalService.approve(db, organization.id, proposal.id, creator.userId, null);
    await EventDrainService.drain(db);

    const forOwner = await NotificationsRepository.listForUser(db, organization.id, owner.id, 10);
    expect(forOwner.items.some((i) => i.title === "Creator aprovou" && i.body === 'Thais aprovou "Campanha Verão".')).toBe(true);
    const forCreator = await NotificationsRepository.listForUser(db, organization.id, creator.userId, 10);
    expect(forCreator.items.some((i) => i.title === "Creator aprovou")).toBe(false);
  });
});
