import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { services } from "@/db/schema/services";
import { rateCards, rateCardItems } from "@/db/schema/rate-cards";
import { RateCardItemsRepository } from "./rate-card-items.repository";
import { RateCardItemNotFoundError } from "@/domain/rate-cards/errors";

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

    const updated = await RateCardItemsRepository.update(db, org.id, created.id, rateCard.id, {
      price: 250000,
    });
    expect(updated.price).toBe(250000);

    const list = await RateCardItemsRepository.listByRateCard(db, org.id, rateCard.id);
    expect(list).toHaveLength(1);

    await RateCardItemsRepository.remove(db, org.id, created.id, rateCard.id);

    const listAfterRemove = await RateCardItemsRepository.listByRateCard(db, org.id, rateCard.id);
    expect(listAfterRemove).toHaveLength(0);
  });

  it("throws RateCardItemNotFoundError when the item does not belong to the claimed rate card", async () => {
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
    const [rateCardA] = await db
      .insert(rateCards)
      .values({ organizationId: org.id, creatorId: creator.id, name: "Tabela A" })
      .returning();
    const [rateCardB] = await db
      .insert(rateCards)
      .values({ organizationId: org.id, creatorId: creator.id, name: "Tabela B" })
      .returning();

    const item = await RateCardItemsRepository.create(db, org.id, {
      rateCardId: rateCardB.id,
      serviceId: service.id,
      price: 200000,
    });

    // Claiming rateCardA (the wrong rate card) for an item that actually
    // belongs to rateCardB must fail, not silently update/delete the item
    // anyway and not silently no-op while reporting success.
    await expect(
      RateCardItemsRepository.update(db, org.id, item.id, rateCardA.id, { price: 300000 }),
    ).rejects.toThrow(RateCardItemNotFoundError);

    await expect(
      RateCardItemsRepository.remove(db, org.id, item.id, rateCardA.id),
    ).rejects.toThrow(RateCardItemNotFoundError);

    // The item must be untouched by the failed update attempt.
    const list = await RateCardItemsRepository.listByRateCard(db, org.id, rateCardB.id);
    expect(list).toHaveLength(1);
    expect(list[0].price).toBe(200000);
  });
});
