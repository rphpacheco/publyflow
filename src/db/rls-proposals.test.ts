import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { withTestDb, getAppUserDb } from "@/test/helpers/db";
import { organizations, users } from "./schema/organizations";
import { creators } from "./schema/creators";
import { contacts } from "./schema/companies-brands-contacts";
import { leads, opportunities } from "./schema/commercial-flow";
import { proposals } from "./schema/proposals";

describe("RLS on proposals", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("only returns proposals belonging to the current organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    async function seedOpportunity(orgName: string) {
      const [org] = await db.insert(organizations).values({ name: orgName }).returning();
      const [user] = await db
        .insert(users)
        .values({ email: `${orgName}@publyflow.test`, fullName: orgName })
        .returning();
      const [creator] = await db
        .insert(creators)
        .values({ organizationId: org.id, userId: user.id, displayName: orgName })
        .returning();
      const [contact] = await db
        .insert(contacts)
        .values({ organizationId: org.id, fullName: "Contact" })
        .returning();
      const [lead] = await db
        .insert(leads)
        .values({ organizationId: org.id, creatorId: creator.id, contactId: contact.id, qualified: true })
        .returning();
      const [opportunity] = await db
        .insert(opportunities)
        .values({ organizationId: org.id, creatorId: creator.id, leadId: lead.id, companyId: null, brandId: null })
        .returning();
      return { org, opportunity };
    }

    const a = await seedOpportunity("Org A");
    const b = await seedOpportunity("Org B");

    await db.insert(proposals).values({
      organizationId: a.org.id,
      opportunityId: a.opportunity.id,
      title: "Proposal A",
      template: "PREMIUM",
    });
    await db.insert(proposals).values({
      organizationId: b.org.id,
      opportunityId: b.opportunity.id,
      title: "Proposal B",
      template: "PREMIUM",
    });

    const appDb = getAppUserDb();
    const visible = await appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${a.org.id}, true)`);
      return tx.select().from(proposals);
    });

    expect(visible).toHaveLength(1);
    expect(visible[0].title).toBe("Proposal A");
  });
});
