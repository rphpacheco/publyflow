import { describe, it, expect, afterEach } from "vitest";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";
import { ProposalsRepository } from "./proposals.repository";
import { ProposalItemsRepository } from "./proposal-items.repository";
import { ProposalItemNotFoundError } from "@/domain/proposals/errors";

describe("ProposalItemsRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(db: NodePgDatabase<typeof schema>) {
    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: `thais-${Date.now()}@publyflow.test`, fullName: "Thais" })
      .returning();
    const [creator] = await db
      .insert(creators)
      .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
      .returning();
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: org.id, fullName: "Maria" })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({ organizationId: org.id, creatorId: creator.id, contactId: contact.id, qualified: true })
      .returning();
    const [opportunity] = await db
      .insert(opportunities)
      .values({ organizationId: org.id, creatorId: creator.id, leadId: lead.id, companyId: null, brandId: null })
      .returning();
    const proposal = await ProposalsRepository.create(db, org.id, {
      opportunityId: opportunity.id,
      title: "P",
      theme: "PREMIUM",
    });
    return { org, proposal };
  }

  it("creates, updates, lists, and removes ad-hoc proposal items", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, proposal } = await setup(db);

    const created = await ProposalItemsRepository.create(db, org.id, {
      proposalId: proposal.id,
      rateCardItemId: null,
      description: "Desconto negociado",
      unitPrice: -50000,
      sortOrder: 1,
    });
    expect(created.unitPrice).toBe(-50000);

    const updated = await ProposalItemsRepository.update(db, org.id, created.id, proposal.id, {
      unitPrice: -60000,
    });
    expect(updated.unitPrice).toBe(-60000);

    const list = await ProposalItemsRepository.listByProposal(db, org.id, proposal.id);
    expect(list).toHaveLength(1);

    await ProposalItemsRepository.remove(db, org.id, created.id, proposal.id);
    expect(await ProposalItemsRepository.listByProposal(db, org.id, proposal.id)).toHaveLength(0);
  });

  it("throws ProposalItemNotFoundError when the claimed proposalId does not own the item", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, proposal: proposalA } = await setup(db);
    const { proposal: proposalB } = await setup(db);

    const item = await ProposalItemsRepository.create(db, org.id, {
      proposalId: proposalA.id,
      rateCardItemId: null,
      description: "Item",
      unitPrice: 10000,
    });

    await expect(
      ProposalItemsRepository.update(db, org.id, item.id, proposalB.id, { unitPrice: 20000 }),
    ).rejects.toThrow(ProposalItemNotFoundError);
  });
});
