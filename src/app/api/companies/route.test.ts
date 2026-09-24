import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";
import { OrganizationService } from "@/services/organization.service";
import { CompaniesRepository } from "@/repositories/companies.repository";

describe("GET /api/companies", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the organization's companies", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const company = await CompaniesRepository.create(db, organization.id, {
      name: "Bella Cosméticos",
    });

    const { GET } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });

    const request = new Request("http://localhost/api/companies");
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.some((row: { id: string }) => row.id === company.id)).toBe(true);
  });

  it("returns 401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { GET } = await importRouteWithSession(() => import("./route"), { db, session: null });

    const response = await GET(new Request("http://localhost/api/companies"));
    expect(response.status).toBe(401);
  });

  it("ignores a caller-supplied organizationId and only returns the session organization's companies", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization: orgA, owner: ownerA } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org A",
      ownerEmail: "owner-a@publyflow.test",
      ownerFullName: "Owner A",
    });
    const { organization: orgB } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org B",
      ownerEmail: "owner-b@publyflow.test",
      ownerFullName: "Owner B",
    });
    const companyA = await CompaniesRepository.create(db, orgA.id, { name: "Empresa A" });
    await CompaniesRepository.create(db, orgB.id, { name: "Empresa B" });

    const { GET } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(orgA.id, ownerA.id),
    });

    const request = new Request(`http://localhost/api/companies?organizationId=${orgB.id}`);
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json).toHaveLength(1);
    expect(json[0].id).toBe(companyA.id);
  });
});
