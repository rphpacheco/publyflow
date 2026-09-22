import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "./organizations";
import { creators } from "./creators";
import { contacts } from "./companies-brands-contacts";
import { leads, opportunities } from "./commercial-flow";
import { proposals, proposalItems } from "./proposals";

describe("proposal_items schema", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(db: any) {
    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: "thais@publyflow.test", fullName: "Thais" })
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
    const [proposal] = await db
      .insert(proposals)
      .values({ organizationId: org.id, opportunityId: opportunity.id, title: "P", template: "PREMIUM" })
      .returning();
    return { org, proposal };
  }

  it("stores an ad-hoc item with no rateCardItemId", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, proposal } = await setup(db);

    const [item] = await db
      .insert(proposalItems)
      .values({
        organizationId: org.id,
        proposalId: proposal.id,
        rateCardItemId: null,
        description: "Desconto negociado",
        unitPrice: -50000,
      })
      .returning();

    expect(item.rateCardItemId).toBeNull();
    expect(item.quantity).toBe(1);
    expect(item.sortOrder).toBe(0);
  });
});
