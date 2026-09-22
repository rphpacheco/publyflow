import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { OpportunityService } from "@/services/opportunity.service";
import { companies, contacts } from "@/db/schema/companies-brands-contacts";
import { leads } from "@/db/schema/commercial-flow";

describe("PATCH /api/opportunities/:id", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the updated opportunity and records stage history", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: "thais@publyflow.test",
      fullName: "Thais",
      displayName: "Thais",
    });
    const [company] = await db
      .insert(companies)
      .values({ organizationId: organization.id, name: "Bella Cosméticos" })
      .returning();
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: organization.id, fullName: "Maria" })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({
        organizationId: organization.id,
        creatorId: creator.id,
        contactId: contact.id,
        companyId: company.id,
        qualified: true,
      })
      .returning();
    const opportunity = await OpportunityService.createFromLead(db, organization.id, {
      leadId: lead.id,
      creatorId: creator.id,
      companyId: company.id,
      brandId: null,
    });

    const { PATCH } = await import("./route");

    const request = new Request(`http://localhost/api/opportunities/${opportunity.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: organization.id, stage: "PRIMEIRO_CONTATO" }),
    });

    const response = await PATCH(request, { params: Promise.resolve({ id: opportunity.id }) });
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.stage).toBe("PRIMEIRO_CONTATO");
  });

  it("returns 404 when the opportunity does not exist", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner2@publyflow.test",
      ownerFullName: "Owner",
    });

    const { PATCH } = await import("./route");

    const request = new Request(
      "http://localhost/api/opportunities/00000000-0000-0000-0000-000000000000",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId: organization.id, stage: "PRIMEIRO_CONTATO" }),
      },
    );

    const response = await PATCH(request, {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(response.status).toBe(404);
  });
});
