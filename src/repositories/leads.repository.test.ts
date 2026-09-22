import { describe, it, expect, afterEach } from "vitest";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { LeadsRepository } from "./leads.repository";
import { contacts } from "@/db/schema/companies-brands-contacts";

async function setupOrgAndCreator(db: NodePgDatabase<typeof schema>) {
  const { organization } = await OrganizationService.createWithOwner(db, {
    organizationName: "Org",
    ownerEmail: `owner-${Date.now()}-${Math.random()}@publyflow.test`,
    ownerFullName: "Owner",
  });
  const creator = await CreatorService.onboardCreator(db, organization.id, {
    email: `creator-${Date.now()}-${Math.random()}@publyflow.test`,
    fullName: "Thais",
    displayName: "Thais",
  });
  return { organization, creator };
}

describe("LeadsRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("lists leads by creator, ordered by createdAt desc", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization, creator } = await setupOrgAndCreator(db);
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: organization.id, fullName: "Maria" })
      .returning();

    const lead = await LeadsRepository.create(db, organization.id, {
      creatorId: creator.id,
      inquiryId: null,
      contactId: contact!.id,
      companyId: null,
      brandId: null,
      qualified: true,
    });

    const list = await LeadsRepository.listByCreator(db, organization.id, creator.id);
    expect(list.some((row) => row.id === lead.id)).toBe(true);
  });
});
