import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession, creatorSession } from "@/test/helpers/route";
import { OrganizationService } from "@/services/organization.service";
import { CompaniesRepository } from "@/repositories/companies.repository";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { companies } from "@/db/schema/companies-brands-contacts";

describe("GET /api/companies/:id", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the company when found", async () => {
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

    const request = new Request(`http://localhost/api/companies/${company.id}`);
    const response = await GET(request, { params: Promise.resolve({ id: company.id }) });
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.company.id).toBe(company.id);
    expect(json.brands).toEqual([]);
    expect(json.contacts).toEqual([]);
    expect(json.opportunities).toEqual([]);
  });

  it("returns 404 when the company does not exist", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });

    const { GET } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });

    const request = new Request(
      "http://localhost/api/companies/00000000-0000-0000-0000-000000000000",
    );
    const response = await GET(request, {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(response.status).toBe(404);

    const json = await response.json();
    expect(json).toEqual({ error: "Empresa não encontrada." });
  });

  it("returns 401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { GET } = await importRouteWithSession(() => import("./route"), { db, session: null });

    const response = await GET(
      new Request("http://localhost/api/companies/00000000-0000-0000-0000-000000000000"),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) },
    );
    expect(response.status).toBe(401);
  });
});

describe("PATCH /api/companies/:id", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(session: "owner" | "creator" | "none" = "owner") {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const seeded = await seedProposal(db);
    const companyId = seeded.opportunity.companyId!;
    await db.insert(companies).values({ organizationId: seeded.organization.id, name: "Outra" });
    const sessionValue =
      session === "owner"
        ? ownerSession(seeded.organization.id, seeded.owner.id)
        : session === "creator"
          ? creatorSession(seeded.organization.id, seeded.owner.id, seeded.creator.id)
          : null;
    const { PATCH } = await importRouteWithSession(() => import("./route"), { db, session: sessionValue });
    const call = (id: string, body: unknown) =>
      PATCH(
        new Request(`http://localhost/api/companies/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id }) },
      );
    return { call, companyId };
  }

  it("renames the company", async () => {
    const { call, companyId } = await setup();
    const response = await call(companyId, { name: "  Bella Ltda  " });
    expect(response.status).toBe(200);
    expect((await response.json()).name).toBe("Bella Ltda");
  });

  it("returns 409 COMPANY_NAME_TAKEN for a duplicate name", async () => {
    const { call, companyId } = await setup();
    const response = await call(companyId, { name: "OUTRA" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Já existe uma empresa com esse nome.", code: "COMPANY_NAME_TAKEN" });
  });

  it("returns 400 with field errors for an empty name", async () => {
    const { call, companyId } = await setup();
    const response = await call(companyId, { name: " " });
    expect(response.status).toBe(400);
    expect((await response.json()).errors.name).toBeDefined();
  });

  it("returns 404 for an unknown id", async () => {
    const { call } = await setup();
    const response = await call("00000000-0000-4000-8000-0000000000ff", { name: "X" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Empresa não encontrada." });
  });

  it("returns 403 for a CREATOR and 401 without a session", async () => {
    expect((await (await setup("creator")).call("00000000-0000-4000-8000-0000000000ff", { name: "X" })).status).toBe(403);
    expect((await (await setup("none")).call("00000000-0000-4000-8000-0000000000ff", { name: "X" })).status).toBe(401);
  });
});
