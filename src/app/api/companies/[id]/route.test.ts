import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations } from "@/db/schema/organizations";
import { CompaniesRepository } from "@/repositories/companies.repository";

describe("GET /api/companies/:id", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the company when found", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const company = await CompaniesRepository.create(db, org.id, { name: "Bella Cosméticos" });

    const { GET } = await import("./route");

    const request = new Request(
      `http://localhost/api/companies/${company.id}?organizationId=${org.id}`,
    );
    const response = await GET(request, { params: Promise.resolve({ id: company.id }) });
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.id).toBe(company.id);
  });

  it("returns 404 when the company does not exist", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();

    const { GET } = await import("./route");

    const request = new Request(
      `http://localhost/api/companies/00000000-0000-0000-0000-000000000000?organizationId=${org.id}`,
    );
    const response = await GET(request, {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(response.status).toBe(404);

    const json = await response.json();
    expect(json.error).toContain("00000000-0000-0000-0000-000000000000");
  });
});
