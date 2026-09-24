import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";
import { OrganizationService } from "@/services/organization.service";
import { ContactsRepository } from "@/repositories/contacts.repository";

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
    expect(json.id).toBe(contact.id);
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
    expect(json.error).toContain("00000000-0000-0000-0000-000000000000");
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
