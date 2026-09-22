import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "./organizations";
import { creators } from "./creators";
import { rateCards } from "./rate-cards";

describe("rate_cards schema", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("stores a rate card scoped to organization and creator, defaulting isActive true and isLocked false", async () => {
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

    const [rateCard] = await db
      .insert(rateCards)
      .values({ organizationId: org.id, creatorId: creator.id, name: "Tabela 2026" })
      .returning();

    expect(rateCard.isActive).toBe(true);
    expect(rateCard.isLocked).toBe(false);
    expect(rateCard.validFrom).toBeNull();
    expect(rateCard.validTo).toBeNull();
  });

  it("accepts an explicit validFrom/validTo window", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: "thais2@publyflow.test", fullName: "Thais" })
      .returning();
    const [creator] = await db
      .insert(creators)
      .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
      .returning();

    const validFrom = new Date("2026-11-20T00:00:00Z");
    const validTo = new Date("2026-11-30T23:59:59Z");

    const [rateCard] = await db
      .insert(rateCards)
      .values({
        organizationId: org.id,
        creatorId: creator.id,
        name: "Tabela Black Friday",
        validFrom,
        validTo,
      })
      .returning();

    expect(rateCard.validFrom).toEqual(validFrom);
    expect(rateCard.validTo).toEqual(validTo);
  });
});
