import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { ProposalService } from "@/services/proposal.service";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";

describe("POST /api/proposals/:id/items", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 201 with the created ad-hoc item", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

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
    const [contact] = await db.insert(contacts).values({ organizationId: organization.id, fullName: "Maria" }).returning();
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
      title: "P",
      template: "PREMIUM",
      userId: owner.id,
    });

    const { POST } = await import("./route");

    const request = new Request(`http://localhost/api/proposals/${proposal.id}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: organization.id,
        userId: owner.id,
        description: "Desconto negociado",
        unitPrice: -50000,
      }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: proposal.id }) });
    expect(response.status).toBe(201);

    const json = await response.json();
    expect(json.description).toBe("Desconto negociado");
  });
});
