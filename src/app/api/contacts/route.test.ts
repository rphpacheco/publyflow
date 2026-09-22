import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations } from "@/db/schema/organizations";
import { ContactsRepository } from "@/repositories/contacts.repository";

describe("GET /api/contacts", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns 200 with the organization's contacts", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    vi.doMock("@/db", () => ({ db }));

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const contact = await ContactsRepository.create(db, org.id, { fullName: "Maria" });

    const { GET } = await import("./route");

    const request = new Request(`http://localhost/api/contacts?organizationId=${org.id}`);
    const response = await GET(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.some((row: { id: string }) => row.id === contact.id)).toBe(true);
  });
});
