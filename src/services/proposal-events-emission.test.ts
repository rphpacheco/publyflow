import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { ProposalService } from "./proposal.service";
import { ProposalSendingService } from "./proposal-sending.service";
import { ProposalResponseService } from "./proposal-response.service";
import { DomainEventsRepository } from "@/repositories/domain-events.repository";
import { ProposalsRepository } from "@/repositories/proposals.repository";

const tokenOf = (publicPath: string) => publicPath.replace("/p/", "");

describe("domain events emitted with the fact", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup?.();
  });

  it("publish emits proposal.sent once; an idempotent repeat emits nothing", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);

    const { publication } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);

    const events = await DomainEventsRepository.listForEntity(db, organization.id, "proposal", proposal.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: "proposal.sent", status: "pending" });
    expect(events[0].payload).toMatchObject({ publication_id: publication.id, version_number: 1, proposal_title: "Campanha Verão" });
  });

  it.each([
    ["ACCEPT", "proposal.approved"],
    ["REQUEST_CHANGES", "proposal.changes_requested"],
    ["REJECT", "proposal.rejected"],
  ] as const)("respond %s emits %s", async (action, eventType) => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const { publication, publicPath } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);

    await ProposalResponseService.respond(db, tokenOf(publicPath), {
      publicationId: publication.id,
      action,
      name: "Maria",
      email: "maria@bella.test",
      message: action === "REQUEST_CHANGES" ? "Trocar stories" : null,
    });

    const events = await DomainEventsRepository.listForEntity(db, organization.id, "proposal", proposal.id);
    expect(events.map((event) => event.eventType)).toEqual(["proposal.sent", eventType]);
    expect(JSON.stringify(events[1].payload)).not.toContain("maria@bella.test");
  });

  it("a failed response transaction leaves no event (atomicity)", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const { publication, publicPath } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    // Fail after the event would have been appended: the status update is the last write.
    vi.spyOn(ProposalsRepository, "setStatusWithTx").mockRejectedValueOnce(new Error("boom"));

    await expect(
      ProposalResponseService.respond(db, tokenOf(publicPath), {
        publicationId: publication.id,
        action: "ACCEPT",
        name: "Maria",
        email: "maria@bella.test",
        message: null,
      }),
    ).rejects.toThrow("boom");

    const events = await DomainEventsRepository.listForEntity(db, organization.id, "proposal", proposal.id);
    expect(events.map((event) => event.eventType)).toEqual(["proposal.sent"]);
  });

  it("a REQUEST_CHANGES message with an emoji straddling the excerpt cut succeeds and stores the event", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const { publication, publicPath } = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    const message = "a".repeat(138) + "😀" + "b".repeat(10);

    await ProposalResponseService.respond(db, tokenOf(publicPath), {
      publicationId: publication.id,
      action: "REQUEST_CHANGES",
      name: "Maria",
      email: "maria@bella.test",
      message,
    });

    const events = await DomainEventsRepository.listForEntity(db, organization.id, "proposal", proposal.id);
    expect(events.map((event) => event.eventType)).toEqual(["proposal.sent", "proposal.changes_requested"]);
    const excerptValue = (events[1].payload as { message_excerpt: string }).message_excerpt;
    expect(excerptValue).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(Array.from(excerptValue).length).toBeLessThanOrEqual(140);
  });

  it("a rejected response (superseded) emits nothing", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const first = await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);
    await ProposalService.update(db, organization.id, proposal.id, { title: "v2", userId: owner.id });
    await ProposalSendingService.publish(db, organization.id, proposal.id, owner.id);

    await expect(
      ProposalResponseService.respond(db, tokenOf(first.publicPath), {
        publicationId: first.publication.id,
        action: "ACCEPT",
        name: "Maria",
        email: "maria@bella.test",
        message: null,
      }),
    ).rejects.toThrow();

    const events = await DomainEventsRepository.listForEntity(db, organization.id, "proposal", proposal.id);
    expect(events.map((event) => event.eventType)).toEqual(["proposal.sent", "proposal.sent"]);
  });
});
