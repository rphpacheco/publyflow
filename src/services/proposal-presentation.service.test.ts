import { describe, it, expect, afterEach } from "vitest";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { ProposalService } from "./proposal.service";
import { ProposalPresentationService } from "./proposal-presentation.service";
import { brands, companies, contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";

describe("ProposalPresentationService.loadPreviewSource", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(
    db: NodePgDatabase<typeof schema>,
    options: { withCompany?: boolean; withBrand?: boolean } = {},
  ) {
    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: `owner-${Date.now()}-${Math.random()}@publyflow.test`,
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: `creator-${Date.now()}-${Math.random()}@publyflow.test`,
      fullName: "Thais",
      displayName: "Thais",
      instagramHandle: "@thais",
    });
    const [company] = options.withCompany
      ? await db.insert(companies).values({ organizationId: organization.id, name: "Bella Cosméticos" }).returning()
      : [null];
    const [brand] = options.withBrand
      ? await db
          .insert(brands)
          .values({ organizationId: organization.id, companyId: company?.id ?? null, name: "Bella Summer" })
          .returning()
      : [null];
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: organization.id, fullName: "Maria" })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({ organizationId: organization.id, creatorId: creator.id, contactId: contact.id, qualified: true })
      .returning();
    const [opportunity] = await db
      .insert(opportunities)
      .values({
        organizationId: organization.id,
        creatorId: creator.id,
        leadId: lead.id,
        companyId: company?.id ?? null,
        brandId: brand?.id ?? null,
      })
      .returning();
    const proposal = await ProposalService.create(db, organization.id, {
      opportunityId: opportunity.id,
      title: "Campanha Verão",
      theme: "EDITORIAL",
      userId: owner.id,
    });
    return { organization, proposal };
  }

  it("loads the draft snapshot, status, creator and brand name", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, proposal } = await setup(db, { withCompany: true, withBrand: true });

    const source = await ProposalPresentationService.loadPreviewSource(db, organization.id, proposal.id);

    expect(source).not.toBeNull();
    expect(source!.snapshot.proposal).toEqual({ title: "Campanha Verão", theme: "EDITORIAL", status: "DRAFT" });
    expect(source!.snapshot.blocks.map((block) => block.blockType).sort()).toEqual(["COVER", "TEXT"]);
    expect(source!.status).toBe("DRAFT");
    expect(source!.creator).toEqual({ displayName: "Thais", instagramHandle: "@thais" });
    expect(source!.clientName).toBe("Bella Summer");
  });

  it("uses the company name when there is no brand, and null when neither exists", async () => {
    const withCompany = await withTestDb();
    cleanup = withCompany.cleanup;
    const a = await setup(withCompany.db, { withCompany: true });
    expect((await ProposalPresentationService.loadPreviewSource(withCompany.db, a.organization.id, a.proposal.id))!.clientName).toBe(
      "Bella Cosméticos",
    );
    await withCompany.cleanup();

    const neither = await withTestDb();
    cleanup = neither.cleanup;
    const b = await setup(neither.db);
    expect((await ProposalPresentationService.loadPreviewSource(neither.db, b.organization.id, b.proposal.id))!.clientName).toBeNull();
  });

  it("returns null for a proposal of another organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { proposal } = await setup(db);
    const { organization: other } = await OrganizationService.createWithOwner(db, {
      organizationName: "Outra",
      ownerEmail: `other-${Date.now()}@publyflow.test`,
      ownerFullName: "Other",
    });

    expect(await ProposalPresentationService.loadPreviewSource(db, other.id, proposal.id)).toBeNull();
  });

  it("returns null for an unknown id and for a non-UUID id", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization } = await setup(db);

    expect(
      await ProposalPresentationService.loadPreviewSource(db, organization.id, "00000000-0000-4000-8000-000000000000"),
    ).toBeNull();
    expect(await ProposalPresentationService.loadPreviewSource(db, organization.id, "not-a-uuid")).toBeNull();
  });
});
