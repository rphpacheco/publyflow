import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { LeadsRepository } from "@/repositories/leads.repository";
import { contacts } from "@/db/schema/companies-brands-contacts";

describe("GET /api/leads", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the creator's leads", async () => {
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

    const { GET } = await import("./route");

    const request = new Request(
      `http://localhost/api/leads?organizationId=${organization.id}&creatorId=${creator.id}`,
    );
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.some((row: { id: string }) => row.id === lead.id)).toBe(true);
  });
});
