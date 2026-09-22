import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations } from "@/db/schema/organizations";
import { ContactsRepository } from "./contacts.repository";

describe("ContactsRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("lists contacts by organization, ordered by createdAt desc", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const created = await ContactsRepository.create(db, org.id, { fullName: "Maria" });

    const list = await ContactsRepository.listByOrganization(db, org.id);
    expect(list.some((row) => row.id === created.id)).toBe(true);
  });

  it("lists contacts by organization, and finds one by id", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const created = await ContactsRepository.create(db, org.id, { fullName: "Maria" });

    const list = await ContactsRepository.listByOrganization(db, org.id);
    expect(list.some((row) => row.id === created.id)).toBe(true);

    const found = await ContactsRepository.findById(db, org.id, created.id);
    expect(found?.fullName).toBe("Maria");

    const notFound = await ContactsRepository.findById(db, org.id, "00000000-0000-0000-0000-000000000000");
    expect(notFound).toBeNull();
  });
});
