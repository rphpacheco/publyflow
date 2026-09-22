import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "./organizations";
import { creators } from "./creators";
import { contacts } from "./companies-brands-contacts";
import { leads, opportunities } from "./commercial-flow";
import { proposals } from "./proposals";

describe("proposals schema", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("stores a proposal linked to an opportunity, defaulting status DRAFT", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

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
      .values({
        organizationId: org.id,
        creatorId: creator.id,
        leadId: lead.id,
        companyId: null,
        brandId: null,
      })
      .returning();

    const [proposal] = await db
      .insert(proposals)
      .values({
        organizationId: org.id,
        opportunityId: opportunity.id,
        title: "Campanha Verão",
        template: "PREMIUM",
      })
      .returning();

    expect(proposal.status).toBe("DRAFT");
    expect(proposal.opportunityId).toBe(opportunity.id);
  });
});
