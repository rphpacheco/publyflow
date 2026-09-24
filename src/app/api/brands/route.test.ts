import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";
import { OrganizationService } from "@/services/organization.service";
import { BrandsRepository } from "@/repositories/brands.repository";

describe("GET /api/brands", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the organization's brands", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const brand = await BrandsRepository.create(db, organization.id, { name: "Linha Solar" });

    const { GET } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });

    const request = new Request("http://localhost/api/brands");
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.some((row: { id: string }) => row.id === brand.id)).toBe(true);
  });

  it("returns 401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { GET } = await importRouteWithSession(() => import("./route"), { db, session: null });

    const response = await GET(new Request("http://localhost/api/brands"));
    expect(response.status).toBe(401);
  });
});
