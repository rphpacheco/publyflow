import { describe, it, expect, afterEach } from "vitest";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { ProposalService } from "./proposal.service";
import { ProposalVersionsRepository } from "@/repositories/proposal-versions.repository";
import { UserNotOrganizationMemberError, OpportunityNotFoundError } from "@/domain/proposals/errors";
import { users } from "@/db/schema/organizations";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";

describe("ProposalService", () => {
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
      .values({
        organizationId: organization.id,
        creatorId: creator.id,
        leadId: lead.id,
        companyId: null,
        brandId: null,
      })
      .returning();
    return { organization, owner, opportunity };
  }

  it("creates a proposal with an initial version snapshot", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, opportunity } = await setup(db);

    const proposal = await ProposalService.create(db, organization.id, {
      opportunityId: opportunity.id,
      title: "Campanha Verão",
      template: "PREMIUM",
      userId: owner.id,
    });

    expect(proposal.status).toBe("DRAFT");

    const versions = await ProposalVersionsRepository.listByProposal(db, organization.id, proposal.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].versionNumber).toBe(1);
    const snapshot = versions[0].snapshotJson as { proposal: { title: string } };
    expect(snapshot.proposal.title).toBe("Campanha Verão");
  });

  it("rejects create when userId is not a member of the organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, opportunity } = await setup(db);

    const [stranger] = await db
      .insert(users)
      .values({ email: `stranger-${Date.now()}@publyflow.test`, fullName: "Stranger" })
      .returning();

    await expect(
      ProposalService.create(db, organization.id, {
        opportunityId: opportunity.id,
        title: "X",
        template: "PREMIUM",
        userId: stranger.id,
      }),
    ).rejects.toThrow(UserNotOrganizationMemberError);
  });

  it("rejects create when the opportunityId belongs to another organization", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner } = await setup(db);
    const { opportunity: foreignOpportunity } = await setup(db);

    await expect(
      ProposalService.create(db, organization.id, {
        opportunityId: foreignOpportunity.id,
        title: "X",
        template: "PREMIUM",
        userId: owner.id,
      }),
    ).rejects.toThrow(OpportunityNotFoundError);
  });

  it("does not write a new version when update doesn't change anything", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, opportunity } = await setup(db);

    const proposal = await ProposalService.create(db, organization.id, {
      opportunityId: opportunity.id,
      title: "Campanha Verão",
      template: "PREMIUM",
      userId: owner.id,
    });

    await ProposalService.update(db, organization.id, proposal.id, {
      title: "Campanha Verão",
      userId: owner.id,
    });

    const versions = await ProposalVersionsRepository.listByProposal(db, organization.id, proposal.id);
    expect(versions).toHaveLength(1);
  });

  it("writes a new version when update changes the title", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, opportunity } = await setup(db);

    const proposal = await ProposalService.create(db, organization.id, {
      opportunityId: opportunity.id,
      title: "Campanha Verão",
      template: "PREMIUM",
      userId: owner.id,
    });

    await ProposalService.update(db, organization.id, proposal.id, {
      title: "Campanha Verão 2",
      userId: owner.id,
    });

    const versions = await ProposalVersionsRepository.listByProposal(db, organization.id, proposal.id);
    expect(versions).toHaveLength(2);
  });

  it("lists proposals by opportunity", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, opportunity } = await setup(db);

    const created = await ProposalService.create(db, organization.id, {
      opportunityId: opportunity.id,
      title: "Campanha Verão",
      template: "PREMIUM",
      userId: owner.id,
    });

    const list = await ProposalService.listByOpportunity(db, organization.id, opportunity.id);
    expect(list.some((row) => row.id === created.id)).toBe(true);
  });

  it("findById returns the proposal, or null if it doesn't exist", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, opportunity } = await setup(db);

    const proposal = await ProposalService.create(db, organization.id, {
      opportunityId: opportunity.id,
      title: "Campanha Verão",
      template: "PREMIUM",
      userId: owner.id,
    });

    const found = await ProposalService.findById(db, organization.id, proposal.id);
    expect(found).not.toBeNull();
    expect(found?.title).toBe("Campanha Verão");

    const missing = await ProposalService.findById(
      db,
      organization.id,
      "00000000-0000-0000-0000-000000000000",
    );
    expect(missing).toBeNull();
  });
});
