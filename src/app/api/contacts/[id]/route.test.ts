import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations } from "@/db/schema/organizations";
import { ContactsRepository } from "@/repositories/contacts.repository";

describe("GET /api/contacts/:id", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the contact when found", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const contact = await ContactsRepository.create(db, org.id, { fullName: "Maria" });

    const { GET } = await import("./route");

    const request = new Request(
      `http://localhost/api/contacts/${contact.id}?organizationId=${org.id}`,
    );
    const response = await GET(request, { params: Promise.resolve({ id: contact.id }) });
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.id).toBe(contact.id);
  });

  it("returns 404 when the contact does not exist", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();

    const { GET } = await import("./route");

    const request = new Request(
      `http://localhost/api/contacts/00000000-0000-0000-0000-000000000000?organizationId=${org.id}`,
    );
    const response = await GET(request, {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(response.status).toBe(404);

    const json = await response.json();
    expect(json.error).toContain("00000000-0000-0000-0000-000000000000");
  });
});
