import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { LeadsRepository } from "@/repositories/leads.repository";
import { contacts } from "@/db/schema/companies-brands-contacts";

describe("GET /api/leads/:id", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the lead when found", async () => {
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

    const request = new Request(`http://localhost/api/leads/${lead.id}`);
    const response = await GET(request, { params: Promise.resolve({ id: lead.id }) });
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.id).toBe(lead.id);
  });

  it("returns 404 when the lead does not exist", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner2@publyflow.test",
      ownerFullName: "Owner",
    });

    const { GET } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });

    const request = new Request(
      "http://localhost/api/leads/00000000-0000-0000-0000-000000000000",
    );
    const response = await GET(request, {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(response.status).toBe(404);

    const json = await response.json();
    expect(json.error).toContain("00000000-0000-0000-0000-000000000000");
  });

  it("returns 401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { GET } = await importRouteWithSession(() => import("./route"), { db, session: null });

    const request = new Request(
      "http://localhost/api/leads/00000000-0000-0000-0000-000000000000",
    );
    const response = await GET(request, {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(response.status).toBe(401);
  });
});
