import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations } from "@/db/schema/organizations";
import { BrandsRepository } from "./brands.repository";

describe("BrandsRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("lists every brand matching an exact name within the organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const created = await BrandsRepository.create(db, org.id, { name: "Linha Solar" });

    const matches = await BrandsRepository.listByName(db, org.id, "Linha Solar");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.id).toBe(created.id);

    const noMatches = await BrandsRepository.listByName(db, org.id, "Nome Inexistente");
    expect(noMatches).toEqual([]);

    await BrandsRepository.create(db, org.id, { name: "Linha Solar" });
    const duplicateMatches = await BrandsRepository.listByName(db, org.id, "Linha Solar");
    expect(duplicateMatches).toHaveLength(2);
  });
});
