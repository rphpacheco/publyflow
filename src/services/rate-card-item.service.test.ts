import { describe, it, expect, afterEach } from "vitest";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { services } from "@/db/schema/services";
import { rateCards } from "@/db/schema/rate-cards";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { ServiceService } from "./service.service";
import { RateCardService } from "./rate-card.service";
import { RateCardItemService } from "./rate-card-item.service";
import {
  RateCardLockedError,
  RateCardItemNotFoundError,
  RateCardNotFoundError,
  ServiceNotFoundError,
  ServiceMismatchError,
} from "@/domain/rate-cards/errors";

describe("RateCardItemService", () => {
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

  it("rejects adding an item whose rateCardId belongs to a different organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, service } = await setup(db);

    const otherOrg = await OrganizationService.createWithOwner(db, {
      organizationName: "Other Org",
      ownerEmail: `owner-other-${Date.now()}-${Math.random()}@publyflow.test`,
      ownerFullName: "Owner",
    });
    const otherCreator = await CreatorService.onboardCreator(db, otherOrg.organization.id, {
      email: `creator-other-${Date.now()}-${Math.random()}@publyflow.test`,
      fullName: "Other Creator",
      displayName: "Other Creator",
    });
    const foreignRateCard = await RateCardService.create(db, otherOrg.organization.id, {
      creatorId: otherCreator.id,
      name: "Tabela de outra org",
    });

    // The caller's own org has no rate card with this id -- the FK would
    // otherwise happily accept it and insert a rate_card_items row whose
    // organization_id is `organization.id` but whose rate_card_id points
    // at another organization's rate card.
    await expect(
      RateCardItemService.addItem(db, organization.id, {
        rateCardId: foreignRateCard.id,
        serviceId: service.id,
        price: 200000,
      }),
    ).rejects.toThrow(RateCardNotFoundError);
  });

  it("rejects adding an item whose serviceId belongs to a different organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, rateCard } = await setup(db);

    const otherOrg = await OrganizationService.createWithOwner(db, {
      organizationName: "Other Org",
      ownerEmail: `owner-other2-${Date.now()}-${Math.random()}@publyflow.test`,
      ownerFullName: "Owner",
    });
    const otherCreator = await CreatorService.onboardCreator(db, otherOrg.organization.id, {
      email: `creator-other2-${Date.now()}-${Math.random()}@publyflow.test`,
      fullName: "Other Creator",
      displayName: "Other Creator",
    });
    const foreignService = await ServiceService.create(db, otherOrg.organization.id, {
      creatorId: otherCreator.id,
      name: "Serviço de outra org",
    });

    await expect(
      RateCardItemService.addItem(db, organization.id, {
        rateCardId: rateCard.id,
        serviceId: foreignService.id,
        price: 200000,
      }),
    ).rejects.toThrow(ServiceNotFoundError);
  });

  it("rejects adding an item whose service belongs to a different creator than the rate card", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, rateCard } = await setup(db);

    const otherCreator = await CreatorService.onboardCreator(db, organization.id, {
      email: `creator-other3-${Date.now()}-${Math.random()}@publyflow.test`,
      fullName: "Other Creator",
      displayName: "Other Creator",
    });
    const otherCreatorService = await ServiceService.create(db, organization.id, {
      creatorId: otherCreator.id,
      name: "Serviço de outro creator",
    });

    // Same org, so no FK/RLS issue -- but the rate card's items must all
    // belong to the same creator as the rate card itself.
    await expect(
      RateCardItemService.addItem(db, organization.id, {
        rateCardId: rateCard.id,
        serviceId: otherCreatorService.id,
        price: 200000,
      }),
    ).rejects.toThrow(ServiceMismatchError);
  });

  it("listByCreator delegates to the repository", async () => {
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

    await RateCardItemService.addItem(db, org.id, {
      rateCardId: rateCard.id,
      serviceId: service.id,
      price: 200000,
    });

    const items = await RateCardItemService.listByCreator(db, org.id, creator.id);
    expect(items).toHaveLength(1);
    expect(items[0].serviceName).toBe("01 Reel");
  });
});
