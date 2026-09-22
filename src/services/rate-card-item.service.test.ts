import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { ServiceService } from "./service.service";
import { RateCardService } from "./rate-card.service";
import { RateCardItemService } from "./rate-card-item.service";
import { RateCardLockedError, RateCardItemNotFoundError } from "@/domain/rate-cards/errors";

describe("RateCardItemService", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(db: any) {
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
    const service = await ServiceService.create(db, organization.id, {
      creatorId: creator.id,
      name: "01 Reel",
    });
    const rateCard = await RateCardService.create(db, organization.id, {
      creatorId: creator.id,
      name: "Tabela 2026",
    });
    return { organization, creator, service, rateCard };
  }

  it("adds, updates, and removes an item on an unlocked rate card", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, service, rateCard } = await setup(db);

    const item = await RateCardItemService.addItem(db, organization.id, {
      rateCardId: rateCard.id,
      serviceId: service.id,
      price: 200000,
    });

    const updated = await RateCardItemService.updateItem(
      db,
      organization.id,
      item.id,
      rateCard.id,
      { price: 250000 },
    );
    expect(updated.price).toBe(250000);

    await RateCardItemService.removeItem(db, organization.id, item.id, rateCard.id);
  });

  it("rejects adding an item to a locked rate card", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, service, rateCard } = await setup(db);

    await RateCardService.lock(db, organization.id, rateCard.id);

    await expect(
      RateCardItemService.addItem(db, organization.id, {
        rateCardId: rateCard.id,
        serviceId: service.id,
        price: 200000,
      }),
    ).rejects.toThrow(RateCardLockedError);
  });

  it("rejects updating an item on a locked rate card", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, service, rateCard } = await setup(db);

    const item = await RateCardItemService.addItem(db, organization.id, {
      rateCardId: rateCard.id,
      serviceId: service.id,
      price: 200000,
    });

    await RateCardService.lock(db, organization.id, rateCard.id);

    await expect(
      RateCardItemService.updateItem(db, organization.id, item.id, rateCard.id, {
        price: 300000,
      }),
    ).rejects.toThrow(RateCardLockedError);
  });

  it("rejects removing an item from a locked rate card", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, service, rateCard } = await setup(db);

    const item = await RateCardItemService.addItem(db, organization.id, {
      rateCardId: rateCard.id,
      serviceId: service.id,
      price: 200000,
    });

    await RateCardService.lock(db, organization.id, rateCard.id);

    await expect(
      RateCardItemService.removeItem(db, organization.id, item.id, rateCard.id),
    ).rejects.toThrow(RateCardLockedError);
  });

  it("rejects updating/removing a locked rate card's item when the caller claims a different, unlocked rateCardId", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, creator, service } = await setup(db);

    const unlockedRateCard = await RateCardService.create(db, organization.id, {
      creatorId: creator.id,
      name: "Tabela Destravada",
    });
    const lockedRateCard = await RateCardService.create(db, organization.id, {
      creatorId: creator.id,
      name: "Tabela Travada",
    });

    const item = await RateCardItemService.addItem(db, organization.id, {
      rateCardId: lockedRateCard.id,
      serviceId: service.id,
      price: 200000,
    });

    await RateCardService.lock(db, organization.id, lockedRateCard.id);

    // Attacker passes the real (locked) item's id but claims the unlocked
    // rate card's id in the request body. assertNotLocked checks the wrong
    // (unlocked) card and passes — the repository's rateCardId filter must
    // be what actually blocks the write.
    await expect(
      RateCardItemService.updateItem(db, organization.id, item.id, unlockedRateCard.id, {
        price: 999999,
      }),
    ).rejects.toThrow(RateCardItemNotFoundError);

    await expect(
      RateCardItemService.removeItem(db, organization.id, item.id, unlockedRateCard.id),
    ).rejects.toThrow(RateCardItemNotFoundError);
  });
});
