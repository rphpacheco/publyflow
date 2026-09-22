import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { RateCardsRepository } from "./rate-cards.repository";

describe("RateCardsRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("creates a rate card, finds it by id, lists by creator, and locks it", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: "thais@publyflow.test", fullName: "Thais" })
      .returning();
    const [creator] = await db
      .insert(creators)
      .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
      .returning();

    const created = await RateCardsRepository.create(db, org.id, {
      creatorId: creator.id,
      name: "Tabela 2026",
    });

    expect(created.isLocked).toBe(false);

    const found = await RateCardsRepository.findById(db, org.id, created.id);
    expect(found?.id).toBe(created.id);

    const list = await RateCardsRepository.listByCreator(db, org.id, creator.id);
    expect(list).toHaveLength(1);

    const locked = await RateCardsRepository.setLocked(db, org.id, created.id, true);
    expect(locked.isLocked).toBe(true);
  });

  it("returns null from findById for a nonexistent id", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();

    const found = await RateCardsRepository.findById(
      db,
      org.id,
      "00000000-0000-0000-0000-000000000000",
    );
    expect(found).toBeNull();
  });
});
