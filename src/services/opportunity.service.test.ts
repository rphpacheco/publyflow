import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { OpportunityService } from "./opportunity.service";
import { InvalidOpportunityPartyError } from "@/domain/commercial-flow/errors";
import { companies, brands, contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunityStageHistory } from "@/db/schema/commercial-flow";
import { runInTenantContext } from "@/repositories/tenant-context";

describe("OpportunityService.createFromLead", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup() {
    const { db, cleanup: c } = await withTestDb();
    const { organization } = await OrganizationService.createWithOwner(db, {
      organizationName: "Org",
      ownerEmail: `owner-${Date.now()}@publyflow.test`,
      ownerFullName: "Owner",
    });
    const creator = await CreatorService.onboardCreator(db, organization.id, {
      email: `creator-${Date.now()}@publyflow.test`,
      fullName: "Thais",
      displayName: "Thais",
    });
    return { db, cleanup: c, organization, creator };
  }

  it("rejects an opportunity with neither company_id nor brand_id", async () => {
    const { db, cleanup: c, organization, creator } = await setup();
    cleanup = c;

    const [contact] = await runInTenantContext(db, organization.id, (tx) =>
      tx.insert(contacts).values({ organizationId: organization.id, fullName: "Maria" }).returning(),
    );
    const [lead] = await runInTenantContext(db, organization.id, (tx) =>
      tx
        .insert(leads)
        .values({
          organizationId: organization.id,
          creatorId: creator.id,
          contactId: contact.id,
          qualified: true,
        })
        .returning(),
    );

    await expect(
      OpportunityService.createFromLead(db, organization.id, {
        leadId: lead.id,
        creatorId: creator.id,
        companyId: null,
        brandId: null,
      }),
    ).rejects.toThrow(InvalidOpportunityPartyError);
  });

  it("rejects a brand belonging to a different company than the opportunity's company", async () => {
    const { db, cleanup: c, organization, creator } = await setup();
    cleanup = c;

    const [companyA] = await runInTenantContext(db, organization.id, (tx) =>
      tx.insert(companies).values({ organizationId: organization.id, name: "Grupo Boticário" }).returning(),
    );
    const [companyB] = await runInTenantContext(db, organization.id, (tx) =>
      tx.insert(companies).values({ organizationId: organization.id, name: "Unilever" }).returning(),
    );
    const [brand] = await runInTenantContext(db, organization.id, (tx) =>
      tx
        .insert(brands)
        .values({ organizationId: organization.id, name: "O Boticário", companyId: companyA.id })
        .returning(),
    );
    const [contact] = await runInTenantContext(db, organization.id, (tx) =>
      tx.insert(contacts).values({ organizationId: organization.id, fullName: "Maria" }).returning(),
    );
    const [lead] = await runInTenantContext(db, organization.id, (tx) =>
      tx
        .insert(leads)
        .values({
          organizationId: organization.id,
          creatorId: creator.id,
          contactId: contact.id,
          qualified: true,
        })
        .returning(),
    );

    await expect(
      OpportunityService.createFromLead(db, organization.id, {
        leadId: lead.id,
        creatorId: creator.id,
        companyId: companyB.id,
        brandId: brand.id,
      }),
    ).rejects.toThrow(InvalidOpportunityPartyError);
  });

  it("creates an opportunity and its initial stage history entry when the party is valid", async () => {
    const { db, cleanup: c, organization, creator } = await setup();
    cleanup = c;

    const [company] = await runInTenantContext(db, organization.id, (tx) =>
      tx.insert(companies).values({ organizationId: organization.id, name: "Bella Cosméticos" }).returning(),
    );
    const [contact] = await runInTenantContext(db, organization.id, (tx) =>
      tx.insert(contacts).values({ organizationId: organization.id, fullName: "Maria" }).returning(),
    );
    const [lead] = await runInTenantContext(db, organization.id, (tx) =>
      tx
        .insert(leads)
        .values({
          organizationId: organization.id,
          creatorId: creator.id,
          contactId: contact.id,
          companyId: company.id,
          qualified: true,
        })
        .returning(),
    );

    const opportunity = await OpportunityService.createFromLead(db, organization.id, {
      leadId: lead.id,
      creatorId: creator.id,
      companyId: company.id,
      brandId: null,
    });

    expect(opportunity.stage).toBe("NOVO_LEAD");
    expect(opportunity.status).toBe("OPEN");

    const stageHistory = await runInTenantContext(db, organization.id, (tx) =>
      tx
        .select()
        .from(opportunityStageHistory)
        .where(eq(opportunityStageHistory.opportunityId, opportunity.id)),
    );

    expect(stageHistory).toHaveLength(1);
    expect(stageHistory[0].fromStage).toBeNull();
    expect(stageHistory[0].toStage).toBe("NOVO_LEAD");
  });
});
