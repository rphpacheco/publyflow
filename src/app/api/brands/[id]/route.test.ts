import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession, creatorSession } from "@/test/helpers/route";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { brands } from "@/db/schema/companies-brands-contacts";

describe("PATCH /api/brands/:id", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(session: "owner" | "creator" | "none" = "owner") {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const seeded = await seedProposal(db);
    const [brand] = await db
      .insert(brands)
      .values({ organizationId: seeded.organization.id, companyId: seeded.opportunity.companyId!, name: "Linha" })
      .returning();
    const foreign = await seedProposal(db);
    const sessionValue =
      session === "owner"
        ? ownerSession(seeded.organization.id, seeded.owner.id)
        : session === "creator"
          ? creatorSession(seeded.organization.id, seeded.owner.id, seeded.creator.id)
          : null;
    const { PATCH } = await importRouteWithSession(() => import("./route"), { db, session: sessionValue });
    const call = (id: string, body: unknown) =>
      PATCH(
        new Request(`http://localhost/api/brands/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id }) },
      );
    return { call, brandId: brand.id, foreignCompanyId: foreign.opportunity.companyId! };
  }

  it("renames and detaches the brand from its company", async () => {
    const { call, brandId } = await setup();
    const response = await call(brandId, { name: "Nova", companyId: null });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.name).toBe("Nova");
    expect(json.companyId).toBeNull();
  });

  it("returns 422 COMPANY_NOT_FOUND for a company of another organization", async () => {
    const { call, brandId, foreignCompanyId } = await setup();
    const response = await call(brandId, { companyId: foreignCompanyId });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Empresa selecionada não encontrada.", code: "COMPANY_NOT_FOUND" });
  });

  it("returns 400 when no field is informed", async () => {
    const { call, brandId } = await setup();
    const response = await call(brandId, {});
    expect(response.status).toBe(400);
    expect((await response.json()).errors.form).toBeDefined();
  });

  it("returns 404 for an unknown id", async () => {
    const { call } = await setup();
    const response = await call("00000000-0000-4000-8000-0000000000ff", { name: "X" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Brand não encontrada." });
  });

  it("returns 403 for a CREATOR and 401 without a session", async () => {
    expect((await (await setup("creator")).call("00000000-0000-4000-8000-0000000000ff", { name: "X" })).status).toBe(403);
    expect((await (await setup("none")).call("00000000-0000-4000-8000-0000000000ff", { name: "X" })).status).toBe(401);
  });
});
