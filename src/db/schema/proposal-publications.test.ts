import { describe, it, expect, afterEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "./organizations";
import { creators } from "./creators";
import { contacts } from "./companies-brands-contacts";
import { leads, opportunities } from "./commercial-flow";
import { proposals, proposalVersions, proposalPublications, proposalResponses } from "./proposals";

describe("proposal_publications / proposal_responses schema", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(db: NodePgDatabase<typeof schema>) {
    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db.insert(users).values({ email: "thais@publyflow.test", fullName: "Thais" }).returning();
    const [creator] = await db
      .insert(creators)
      .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
      .returning();
    const [contact] = await db.insert(contacts).values({ organizationId: org.id, fullName: "Maria" }).returning();
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
    const [version] = await db
      .insert(proposalVersions)
      .values({ organizationId: org.id, proposalId: proposal.id, versionNumber: 1, snapshotJson: {}, createdBy: user.id })
      .returning();
    const [publication] = await db
      .insert(proposalPublications)
      .values({
        organizationId: org.id,
        proposalId: proposal.id,
        publicationNumber: 1,
        versionId: version.id,
        versionNumber: 1,
        context: { creator: { displayName: "Thais", instagramHandle: null }, clientName: null, issuedAt: "2026-09-25T15:00:00.000Z" },
        publishedBy: user.id,
        publishedAt: new Date("2026-09-25T15:00:00Z"),
      })
      .returning();
    return { org, user, proposal, publication };
  }

  it("stores new statuses and a unique public token", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, proposal } = await setup(db);

    await db.update(proposals).set({ status: "SENT", publicToken: "a".repeat(43) }).where(eq(proposals.id, proposal.id));
    const [reloaded] = await db.select().from(proposals).where(eq(proposals.id, proposal.id));
    expect(reloaded.status).toBe("SENT");

    const [other] = await db
      .insert(proposals)
      .values({ organizationId: org.id, opportunityId: proposal.opportunityId, title: "Q", theme: "MINIMAL" })
      .returning();
    await expect(
      db.update(proposals).set({ publicToken: "a".repeat(43) }).where(eq(proposals.id, other.id)),
    ).rejects.toThrow();
  });

  it("accepts at most one response per publication", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, publication } = await setup(db);

    const values = {
      organizationId: org.id,
      publicationId: publication.id,
      action: "ACCEPT" as const,
      respondentName: "Maria",
      respondentEmail: "maria@x.test",
      message: null,
    };
    await db.insert(proposalResponses).values(values);
    await expect(db.insert(proposalResponses).values({ ...values, action: "REJECT" })).rejects.toThrow();
  });

  it("rejects any UPDATE of a publication or a response (immutability trigger)", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, publication } = await setup(db);
    const [response] = await db
      .insert(proposalResponses)
      .values({
        organizationId: org.id,
        publicationId: publication.id,
        action: "REQUEST_CHANGES",
        respondentName: "Maria",
        respondentEmail: "maria@x.test",
        message: "Trocar stories",
      })
      .returning();

    // The pinned drizzle-orm/node-postgres driver wraps the raw Postgres error
    // in a DrizzleQueryError whose own .message is "Failed query: ...";
    // the trigger's RAISE EXCEPTION text is on .cause.message instead.
    await expect(
      db.update(proposalPublications).set({ versionNumber: 2 }).where(eq(proposalPublications.id, publication.id)),
    ).rejects.toThrow(expect.objectContaining({ cause: expect.objectContaining({ message: expect.stringMatching(/immutable/) }) }));
    await expect(
      db.update(proposalResponses).set({ message: "outra" }).where(eq(proposalResponses.id, response.id)),
    ).rejects.toThrow(expect.objectContaining({ cause: expect.objectContaining({ message: expect.stringMatching(/immutable/) }) }));
    await expect(db.execute(sql`select 1`)).resolves.toBeDefined();
  });
});
