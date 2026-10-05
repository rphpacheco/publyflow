import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { organizations, users } from "@/db/schema/organizations";
import { creators } from "@/db/schema/creators";
import { companies, contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunityStageHistory } from "@/db/schema/commercial-flow";
import { OpportunityNotFoundError } from "@/domain/commercial-flow/errors";
import { OpportunitiesRepository } from "./opportunities.repository";

describe("OpportunitiesRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup() {
    const { db, cleanup: c } = await withTestDb();
    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [user] = await db
      .insert(users)
      .values({ email: "thais@publyflow.test", fullName: "Thais" })
      .returning();
    const [creator] = await db
      .insert(creators)
      .values({ organizationId: org.id, userId: user.id, displayName: "Thais" })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ organizationId: org.id, name: "Bella Cosméticos" })
      .returning();
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: org.id, fullName: "Maria" })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({
        organizationId: org.id,
        creatorId: creator.id,
        contactId: contact.id,
        companyId: company.id,
        qualified: true,
      })
      .returning();
    return { db, cleanup: c, org, creator, company, contact, lead };
  }

  it("finds an opportunity by id, and returns null for a nonexistent id", async () => {
    const { db, cleanup: c, org, creator, company, lead } = await setup();
    cleanup = c;

    const created = await OpportunitiesRepository.create(db, org.id, {
      creatorId: creator.id,
      leadId: lead.id,
      companyId: company.id,
      brandId: null,
    });

    const found = await OpportunitiesRepository.findById(db, org.id, created.id);
    expect(found?.id).toBe(created.id);

    const notFound = await OpportunitiesRepository.findById(
      db,
      org.id,
      "00000000-0000-0000-0000-000000000000",
    );
    expect(notFound).toBeNull();
  });

  it("lists opportunities by creator, ordered by createdAt desc, with an optional stage filter", async () => {
    const { db, cleanup: c, org, creator, company, lead } = await setup();
    cleanup = c;

    const opportunity = await OpportunitiesRepository.create(db, org.id, {
      creatorId: creator.id,
      leadId: lead.id,
      companyId: company.id,
      brandId: null,
    });

    const list = await OpportunitiesRepository.listByCreator(db, org.id, creator.id);
    expect(list.some((row) => row.id === opportunity.id)).toBe(true);

    // Party enrichment: the row must carry the company/contact names resolved
    // via the lead, not raw UUIDs.
    const enrichedRow = list.find((row) => row.id === opportunity.id)!;
    expect(enrichedRow.companyName).toBe("Bella Cosméticos");
    expect(enrichedRow.contactName).toBe("Maria");
    expect(enrichedRow.brandName).toBeNull();

    const filtered = await OpportunitiesRepository.listByCreator(
      db,
      org.id,
      creator.id,
      "NOVO_LEAD",
    );
    expect(filtered.every((row) => row.stage === "NOVO_LEAD")).toBe(true);
    expect(filtered.some((row) => row.id === opportunity.id)).toBe(true);
  });

  it("still returns an opportunity with no company/brand (LEFT JOIN safety)", async () => {
    const { db, cleanup: c, org, creator } = await setup();
    cleanup = c;

    // A second lead/opportunity with companyId/brandId both null.
    const [contactOnly] = await db
      .insert(contacts)
      .values({ organizationId: org.id, fullName: "João" })
      .returning();
    const [leadNoCompany] = await db
      .insert(leads)
      .values({
        organizationId: org.id,
        creatorId: creator.id,
        contactId: contactOnly.id,
        companyId: null,
        qualified: false,
      })
      .returning();
    const opportunity = await OpportunitiesRepository.create(db, org.id, {
      creatorId: creator.id,
      leadId: leadNoCompany.id,
      companyId: null,
      brandId: null,
    });

    const list = await OpportunitiesRepository.listByCreator(db, org.id, creator.id);
    const row = list.find((r) => r.id === opportunity.id);
    expect(row).toBeDefined();
    expect(row!.companyName).toBeNull();
    expect(row!.brandName).toBeNull();
    expect(row!.contactName).toBe("João");
  });

  it("updateStage changes the opportunity's stage and records a stage_history row in one transaction", async () => {
    const { db, cleanup: c, org, creator, company, lead } = await setup();
    cleanup = c;

    const opportunity = await OpportunitiesRepository.create(db, org.id, {
      creatorId: creator.id,
      leadId: lead.id,
      companyId: company.id,
      brandId: null,
    });

    const updated = await OpportunitiesRepository.updateStage(
      db,
      org.id,
      opportunity.id,
      "PRIMEIRO_CONTATO",
    );
    expect(updated.stage).toBe("PRIMEIRO_CONTATO");

    const history = await db
      .select()
      .from(opportunityStageHistory)
      .where(eq(opportunityStageHistory.opportunityId, opportunity.id));

    expect(history).toHaveLength(2); // initial NOVO_LEAD entry (from create) + this transition
    const transition = history.find((row) => row.toStage === "PRIMEIRO_CONTATO");
    expect(transition?.fromStage).toBe("NOVO_LEAD");
  });

  it("throws OpportunityNotFoundError when updating the stage of a nonexistent opportunity", async () => {
    const { db, cleanup: c, org } = await setup();
    cleanup = c;

    await expect(
      OpportunitiesRepository.updateStage(
        db,
        org.id,
        "00000000-0000-0000-0000-000000000000",
        "PRIMEIRO_CONTATO",
      ),
    ).rejects.toThrow(OpportunityNotFoundError);
  });

  it("syncs status to WON when stage reaches FECHADO, to LOST when stage reaches PERDIDO, and leaves status unchanged for a non-terminal stage", async () => {
    const { db, cleanup: c, org, creator, company, lead } = await setup();
    cleanup = c;

    const opportunityA = await OpportunitiesRepository.create(db, org.id, {
      creatorId: creator.id,
      leadId: lead.id,
      companyId: company.id,
      brandId: null,
    });
    const wonUpdate = await OpportunitiesRepository.updateStage(
      db,
      org.id,
      opportunityA.id,
      "FECHADO",
    );
    expect(wonUpdate.status).toBe("WON");

    const opportunityB = await OpportunitiesRepository.create(db, org.id, {
      creatorId: creator.id,
      leadId: lead.id,
      companyId: company.id,
      brandId: null,
    });
    const lostUpdate = await OpportunitiesRepository.updateStage(
      db,
      org.id,
      opportunityB.id,
      "PERDIDO",
    );
    expect(lostUpdate.status).toBe("LOST");

    const opportunityC = await OpportunitiesRepository.create(db, org.id, {
      creatorId: creator.id,
      leadId: lead.id,
      companyId: company.id,
      brandId: null,
    });
    const nonTerminalUpdate = await OpportunitiesRepository.updateStage(
      db,
      org.id,
      opportunityC.id,
      "PRIMEIRO_CONTATO",
    );
    expect(nonTerminalUpdate.status).toBe("OPEN");
  });

  it("updateStage returns status to OPEN when an opportunity leaves FECHADO or PERDIDO", async () => {
    const { db, cleanup: c, org, creator, company, lead } = await setup();
    cleanup = c;

    const opportunity = await OpportunitiesRepository.create(db, org.id, {
      creatorId: creator.id,
      leadId: lead.id,
      companyId: company.id,
      brandId: null,
    });
    const won = await OpportunitiesRepository.updateStage(db, org.id, opportunity.id, "FECHADO");
    expect(won.status).toBe("WON");
    const reopened = await OpportunitiesRepository.updateStage(db, org.id, opportunity.id, "NEGOCIACAO");
    expect(reopened.status).toBe("OPEN");
    const lost = await OpportunitiesRepository.updateStage(db, org.id, opportunity.id, "PERDIDO");
    expect(lost.status).toBe("LOST");
    const reopenedAgain = await OpportunitiesRepository.updateStage(db, org.id, opportunity.id, "QUALIFICACAO");
    expect(reopenedAgain.status).toBe("OPEN");
  });

  it("is a no-op that does not write a new stage_history row when the new stage equals the current stage", async () => {
    const { db, cleanup: c, org, creator, company, lead } = await setup();
    cleanup = c;

    const opportunity = await OpportunitiesRepository.create(db, org.id, {
      creatorId: creator.id,
      leadId: lead.id,
      companyId: company.id,
      brandId: null,
    });

    const beforeHistory = await db
      .select()
      .from(opportunityStageHistory)
      .where(eq(opportunityStageHistory.opportunityId, opportunity.id));

    const result = await OpportunitiesRepository.updateStage(
      db,
      org.id,
      opportunity.id,
      opportunity.stage,
    );
    expect(result.stage).toBe(opportunity.stage);

    const afterHistory = await db
      .select()
      .from(opportunityStageHistory)
      .where(eq(opportunityStageHistory.opportunityId, opportunity.id));

    expect(afterHistory).toHaveLength(beforeHistory.length);
  });
});
