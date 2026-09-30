import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { organizationMembers } from "@/db/schema/organizations";
import { ProposalService } from "./proposal.service";
import { ProposalItemService } from "./proposal-item.service";
import { ProposalSendingService } from "./proposal-sending.service";
import { ProposalResponseService } from "./proposal-response.service";
import { ProposalApprovalService } from "./proposal-approval.service";
import { CreatorService } from "./creator.service";
import { ProposalQueueService, QUEUE_LIMIT } from "./proposal-queue.service";
import { companies, contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";

function tokenOf(publicPath: string) {
  return publicPath.replace("/p/", "");
}

const maria = { name: "Maria Fernandes", email: "maria@bella.test" };

describe("ProposalQueueService.list", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("computes situations & fields for a seeded mix in one org", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, opportunity, proposal: proposalA } = await seedProposal(db);

    // B: published -> awaiting_client
    const proposalB = await ProposalService.create(db, organization.id, {
      opportunityId: opportunity.id,
      title: "B",
      theme: "PREMIUM",
      userId: owner.id,
    });
    await ProposalSendingService.publish(db, organization.id, proposalB.id, owner.id);

    // C: published, client requests changes
    const proposalC = await ProposalService.create(db, organization.id, {
      opportunityId: opportunity.id,
      title: "C",
      theme: "PREMIUM",
      userId: owner.id,
    });
    const pubC = await ProposalSendingService.publish(db, organization.id, proposalC.id, owner.id);
    await ProposalResponseService.respond(db, tokenOf(pubC.publicPath), {
      publicationId: pubC.publication.id,
      action: "REQUEST_CHANGES",
      ...maria,
      message: "Trocar a capa",
    });

    // D: published, client accepts
    const proposalD = await ProposalService.create(db, organization.id, {
      opportunityId: opportunity.id,
      title: "D",
      theme: "PREMIUM",
      userId: owner.id,
    });
    const pubD = await ProposalSendingService.publish(db, organization.id, proposalD.id, owner.id);
    await ProposalResponseService.respond(db, tokenOf(pubD.publicPath), {
      publicationId: pubD.publication.id,
      action: "ACCEPT",
      ...maria,
      message: null,
    });

    // E: archived
    const proposalE = await ProposalService.create(db, organization.id, {
      opportunityId: opportunity.id,
      title: "E",
      theme: "PREMIUM",
      userId: owner.id,
    });
    await ProposalService.update(db, organization.id, proposalE.id, { status: "ARCHIVED", userId: owner.id });

    const withoutArchived = await ProposalQueueService.list(db, organization.id, { creatorScope: null, includeArchived: false });
    expect(withoutArchived.items.map((i) => i.id)).not.toContain(proposalE.id);
    expect(withoutArchived.closedCount).toBe(1);
    expect(withoutArchived.truncated).toBe(false);

    const itemA = withoutArchived.items.find((i) => i.id === proposalA.id)!;
    expect(itemA.situation).toBe("draft");
    expect(itemA.latestPublication).toBeNull();
    expect(itemA.latestVersionNumber).toBe(1);
    expect(itemA.changes).toBeNull();
    expect(itemA.creatorName).toBe("Thais");
    expect(itemA.counterpartName).toBe("Bella Cosméticos");

    const itemB = withoutArchived.items.find((i) => i.id === proposalB.id)!;
    expect(itemB.situation).toBe("awaiting_client");
    expect(itemB.latestPublication?.versionNumber).toBe(1);

    const itemC = withoutArchived.items.find((i) => i.id === proposalC.id)!;
    expect(itemC.situation).toBe("changes_requested");
    expect(itemC.changes).toEqual({ by: "client", name: "Maria Fernandes", excerpt: "Trocar a capa" });

    const itemD = withoutArchived.items.find((i) => i.id === proposalD.id)!;
    expect(itemD.situation).toBe("closed");
    expect(itemD.clientOutcome?.action).toBe("ACCEPT");

    // sorted by lastActivityAt desc
    const times = withoutArchived.items.map((i) => i.lastActivityAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));

    const withArchived = await ProposalQueueService.list(db, organization.id, { creatorScope: null, includeArchived: true });
    const itemE = withArchived.items.find((i) => i.id === proposalE.id)!;
    expect(itemE).toBeDefined();
    expect(itemE.situation).toBe("archived");
  });

  it("computes creator approval situations", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, creator, opportunity, proposal } = await seedProposal(db);
    await db.insert(organizationMembers).values({ organizationId: organization.id, userId: creator.userId, role: "CREATOR" });

    const { approval } = await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    let result = await ProposalQueueService.list(db, organization.id, { creatorScope: null, includeArchived: false });
    let item = result.items.find((i) => i.id === proposal.id)!;
    expect(item.situation).toBe("awaiting_creator");

    await ProposalApprovalService.approve(db, organization.id, proposal.id, creator.userId, approval.id, null);
    result = await ProposalQueueService.list(db, organization.id, { creatorScope: null, includeArchived: false });
    item = result.items.find((i) => i.id === proposal.id)!;
    expect(item.situation).toBe("ready_to_send");
    expect(item.approvedByCreator).toBe(true);

    // Edit, request approval again, then creator requests changes
    await ProposalService.update(db, organization.id, proposal.id, { title: "Campanha Verão 2", userId: owner.id });
    const { approval: approval2 } = await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    await ProposalApprovalService.requestChanges(db, organization.id, proposal.id, creator.userId, approval2.id, "Ajustar preço");
    result = await ProposalQueueService.list(db, organization.id, { creatorScope: null, includeArchived: false });
    item = result.items.find((i) => i.id === proposal.id)!;
    expect(item.situation).toBe("changes_requested");
    expect(item.changes).toEqual({ by: "creator", name: "Thais", excerpt: "Ajustar preço" });

    // Edit after a pending request marks it stale, and no new request was made
    // so we simulate: request again then edit before deciding
    const { approval: approval3 } = await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    await ProposalService.update(db, organization.id, proposal.id, { title: "Campanha Verão 3", userId: owner.id });
    result = await ProposalQueueService.list(db, organization.id, { creatorScope: null, includeArchived: false });
    item = result.items.find((i) => i.id === proposal.id)!;
    expect(item.situation).toBe("draft");
    expect(item.approvalStale).toBe(true);
    void approval3;
  });

  it("computes totals from proposal items", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);

    await ProposalItemService.addItem(db, organization.id, {
      proposalId: proposal.id,
      description: "Story",
      unitPrice: 150000,
      quantity: 2,
      userId: owner.id,
    });
    await ProposalItemService.addItem(db, organization.id, {
      proposalId: proposal.id,
      description: "Reel",
      unitPrice: 50000,
      quantity: 1,
      userId: owner.id,
    });

    const result = await ProposalQueueService.list(db, organization.id, { creatorScope: null, includeArchived: false });
    const item = result.items.find((i) => i.id === proposal.id)!;
    expect(item.totalCents).toBe(350000);

    const { organization: org2, owner: owner2, opportunity: opp2 } = await seedProposal(db);
    const noItems = await ProposalService.create(db, org2.id, {
      opportunityId: opp2.id,
      title: "No items",
      theme: "PREMIUM",
      userId: owner2.id,
    });
    const result2 = await ProposalQueueService.list(db, org2.id, { creatorScope: null, includeArchived: false });
    const item2 = result2.items.find((i) => i.id === noItems.id)!;
    expect(item2.totalCents).toBe(0);
  });

  it("scopes by creator", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, creator: creatorA, proposal: proposalA } = await seedProposal(db);

    const creatorB = await CreatorService.onboardCreator(db, organization.id, {
      email: `creatorb-${Date.now()}@publyflow.test`,
      fullName: "Bia",
      displayName: "Bia",
    });
    const [company] = await db.insert(companies).values({ organizationId: organization.id, name: "Outra Empresa" }).returning();
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: organization.id, companyId: company.id, fullName: "Contato B" })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({ organizationId: organization.id, creatorId: creatorB.id, contactId: contact.id, companyId: company.id })
      .returning();
    const [opportunityB] = await db
      .insert(opportunities)
      .values({ organizationId: organization.id, creatorId: creatorB.id, leadId: lead.id, companyId: company.id, brandId: null })
      .returning();
    const proposalB = await ProposalService.create(db, organization.id, {
      opportunityId: opportunityB.id,
      title: "B",
      theme: "PREMIUM",
      userId: owner.id,
    });

    const scopedA = await ProposalQueueService.list(db, organization.id, { creatorScope: creatorA.id, includeArchived: false });
    expect(scopedA.items.map((i) => i.id)).toEqual([proposalA.id]);

    const scopedAll = await ProposalQueueService.list(db, organization.id, { creatorScope: null, includeArchived: false });
    expect(scopedAll.items.map((i) => i.id).sort()).toEqual([proposalA.id, proposalB.id].sort());
  });

  it("isolates tenants", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization: orgA, proposal: proposalA } = await seedProposal(db);
    const { proposal: proposalB } = await seedProposal(db);

    const result = await ProposalQueueService.list(db, orgA.id, { creatorScope: null, includeArchived: false });
    expect(result.items.map((i) => i.id)).toEqual([proposalA.id]);
    expect(result.items.map((i) => i.id)).not.toContain(proposalB.id);
  });

  it(
    "limits to 200 proposals, oldest missing, truncated true",
    { timeout: 120000 },
    async () => {
      const { db, cleanup: c } = await withTestDb();
      cleanup = c;
      const { organization, owner, opportunity, proposal: first } = await seedProposal(db);

      let lastId = first.id;
      for (let i = 0; i < 200; i++) {
        const p = await ProposalService.create(db, organization.id, {
          opportunityId: opportunity.id,
          title: `P${i}`,
          theme: "PREMIUM",
          userId: owner.id,
        });
        lastId = p.id;
      }
      void lastId;

      const result = await ProposalQueueService.list(db, organization.id, { creatorScope: null, includeArchived: false });
      expect(result.items).toHaveLength(QUEUE_LIMIT);
      expect(result.truncated).toBe(true);
      expect(result.items.map((i) => i.id)).not.toContain(first.id);
    },
  );
});
