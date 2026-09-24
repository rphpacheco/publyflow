import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";
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
    const lead = await LeadsRepository.create(db, organization.id, {
      creatorId: creator.id,
      inquiryId: null,
      contactId: contact!.id,
      companyId: null,
      brandId: null,
      qualified: true,
    });

    const { GET } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });

    const request = new Request(`http://localhost/api/leads?creatorId=${creator.id}`);
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.some((row: { id: string }) => row.id === lead.id)).toBe(true);
  });

  it("returns 401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { GET } = await importRouteWithSession(() => import("./route"), { db, session: null });

    const request = new Request(
      `http://localhost/api/leads?creatorId=00000000-0000-0000-0000-000000000000`,
    );
    const response = await GET(request);
    expect(response.status).toBe(401);
  });
});
