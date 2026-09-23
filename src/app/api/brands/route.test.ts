import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations } from "@/db/schema/organizations";
import { BrandsRepository } from "@/repositories/brands.repository";

describe("GET /api/brands", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the organization's brands", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const brand = await BrandsRepository.create(db, org.id, { name: "Linha Solar" });

    const { GET } = await import("./route");

    const request = new Request(`http://localhost/api/brands?organizationId=${org.id}`);
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.some((row: { id: string }) => row.id === brand.id)).toBe(true);
  });
});
