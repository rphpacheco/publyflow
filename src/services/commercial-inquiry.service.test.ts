import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { InboxService } from "./inbox.service";
import { CommercialInquiryService } from "./commercial-inquiry.service";
import { OpportunityService } from "./opportunity.service";
import type { AIService } from "@/lib/ai/ai-service";
import { companies } from "@/db/schema/companies-brands-contacts";
import { leads } from "@/db/schema/commercial-flow";
import { runInTenantContext } from "@/repositories/tenant-context";

function fakeAI(classification: any): AIService {
  return { classifyMessage: async () => classification };
}

async function setupOrgAndCreator(db: any) {
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

describe("CommercialInquiryService", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("discards an inquiry without creating a Lead or Opportunity", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, creator } = await setupOrgAndCreator(db);

    const ai = fakeAI({
      category: "COMMERCIAL_LEAD",
      commercialScore: 40,
      intent: null,
      extracted: {
        companyName: null,
        brandName: null,
        contactName: null,
        email: null,
        phone: null,
        budget: null,
        deliverables: null,
      },
    });

    const { inquiry } = await InboxService.ingestManualMessage(db, ai, organization.id, {
      creatorId: creator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Desconhecido",
      body: "Mensagem ambígua",
      receivedAt: new Date(),
    });

    await CommercialInquiryService.discard(db, organization.id, inquiry!.id);

    const updated = await CommercialInquiryService.findById(db, organization.id, inquiry!.id);
    expect(updated?.status).toBe("DISCARDED");
  });

  it("resolves a new company into a Lead and a new Opportunity", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, creator } = await setupOrgAndCreator(db);

    const [company] = await runInTenantContext(db, organization.id, (tx) =>
      tx.insert(companies).values({ organizationId: organization.id, name: "Bella Cosméticos" }).returning(),
    );

    const ai = fakeAI({
      category: "COMMERCIAL_LEAD",
      commercialScore: 94,
      intent: "Pedido de mídia kit",
      extracted: {
        companyName: "Bella Cosméticos",
        brandName: null,
        contactName: "Maria",
        email: null,
        phone: null,
        budget: null,
        deliverables: null,
      },
    });

    const { inquiry } = await InboxService.ingestManualMessage(db, ai, organization.id, {
      creatorId: creator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Maria — Bella Cosméticos",
      body: "Olá, gostaríamos de saber os valores para uma campanha.",
      receivedAt: new Date(),
    });

    const result = await CommercialInquiryService.resolve(db, organization.id, inquiry!.id, {
      contact: { fullName: "Maria" },
      companyId: company.id,
    });

    expect(result.lead.qualified).toBe(true);
    expect(result.opportunity.status).toBe("OPEN");

    const updatedInquiry = await CommercialInquiryService.findById(db, organization.id, inquiry!.id);
    expect(updatedInquiry?.status).toBe("CONVERTED");
    expect(updatedInquiry?.convertedLeadId).toBe(result.lead.id);
  });

  it("associates a new inquiry to an existing open Opportunity for the same company instead of creating a duplicate", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, creator } = await setupOrgAndCreator(db);

    const [company] = await runInTenantContext(db, organization.id, (tx) =>
      tx.insert(companies).values({ organizationId: organization.id, name: "Bella Cosméticos" }).returning(),
    );

    const ai = fakeAI({
      category: "COMMERCIAL_LEAD",
      commercialScore: 90,
      intent: "Pedido de mídia kit",
      extracted: {
        companyName: "Bella Cosméticos",
        brandName: null,
        contactName: "Maria",
        email: null,
        phone: null,
        budget: null,
        deliverables: null,
      },
    });

    const first = await InboxService.ingestManualMessage(db, ai, organization.id, {
      creatorId: creator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Maria — Bella Cosméticos",
      body: "Primeira mensagem",
      receivedAt: new Date(),
    });
    const firstResolution = await CommercialInquiryService.resolve(
      db,
      organization.id,
      first.inquiry!.id,
      { contact: { fullName: "Maria" }, companyId: company.id },
    );

    const second = await InboxService.ingestManualMessage(db, ai, organization.id, {
      creatorId: creator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Maria — Bella Cosméticos",
      body: "Segunda mensagem, mesma negociação",
      receivedAt: new Date(),
    });
    const secondResolution = await CommercialInquiryService.resolve(
      db,
      organization.id,
      second.inquiry!.id,
      { contact: { fullName: "Maria" }, companyId: company.id },
    );

    expect(secondResolution.opportunity.id).toBe(firstResolution.opportunity.id);

    const allOpen = await OpportunityService.findOpenOpportunityForParty(db, organization.id, {
      companyId: company.id,
    });
    expect(allOpen?.id).toBe(firstResolution.opportunity.id);
  });

  it("rolls back the Lead insert if the Opportunity create fails, leaving the inquiry unresolved", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, creator } = await setupOrgAndCreator(db);

    const ai = fakeAI({
      category: "COMMERCIAL_LEAD",
      commercialScore: 88,
      intent: "Pedido de orçamento",
      extracted: {
        companyName: null,
        brandName: null,
        contactName: "Carlos",
        email: null,
        phone: null,
        budget: null,
        deliverables: null,
      },
    });

    const { inquiry } = await InboxService.ingestManualMessage(db, ai, organization.id, {
      creatorId: creator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Carlos",
      body: "Quanto custa uma publi?",
      receivedAt: new Date(),
    });

    // No companyId/brandId is passed, so OpportunityService.createFromLeadWithTx's
    // party validation (Task 13's InvalidOpportunityPartyError) fails — but only
    // *after* the Lead insert already ran inside resolve()'s shared transaction.
    // This proves the Lead insert, the (failed) Opportunity insert, and the
    // inquiry status update all share one transaction: if they didn't, the Lead
    // row would remain committed despite resolve() rejecting.
    await expect(
      CommercialInquiryService.resolve(db, organization.id, inquiry!.id, {
        contact: { fullName: "Carlos" },
      }),
    ).rejects.toThrow(/company_id or brand_id/);

    const remainingLeads = await db
      .select()
      .from(leads)
      .where(eq(leads.organizationId, organization.id));
    expect(remainingLeads).toHaveLength(0);

    const untouchedInquiry = await CommercialInquiryService.findById(db, organization.id, inquiry!.id);
    expect(untouchedInquiry?.status).toBe("NEW");
    expect(untouchedInquiry?.convertedLeadId).toBeNull();
  });
});
