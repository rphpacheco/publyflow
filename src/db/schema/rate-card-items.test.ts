import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "./organizations";
import { creators } from "./creators";
import { services } from "./services";
import { rateCards, rateCardItems } from "./rate-cards";

describe("rate_card_items schema", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("stores an item linked to a rate card and a service, with sortOrder defaulting to 0", async () => {
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
    const [service] = await db
      .insert(services)
      .values({ organizationId: org.id, creatorId: creator.id, name: "01 Reel" })
      .returning();
    const [rateCard] = await db
      .insert(rateCards)
      .values({ organizationId: org.id, creatorId: creator.id, name: "Tabela 2026" })
      .returning();

    const [item] = await db
      .insert(rateCardItems)
      .values({
        organizationId: org.id,
        rateCardId: rateCard.id,
        serviceId: service.id,
        price: 200000,
      })
      .returning();

    expect(item.rateCardId).toBe(rateCard.id);
    expect(item.serviceId).toBe(service.id);
    expect(item.price).toBe(200000);
    expect(item.sortOrder).toBe(0);
  });

  it("rejects deleting a service that is referenced by a rate card item", async () => {
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
    const [service] = await db
      .insert(services)
      .values({ organizationId: org.id, creatorId: creator.id, name: "01 Reel" })
      .returning();
    const [rateCard] = await db
      .insert(rateCards)
      .values({ organizationId: org.id, creatorId: creator.id, name: "Tabela 2026" })
      .returning();
    await db.insert(rateCardItems).values({
      organizationId: org.id,
      rateCardId: rateCard.id,
      serviceId: service.id,
      price: 200000,
    });

    const { eq } = await import("drizzle-orm");
    await expect(db.delete(services).where(eq(services.id, service.id))).rejects.toThrow();
  });
});
