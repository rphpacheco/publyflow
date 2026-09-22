import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations } from "@/db/schema/organizations";
import { CompaniesRepository } from "@/repositories/companies.repository";

describe("GET /api/companies", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the organization's companies", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const company = await CompaniesRepository.create(db, org.id, { name: "Bella Cosméticos" });

    const { GET } = await import("./route");

    const request = new Request(`http://localhost/api/companies?organizationId=${org.id}`);
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.some((row: { id: string }) => row.id === company.id)).toBe(true);
  });
});
