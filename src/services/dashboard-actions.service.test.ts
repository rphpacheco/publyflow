import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { seedInquiry } from "@/test/helpers/inquiry-fixtures";
import { ProposalQueueService } from "./proposal-queue.service";
import { ProposalSendingService } from "./proposal-sending.service";
import { ProposalResponseService } from "./proposal-response.service";
import { DashboardActionsService } from "./dashboard-actions.service";

describe("DashboardActionsService", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("counts match the proposals queue for the same data", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    await seedProposal(db); // another org — must not count
    const queue = await ProposalQueueService.list(db, a.organization.id, { creatorScope: null, includeArchived: false });
    const actions = await DashboardActionsService.get(db, a.organization.id, { creatorScope: null });
    const by = (s: string) => queue.items.filter((i) => i.situation === s).length;
    expect(actions).toEqual({
      untriagedInquiries: 0,
      clientChangesRequested: queue.items.filter((i) => i.situation === "changes_requested" && i.changes?.by === "client").length,
      creatorChangesRequested: queue.items.filter((i) => i.situation === "changes_requested" && i.changes?.by === "creator").length,
      awaitingCreatorApproval: by("awaiting_creator"),
      readyToSend: by("ready_to_send"),
      awaitingClient: by("awaiting_client"),
      truncated: queue.truncated,
    });
  });

  it("counts NEW inquiries of the org, honouring creator scope", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const b = await seedProposal(db);
    await seedInquiry(db, a.organization.id, a.creator.id, "NEW", "2026-10-03T12:00:00Z");
    await seedInquiry(db, a.organization.id, a.creator.id, "CONVERTED", "2026-10-03T12:00:00Z");
    await seedInquiry(db, b.organization.id, b.creator.id, "NEW", "2026-10-03T12:00:00Z");
    expect((await DashboardActionsService.get(db, a.organization.id, { creatorScope: null })).untriagedInquiries).toBe(1);
    expect((await DashboardActionsService.get(db, a.organization.id, { creatorScope: a.creator.id })).untriagedInquiries).toBe(1);
    expect((await DashboardActionsService.get(db, a.organization.id, { creatorScope: "00000000-0000-4000-8000-000000000099" })).untriagedInquiries).toBe(0);
  });

  it("counts a client change request", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const { publication, publicPath } = await ProposalSendingService.publish(db, a.organization.id, a.proposal.id, a.owner.id);
    const token = publicPath.split("/").pop()!;
    await ProposalResponseService.respond(db, token, { publicationId: publication.id, action: "REQUEST_CHANGES", name: "Cliente", email: "c@x.com", message: "Ajustar" });
    const actions = await DashboardActionsService.get(db, a.organization.id, { creatorScope: null });
    expect(actions.clientChangesRequested).toBe(1);
    expect(actions.creatorChangesRequested).toBe(0);
  });
});
