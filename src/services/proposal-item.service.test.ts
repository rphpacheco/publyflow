import { describe, it, expect, afterEach } from "vitest";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { ServiceService } from "./service.service";
import { RateCardService } from "./rate-card.service";
import { ProposalService } from "./proposal.service";
import { ProposalItemService } from "./proposal-item.service";
import { RateCardsRepository } from "@/repositories/rate-cards.repository";
import { RateCardItemsRepository } from "@/repositories/rate-card-items.repository";
import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";
import { RateCardItemCreatorMismatchError } from "@/domain/proposals/errors";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";

describe("ProposalItemService", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup(db: NodePgDatabase<typeof schema>) {
    const { organization, owner } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: `owner-${Date.now()}-${Math.random()}@publyflow.test`,
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: `creator-${Date.now()}-${Math.random()}@publyflow.test`,
      fullName: "Thais",
      displayName: "Thais",
    });
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: organization.id, fullName: "Maria" })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({ organizationId: organization.id, creatorId: creator.id, contactId: contact.id, qualified: true })
      .returning();
    const [opportunity] = await db
      .insert(opportunities)
      .values({ organizationId: organization.id, creatorId: creator.id, leadId: lead.id, companyId: null, brandId: null })
      .returning();
    const proposal = await ProposalService.create(db, organization.id, {
      opportunityId: opportunity.id,
      title: "P",
      template: "PREMIUM",
      userId: owner.id,
    });
    return { organization, owner, creator, opportunity, proposal };
  }

  it("adds an ad-hoc item and writes a new version, without touching any rate card", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await setup(db);

    const item = await ProposalItemService.addItem(db, organization.id, {
      proposalId: proposal.id,
      description: "Desconto negociado",
      unitPrice: -50000,
      userId: owner.id,
    });

    expect(item.rateCardItemId).toBeNull();

    const versions = await ProposalVersionsRepository.listByProposal(db, organization.id, proposal.id);
    expect(versions).toHaveLength(2); // version 1 at proposal creation, version 2 for this item
  });

  it("adds a catalog item, copies its price, and locks the source rate card", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, creator, proposal } = await setup(db);

    const service = await ServiceService.create(db, organization.id, { creatorId: creator.id, name: "01 Reel" });
    const rateCard = await RateCardService.create(db, organization.id, { creatorId: creator.id, name: "Tabela" });
    const rateCardItem = await RateCardItemsRepository.create(db, organization.id, {
      rateCardId: rateCard.id,
      serviceId: service.id,
      price: 200000,
    });

    const item = await ProposalItemService.addItem(db, organization.id, {
      proposalId: proposal.id,
      rateCardItemId: rateCardItem.id,
      userId: owner.id,
    });

    expect(item.unitPrice).toBe(200000);
    expect(item.description).toBe("01 Reel");

    const lockedCard = await RateCardsRepository.findById(db, organization.id, rateCard.id);
    expect(lockedCard?.isLocked).toBe(true);
    expect(lockedCard?.lockedAt).not.toBeNull();
  });

  it("rejects a rate card item whose rate card belongs to a different creator than the opportunity", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await setup(db);

    const otherCreator = await CreatorService.onboardCreator(db, organization.id, {
      email: `other-${Date.now()}@publyflow.test`,
      fullName: "Outro Creator",
      displayName: "Outro Creator",
    });
    const service = await ServiceService.create(db, organization.id, {
      creatorId: otherCreator.id,
      name: "01 Reel",
    });
    const rateCard = await RateCardService.create(db, organization.id, {
      creatorId: otherCreator.id,
      name: "Tabela do outro creator",
    });
    const rateCardItem = await RateCardItemsRepository.create(db, organization.id, {
      rateCardId: rateCard.id,
      serviceId: service.id,
      price: 100000,
    });

    await expect(
      ProposalItemService.addItem(db, organization.id, {
        proposalId: proposal.id,
        rateCardItemId: rateCardItem.id,
        userId: owner.id,
      }),
    ).rejects.toThrow(RateCardItemCreatorMismatchError);
  });

  it("does not write a new version when update doesn't change anything", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await setup(db);

    const item = await ProposalItemService.addItem(db, organization.id, {
      proposalId: proposal.id,
      description: "Item",
      unitPrice: 10000,
      userId: owner.id,
    });
    const versionsAfterAdd = await ProposalVersionsRepository.listByProposal(db, organization.id, proposal.id);

    await ProposalItemService.updateItem(db, organization.id, item.id, proposal.id, {
      unitPrice: 10000,
      userId: owner.id,
    });

    const versionsAfterNoopUpdate = await ProposalVersionsRepository.listByProposal(db, organization.id, proposal.id);
    expect(versionsAfterNoopUpdate).toHaveLength(versionsAfterAdd.length);
  });

  it("listByProposal returns all items added to the proposal", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await setup(db);

    await ProposalItemService.addItem(db, organization.id, {
      proposalId: proposal.id,
      description: "Sessão de fotos",
      unitPrice: 150000,
      userId: owner.id,
      sortOrder: 10,
    });
    await ProposalItemService.addItem(db, organization.id, {
      proposalId: proposal.id,
      description: "Desconto negociado",
      unitPrice: -20000,
      userId: owner.id,
      sortOrder: 5,
    });

    const items = await ProposalItemService.listByProposal(db, organization.id, proposal.id);
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.description)).toEqual([
      "Desconto negociado",
      "Sessão de fotos",
    ]);
  });

  it("listByProposal returns an empty array for a proposal with no items", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, proposal } = await setup(db);

    const items = await ProposalItemService.listByProposal(db, organization.id, proposal.id);
    expect(items).toEqual([]);
  });
});
