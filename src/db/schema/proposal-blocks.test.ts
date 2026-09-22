import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "./organizations";
import { creators } from "./creators";
import { contacts } from "./companies-brands-contacts";
import { leads, opportunities } from "./commercial-flow";
import { proposals, proposalBlocks } from "./proposals";

describe("proposal_blocks schema", () => {
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

  it("stores a block with a jsonb content payload and a block type from the fixed enum", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, proposal } = await setup(db);

    const [block] = await db
      .insert(proposalBlocks)
      .values({
        organizationId: org.id,
        proposalId: proposal.id,
        blockType: "COVER",
        content: { headline: "Campanha Verão" },
      })
      .returning();

    expect(block.blockType).toBe("COVER");
    expect(block.content).toEqual({ headline: "Campanha Verão" });
    expect(block.sortOrder).toBe(0);
  });

  it("rejects a block type outside the fixed enum", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, proposal } = await setup(db);

    await expect(
      db.insert(proposalBlocks).values({
        organizationId: org.id,
        proposalId: proposal.id,
        blockType: "NOT_A_REAL_TYPE" as any,
        content: {},
      }),
    ).rejects.toThrow();
  });
});
