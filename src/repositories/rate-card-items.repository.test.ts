import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { services } from "@/db/schema/services";
import { rateCards } from "@/db/schema/rate-cards";
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

  it("finds a rate card item by id, and returns null for a nonexistent id", async () => {
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
    });

    const found = await RateCardItemsRepository.findById(db, org.id, created.id);
    expect(found?.id).toBe(created.id);

    const notFound = await RateCardItemsRepository.findById(
      db,
      org.id,
      "00000000-0000-0000-0000-000000000000",
    );
    expect(notFound).toBeNull();
  });

  it("listByCreator returns items enriched with service name, resolved unitDescription, only from active rate cards and active services", async () => {
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

    const [activeService] = await db
      .insert(services)
      .values({
        organizationId: org.id,
        creatorId: creator.id,
        name: "01 Reel",
        unitDescription: "por post",
      })
      .returning();
    const [inactiveService] = await db
      .insert(services)
      .values({ organizationId: org.id, creatorId: creator.id, name: "Story antigo", isActive: false })
      .returning();

    const [activeRateCard] = await db
      .insert(rateCards)
      .values({ organizationId: org.id, creatorId: creator.id, name: "Tabela 2026" })
      .returning();
    const [inactiveRateCard] = await db
      .insert(rateCards)
      .values({ organizationId: org.id, creatorId: creator.id, name: "Tabela 2024", isActive: false })
      .returning();

    // Visible: active rate card + active service, no own unitDescription -> falls back to service's.
    await RateCardItemsRepository.create(db, org.id, {
      rateCardId: activeRateCard.id,
      serviceId: activeService.id,
      price: 200000,
      sortOrder: 10,
    });
    // Visible: active rate card + active service, own unitDescription overrides service's.
    await RateCardItemsRepository.create(db, org.id, {
      rateCardId: activeRateCard.id,
      serviceId: activeService.id,
      price: 150000,
      unitDescription: "pacote de 3",
      sortOrder: 5,
    });
    // Hidden: rate card is inactive.
    await RateCardItemsRepository.create(db, org.id, {
      rateCardId: inactiveRateCard.id,
      serviceId: activeService.id,
      price: 999999,
    });
    // Hidden: service is inactive.
    await RateCardItemsRepository.create(db, org.id, {
      rateCardId: activeRateCard.id,
      serviceId: inactiveService.id,
      price: 999999,
    });

    const items = await RateCardItemsRepository.listByCreator(db, org.id, creator.id);

    expect(items).toHaveLength(2);
    // sortOrder 5 comes before sortOrder 10.
    expect(items[0].price).toBe(150000);
    expect(items[0].unitDescription).toBe("pacote de 3");
    expect(items[0].serviceName).toBe("01 Reel");
    expect(items[1].price).toBe(200000);
    expect(items[1].unitDescription).toBe("por post");
    expect(items[1].serviceName).toBe("01 Reel");
  });
});
