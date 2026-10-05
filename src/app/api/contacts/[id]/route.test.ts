import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession, creatorSession } from "@/test/helpers/route";
import { OrganizationService } from "@/services/organization.service";
import { ContactsRepository } from "@/repositories/contacts.repository";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { leads } from "@/db/schema/commercial-flow";
import { eq } from "drizzle-orm";

describe("GET /api/contacts/:id", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the contact when found", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: "owner@publyflow.test",
      ownerFullName: "Owner",
    });
    const contact = await ContactsRepository.create(db, organization.id, { fullName: "Maria" });

    const { GET } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });

    const request = new Request(`http://localhost/api/contacts/${contact.id}`);
    const response = await GET(request, { params: Promise.resolve({ id: contact.id }) });
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.contact.id).toBe(contact.id);
    expect(json.company).toBeNull();
    expect(json.opportunities).toEqual([]);
  });

  it("returns 404 when the contact does not exist", async () => {
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
      "http://localhost/api/contacts/00000000-0000-0000-0000-000000000000",
    );
    const response = await GET(request, {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(response.status).toBe(404);

    const json = await response.json();
    expect(json).toEqual({ error: "Contato não encontrado." });
  });

  it("returns 401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const { GET } = await importRouteWithSession(() => import("./route"), { db, session: null });

    const response = await GET(
      new Request("http://localhost/api/contacts/00000000-0000-0000-0000-000000000000"),
      { params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }) },
    );
    expect(response.status).toBe(401);
  });
});

describe("PATCH /api/contacts/:id", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(session: "owner" | "creator" | "none" = "owner") {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const seeded = await seedProposal(db);
    const [lead] = await db.select().from(leads).where(eq(leads.id, seeded.opportunity.leadId));
    const contactId = lead.contactId!;
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
        new Request(`http://localhost/api/contacts/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id }) },
      );
    return { call, contactId, foreignCompanyId: foreign.opportunity.companyId! };
  }

  it("updates the contact and clears an empty email", async () => {
    const { call, contactId } = await setup();
    const response = await call(contactId, { fullName: "Maria F.", email: "" });
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.fullName).toBe("Maria F.");
    expect(json.email).toBeNull();
  });

  it("returns 422 COMPANY_NOT_FOUND for a company of another organization", async () => {
    const { call, contactId, foreignCompanyId } = await setup();
    const response = await call(contactId, { companyId: foreignCompanyId });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Empresa selecionada não encontrada.", code: "COMPANY_NOT_FOUND" });
  });

  it("returns 400 with field errors for an invalid email", async () => {
    const { call, contactId } = await setup();
    const response = await call(contactId, { email: "nope" });
    expect(response.status).toBe(400);
    expect((await response.json()).errors.email).toBeDefined();
  });

  it("returns 400 when no field is informed", async () => {
    const { call, contactId } = await setup();
    const response = await call(contactId, {});
    expect(response.status).toBe(400);
    expect((await response.json()).errors.form).toBeDefined();
  });

  it("returns 404 for an unknown id", async () => {
    const { call } = await setup();
    const response = await call("00000000-0000-4000-8000-0000000000ff", { fullName: "X" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Contato não encontrado." });
  });

  it("returns 403 for a CREATOR and 401 without a session", async () => {
    expect((await (await setup("creator")).call("00000000-0000-4000-8000-0000000000ff", { fullName: "X" })).status).toBe(403);
    expect((await (await setup("none")).call("00000000-0000-4000-8000-0000000000ff", { fullName: "X" })).status).toBe(401);
  });
});
