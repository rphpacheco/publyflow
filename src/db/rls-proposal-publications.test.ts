import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { withTestDb, getAppUserDb } from "@/test/helpers/db";
import { organizations, users } from "./schema/organizations";
import { creators } from "./schema/creators";
import { contacts } from "./schema/companies-brands-contacts";
import { leads, opportunities } from "./schema/commercial-flow";
import { proposals, proposalVersions, proposalPublications, proposalResponses } from "./schema/proposals";

describe("RLS on proposal_publications and proposal_responses", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("only returns rows of the current organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    async function seed(orgName: string) {
      const [org] = await db.insert(organizations).values({ name: orgName }).returning();
      const [user] = await db.insert(users).values({ email: `${orgName}@publyflow.test`, fullName: orgName }).returning();
      const [creator] = await db
        .insert(creators)
        .values({ organizationId: org.id, userId: user.id, displayName: orgName })
        .returning();
      const [contact] = await db.insert(contacts).values({ organizationId: org.id, fullName: "Contact" }).returning();
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
        .values({ organizationId: org.id, opportunityId: opportunity.id, title: orgName, theme: "PREMIUM" })
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
          context: {},
          publishedBy: user.id,
          publishedAt: new Date(),
        })
        .returning();
      await db.insert(proposalResponses).values({
        organizationId: org.id,
        publicationId: publication.id,
        action: "ACCEPT",
        respondentName: "X",
        respondentEmail: "x@x.test",
        message: null,
      });
      return { org, publication };
    }

    const a = await seed("Org A");
    await seed("Org B");

    const appDb = getAppUserDb();
    const visible = await appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${a.org.id}, true)`);
      return {
        publications: await tx.select().from(proposalPublications),
        responses: await tx.select().from(proposalResponses),
      };
    });

    expect(visible.publications.map((row) => row.id)).toEqual([a.publication.id]);
    expect(visible.responses.map((row) => row.publicationId)).toEqual([a.publication.id]);
  });
});
