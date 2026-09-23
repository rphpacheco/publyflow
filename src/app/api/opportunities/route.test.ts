import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { OpportunityService } from "@/services/opportunity.service";
import { contacts, companies } from "@/db/schema/companies-brands-contacts";
import { leads } from "@/db/schema/commercial-flow";

describe("GET /api/opportunities", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the creator's opportunities", async () => {
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

    const { GET } = await import("./route");

    const request = new Request(
      `http://localhost/api/opportunities?organizationId=${organization.id}&creatorId=${creator.id}`,
    );
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.some((row: { id: string }) => row.id === opportunity.id)).toBe(true);

    const enrichedRow = json.find((row: { id: string }) => row.id === opportunity.id);
    expect(enrichedRow.companyName).toBe("Bella Cosméticos");
    expect(enrichedRow.contactName).toBe("Maria");
    expect(enrichedRow.brandName).toBeNull();
  });
});
