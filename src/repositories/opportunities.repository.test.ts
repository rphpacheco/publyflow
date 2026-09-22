import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { companies, contacts } from "@/db/schema/companies-brands-contacts";
import { leads } from "@/db/schema/commercial-flow";
import { OpportunitiesRepository } from "./opportunities.repository";

describe("OpportunitiesRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup() {
    const { db, cleanup: c } = await withTestDb();
    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: "thais@publyflow.test", fullName: "Thais" })
      .returning();
    const [creator] = await db
      .insert(creators)
      .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ organizationId: org.id, name: "Bella Cosméticos" })
      .returning();
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: org.id, fullName: "Maria" })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({
        organizationId: org.id,
        creatorId: creator.id,
        contactId: contact.id,
        companyId: company.id,
        qualified: true,
      })
      .returning();
    return { db, cleanup: c, org, creator, company, lead };
  }

  it("finds an opportunity by id, and returns null for a nonexistent id", async () => {
    const { db, cleanup: c, org, creator, company, lead } = await setup();
    cleanup = c;

    const created = await OpportunitiesRepository.create(db, org.id, {
      creatorId: creator.id,
      leadId: lead.id,
      companyId: company.id,
      brandId: null,
    });

    const found = await OpportunitiesRepository.findById(db, org.id, created.id);
    expect(found?.id).toBe(created.id);

    const notFound = await OpportunitiesRepository.findById(
      db,
      org.id,
      "00000000-0000-0000-0000-000000000000",
    );
    expect(notFound).toBeNull();
  });
});
