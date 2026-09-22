import { describe, it, expect, afterEach, vi } from "vitest";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { ServiceService } from "./service.service";
import { RateCardService } from "./rate-card.service";
import { RateCardsRepository } from "@/repositories/rate-cards.repository";
import { RateCardItemsRepository } from "@/repositories/rate-card-items.repository";
import { RateCardNotFoundError } from "@/domain/rate-cards/errors";

describe("RateCardService", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(db: NodePgDatabase<typeof schema>) {
    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: `owner-${Date.now()}-${Math.random()}@publyflow.test`,
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: `creator-${Date.now()}-${Math.random()}@publyflow.test`,
      fullName: "Thais",
      displayName: "Thais",
    });
    return { organization, creator };
  }

  it("creates and lists rate cards for a creator", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, creator } = await setup(db);

    await RateCardService.create(db, organization.id, {
      creatorId: creator.id,
      name: "Tabela 2026",
    });

    const list = await RateCardService.listByCreator(db, organization.id, creator.id);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Tabela 2026");
  });

  it("locks a rate card", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, creator } = await setup(db);

    const rateCard = await RateCardService.create(db, organization.id, {
      creatorId: creator.id,
      name: "Tabela 2026",
    });

    const locked = await RateCardService.lock(db, organization.id, rateCard.id);
    expect(locked.isLocked).toBe(true);
  });

  // Fix 5: lock() must not resolve successfully without actually locking
  // anything -- a future caller (the Proposals subsystem) could otherwise
  // misread a silent no-op as "locked".
  it("throws RateCardNotFoundError when locking an unknown rate card id", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization } = await setup(db);

    await expect(
      RateCardService.lock(db, organization.id, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(RateCardNotFoundError);
  });

  it("duplicates a locked rate card into a new, unlocked one with the same items", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, creator } = await setup(db);

    const service = await ServiceService.create(db, organization.id, {
      creatorId: creator.id,
      name: "01 Reel",
    });

    const original = await RateCardService.create(db, organization.id, {
      creatorId: creator.id,
      name: "Tabela 2026",
    });

    await RateCardItemsRepository.create(db, organization.id, {
      rateCardId: original.id,
      serviceId: service.id,
      price: 200000,
      sortOrder: 1,
    });

    await RateCardsRepository.setLocked(db, organization.id, original.id, true);

    const { rateCard: duplicated, items } = await RateCardService.duplicate(
      db,
      organization.id,
      original.id,
      { name: "Tabela 2027" },
    );

    expect(duplicated.id).not.toBe(original.id);
    expect(duplicated.name).toBe("Tabela 2027");
    expect(duplicated.isLocked).toBe(false);
    expect(items).toHaveLength(1);
    expect(items[0].rateCardId).toBe(duplicated.id);
    expect(items[0].price).toBe(200000);

    const originalItems = await RateCardItemsRepository.listByRateCard(
      db,
      organization.id,
      original.id,
    );
    expect(originalItems).toHaveLength(1);
  });

  it("rolls back the whole duplicate() if an item copy fails partway through", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, creator } = await setup(db);

    const serviceA = await ServiceService.create(db, organization.id, {
      creatorId: creator.id,
      name: "01 Reel",
    });
    const serviceB = await ServiceService.create(db, organization.id, {
      creatorId: creator.id,
      name: "02 Story",
    });

    const original = await RateCardService.create(db, organization.id, {
      creatorId: creator.id,
      name: "Tabela 2026",
    });
    await RateCardItemsRepository.create(db, organization.id, {
      rateCardId: original.id,
      serviceId: serviceA.id,
      price: 200000,
      sortOrder: 1,
    });
    await RateCardItemsRepository.create(db, organization.id, {
      rateCardId: original.id,
      serviceId: serviceB.id,
      price: 300000,
      sortOrder: 2,
    });

    // Simulate a failure partway through item copying: the new rate card
    // and the first item insert succeed, then the second item's insert
    // throws. This proves the whole operation shares one transaction --
    // if it didn't, the new rate card and the first copied item would
    // remain committed despite the second item's insert failing.
    const originalCreateWithTx = RateCardItemsRepository.createWithTx;
    let callCount = 0;
    const createSpy = vi
      .spyOn(RateCardItemsRepository, "createWithTx")
      .mockImplementation(async (...args) => {
        callCount += 1;
        if (callCount === 2) {
          throw new Error("simulated item copy failure");
        }
        return originalCreateWithTx(...args);
      });

    try {
      await expect(
        RateCardService.duplicate(db, organization.id, original.id, { name: "Tabela 2027" }),
      ).rejects.toThrow("simulated item copy failure");
    } finally {
      createSpy.mockRestore();
    }

    const remainingRateCards = await RateCardsRepository.listByCreator(db, organization.id, creator.id);
    expect(remainingRateCards).toHaveLength(1);
    expect(remainingRateCards[0].id).toBe(original.id);

    const remainingOriginalItems = await RateCardItemsRepository.listByRateCard(
      db,
      organization.id,
      original.id,
    );
    expect(remainingOriginalItems).toHaveLength(2);
  });
});
