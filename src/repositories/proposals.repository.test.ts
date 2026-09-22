import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";
import { ProposalsRepository } from "./proposals.repository";
import { ProposalNotFoundError } from "@/domain/proposals/errors";

describe("ProposalsRepository", () => {
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
    return { org, opportunity };
  }

  it("creates, finds, updates, and lists proposals by opportunity", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org, opportunity } = await setup(db);

    const created = await ProposalsRepository.create(db, org.id, {
      opportunityId: opportunity.id,
      title: "Campanha Verão",
      template: "PREMIUM",
    });
    expect(created.status).toBe("DRAFT");

    const found = await ProposalsRepository.findById(db, org.id, created.id);
    expect(found?.id).toBe(created.id);

    const updated = await ProposalsRepository.update(db, org.id, created.id, { title: "Campanha Verão 2" });
    expect(updated.title).toBe("Campanha Verão 2");

    const list = await ProposalsRepository.listByOpportunity(db, org.id, opportunity.id);
    expect(list).toHaveLength(1);
  });

  it("throws ProposalNotFoundError when updating a nonexistent id", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { org } = await setup(db);

    await expect(
      ProposalsRepository.update(db, org.id, "00000000-0000-0000-0000-000000000000", { title: "X" }),
    ).rejects.toThrow(ProposalNotFoundError);
  });
});
