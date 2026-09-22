import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { services } from "@/db/schema/services";
import { rateCards, rateCardItems } from "@/db/schema/rate-cards";
import { RateCardItemsRepository } from "./rate-card-items.repository";

describe("RateCardItemsRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("creates, updates, lists, and removes rate card items", async () => {
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

    const created = await RateCardItemsRepository.create(db, org.id, {
      rateCardId: rateCard.id,
      serviceId: service.id,
      price: 200000,
      sortOrder: 1,
    });

    expect(created.price).toBe(200000);
    expect(created.sortOrder).toBe(1);

    const updated = await RateCardItemsRepository.update(db, org.id, created.id, {
      price: 250000,
    });
    expect(updated.price).toBe(250000);

    const list = await RateCardItemsRepository.listByRateCard(db, org.id, rateCard.id);
    expect(list).toHaveLength(1);

    await RateCardItemsRepository.remove(db, org.id, created.id);

    const listAfterRemove = await RateCardItemsRepository.listByRateCard(db, org.id, rateCard.id);
    expect(listAfterRemove).toHaveLength(0);
  });
});
