import { describe, it, expect, afterEach } from "vitest";
import { sql } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { RateCardsRepository } from "./rate-cards.repository";
import { RateCardNotFoundError } from "@/domain/rate-cards/errors";

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

  // Fix 5: `.returning()` yields no row for an unknown id, which previously
  // destructured to `undefined` but was mistyped as the non-nullable
  // RateCard -- setLocked() would resolve successfully without locking
  // anything.
  it("throws RateCardNotFoundError from setLocked for a nonexistent id", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();

    await expect(
      RateCardsRepository.setLocked(db, org.id, "00000000-0000-0000-0000-000000000000", true),
    ).rejects.toThrow(RateCardNotFoundError);
  });

  it("sets lockedAt when locking, both via setLocked and setLockedWithTx", async () => {
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

    const cardA = await RateCardsRepository.create(db, org.id, { creatorId: creator.id, name: "A" });
    const lockedA = await RateCardsRepository.setLocked(db, org.id, cardA.id, true);
    expect(lockedA.lockedAt).not.toBeNull();

    const cardB = await RateCardsRepository.create(db, org.id, { creatorId: creator.id, name: "B" });
    const lockedB = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.current_org_id', ${org.id}, true)`);
      return RateCardsRepository.setLockedWithTx(tx, org.id, cardB.id, true);
    });
    expect(lockedB.lockedAt).not.toBeNull();
  });
});
