import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { ServiceService } from "./service.service";
import { RateCardService } from "./rate-card.service";
import { RateCardsRepository } from "@/repositories/rate-cards.repository";
import { RateCardItemsRepository } from "@/repositories/rate-card-items.repository";

describe("RateCardService", () => {
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
});
