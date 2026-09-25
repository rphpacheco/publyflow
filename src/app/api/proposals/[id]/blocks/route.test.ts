import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { ProposalService } from "@/services/proposal.service";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";

describe("GET /api/proposals/:id/blocks", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the proposal's blocks", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: "thais@publyflow.test",
      fullName: "Thais",
      displayName: "Thais",
    });
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
      .values({ organizationId: organization.id, creatorId: creator.id, leadId: lead.id, companyId: null, brandId: null })
      .returning();

    const proposal = await ProposalService.create(db, organization.id, {
      opportunityId: opportunity.id,
      title: "Campanha Verão",
      theme: "PREMIUM",
      userId: owner.id,
    });

    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });
    await POST(
      new Request(`http://localhost/api/proposals/${proposal.id}/blocks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          blockType: "COVER",
          content: { headline: "Campanha Verão" },
        }),
      }),
      { params: Promise.resolve({ id: proposal.id }) },
    );

    const { GET } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });
    const response = await GET(
      new Request(`http://localhost/api/proposals/${proposal.id}/blocks`),
      { params: Promise.resolve({ id: proposal.id }) },
    );
    expect(response.status).toBe(200);

    const json = await response.json();
    // Proposal is created with 2 auto-seeded blocks (COVER, TEXT), plus 1 from POST = 3 total
    expect(json).toHaveLength(3);
    // Check that at least one COVER block exists (from either auto-seeding or POST)
    const coverBlocks = json.filter((block: { blockType: string }) => block.blockType === "COVER");
    expect(coverBlocks.length).toBeGreaterThanOrEqual(2);
  });

  it("returns 401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { GET } = await importRouteWithSession(() => import("./route"), { db, session: null });

    const response = await GET(
      new Request("http://localhost/api/proposals/00000000-0000-0000-0000-000000000000/blocks"),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) },
    );
    expect(response.status).toBe(401);
  });
});

describe("POST /api/proposals/:id/blocks", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { POST } = await importRouteWithSession(() => import("./route"), { db, session: null });

    const response = await POST(
      new Request("http://localhost/api/proposals/00000000-0000-0000-0000-000000000000/blocks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blockType: "COVER", content: {} }),
      }),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) },
    );
    expect(response.status).toBe(401);
  });
});
