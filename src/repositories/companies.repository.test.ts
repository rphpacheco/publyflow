import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations } from "@/db/schema/organizations";
import { CompaniesRepository } from "./companies.repository";

describe("CompaniesRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("lists every company matching an exact name within the organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const created = await CompaniesRepository.create(db, org.id, { name: "Bella Cosméticos" });

    const matches = await CompaniesRepository.listByName(db, org.id, "Bella Cosméticos");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.id).toBe(created.id);

    const noMatches = await CompaniesRepository.listByName(db, org.id, "Nome Inexistente");
    expect(noMatches).toEqual([]);

    // Two companies can legitimately share the exact same name (no uniqueness
    // constraint on `name`) -- listByName must surface both, not silently
    // pick one, since that's the whole point of this method existing.
    await CompaniesRepository.create(db, org.id, { name: "Bella Cosméticos" });
    const duplicateMatches = await CompaniesRepository.listByName(db, org.id, "Bella Cosméticos");
    expect(duplicateMatches).toHaveLength(2);
  });

  it("lists companies by organization, and finds one by id", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const created = await CompaniesRepository.create(db, org.id, { name: "Bella Cosméticos" });

    const list = await CompaniesRepository.listByOrganization(db, org.id);
    expect(list.some((row) => row.id === created.id)).toBe(true);

    const found = await CompaniesRepository.findById(db, org.id, created.id);
    expect(found?.name).toBe("Bella Cosméticos");

    const notFound = await CompaniesRepository.findById(db, org.id, "00000000-0000-0000-0000-000000000000");
    expect(notFound).toBeNull();
  });
});
