import { describe, it, expect, afterEach } from "vitest";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { ProposalService } from "./proposal.service";
import { ProposalBlockService } from "./proposal-block.service";
import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";

describe("ProposalBlockService", () => {
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
    return { organization, owner, proposal };
  }

  it("adds a block and writes a new version", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await setup(db);

    const block = await ProposalBlockService.addBlock(db, organization.id, {
      proposalId: proposal.id,
      blockType: "COVER",
      content: { headline: "Campanha Verão" },
      userId: owner.id,
    });

    expect(block.blockType).toBe("COVER");

    const versions = await ProposalVersionsRepository.listByProposal(db, organization.id, proposal.id);
    expect(versions).toHaveLength(2);
  });

  it("does not write a new version when update doesn't change anything", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await setup(db);

    const block = await ProposalBlockService.addBlock(db, organization.id, {
      proposalId: proposal.id,
      blockType: "TEXT",
      content: { body: "..." },
      userId: owner.id,
    });
    const versionsAfterAdd = await ProposalVersionsRepository.listByProposal(db, organization.id, proposal.id);

    await ProposalBlockService.updateBlock(db, organization.id, block.id, proposal.id, {
      content: { body: "..." },
      userId: owner.id,
    });

    const versionsAfterNoopUpdate = await ProposalVersionsRepository.listByProposal(db, organization.id, proposal.id);
    expect(versionsAfterNoopUpdate).toHaveLength(versionsAfterAdd.length);
  });

  it("listByProposal returns all blocks added to the proposal", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await setup(db);

    await ProposalBlockService.addBlock(db, organization.id, {
      proposalId: proposal.id,
      blockType: "COVER",
      content: { headline: "Campanha Verão" },
      userId: owner.id,
      sortOrder: 10,
    });
    await ProposalBlockService.addBlock(db, organization.id, {
      proposalId: proposal.id,
      blockType: "TEXT",
      content: { body: "Uma proposta especial para sua marca." },
      userId: owner.id,
      sortOrder: 5,
    });

    const blocks = await ProposalBlockService.listByProposal(db, organization.id, proposal.id);
    // Proposal is created with 2 auto-seeded blocks (COVER, TEXT with sortOrder 0),
    // plus 2 manually added (TEXT with sortOrder 5, COVER with sortOrder 10) = 4 total
    expect(blocks).toHaveLength(4);
    expect(blocks.map((block) => block.blockType)).toEqual(["COVER", "TEXT", "TEXT", "COVER"]);
  });

  it("listByProposal returns the auto-seeded blocks for a new proposal", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, proposal } = await setup(db);

    const blocks = await ProposalBlockService.listByProposal(db, organization.id, proposal.id);
    // Proposal is created with 2 auto-seeded blocks (COVER, TEXT)
    expect(blocks).toHaveLength(2);
    expect(blocks.map((block) => block.blockType).sort()).toEqual(["COVER", "TEXT"]);
  });
});
