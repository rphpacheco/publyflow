import { describe, it, expect, afterEach } from "vitest";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "./organizations";
import { creators } from "./creators";
import { contacts } from "./companies-brands-contacts";
import { leads, opportunities } from "./commercial-flow";
import { proposals, proposalVersions } from "./proposals";

describe("proposal_versions schema", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(db: NodePgDatabase<typeof schema>) {
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
      .values({ organizationId: org.id, opportunityId: opportunity.id, title: "P", theme: "PREMIUM" })
      .returning();
    return { org, user, proposal };
  }

  it("stores a snapshot with a version number and author", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, user, proposal } = await setup(db);

    const [version] = await db
      .insert(proposalVersions)
      .values({
        organizationId: org.id,
        proposalId: proposal.id,
        versionNumber: 1,
        snapshotJson: { proposal: { title: "P" }, items: [], blocks: [] },
        createdBy: user.id,
      })
      .returning();

    expect(version.versionNumber).toBe(1);
    expect(version.createdBy).toBe(user.id);
  });

  it("rejects a duplicate versionNumber for the same proposal", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, user, proposal } = await setup(db);

    await db.insert(proposalVersions).values({
      organizationId: org.id,
      proposalId: proposal.id,
      versionNumber: 1,
      snapshotJson: {},
      createdBy: user.id,
    });

    await expect(
      db.insert(proposalVersions).values({
        organizationId: org.id,
        proposalId: proposal.id,
        versionNumber: 1,
        snapshotJson: {},
        createdBy: user.id,
      }),
    ).rejects.toThrow();
  });
});
