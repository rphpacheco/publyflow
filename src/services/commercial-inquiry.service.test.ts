import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { withTestDb } from "@/test/helpers/db";
import { OrganizationService } from "./organization.service";
import { CreatorService } from "./creator.service";
import { InboxService } from "./inbox.service";
import { CommercialInquiryService } from "./commercial-inquiry.service";
import { OpportunityService } from "./opportunity.service";
import type { AIService } from "@/lib/ai/ai-service";
import type { MessageClassification } from "@/lib/ai/schemas";
import { companies, contacts } from "@/db/schema/companies-brands-contacts";
import { leads } from "@/db/schema/commercial-flow";
import { runInTenantContext } from "@/repositories/tenant-context";
import {
  InquiryAlreadyResolvedError,
  InquiryNotFoundError,
  AmbiguousPartyGuessError,
  InquiryPartyRequiredError,
} from "@/domain/commercial-flow/errors";

function fakeAI(classification: MessageClassification): AIService {
  return { classifyMessage: async () => classification };
}

async function setupOrgAndCreator(db: NodePgDatabase<typeof schema>) {
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
    // Fix 2: the second resolve() must not create a second Lead -- it
    // should only associate the inquiry to the existing open Opportunity
    // and return the ORIGINAL lead that was already linked to it.
    expect(secondResolution.lead.id).toBe(firstResolution.lead.id);

    const allOpen = await OpportunityService.findOpenOpportunityForParty(db, organization.id, {
      creatorId: creator.id,
      companyId: company.id,
    });
    expect(allOpen?.id).toBe(firstResolution.opportunity.id);

    const allLeads = await db.select().from(leads).where(eq(leads.organizationId, organization.id));
    expect(allLeads).toHaveLength(1);
  });

  it("persists the caller-supplied contact even when resolving onto an existing open Opportunity for a different person", async () => {
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
      externalContactLabel: "João — Bella Cosméticos",
      body: "Outra pessoa da mesma empresa entrando em contato",
      receivedAt: new Date(),
    });
    // Different person ("João") than the original Lead's contact ("Maria"),
    // but the AI's company guess matches the same company, so this resolves
    // onto Maria's existing open Opportunity instead of creating a new
    // Lead/Opportunity. João's contact info must still be persisted, not
    // silently discarded.
    const secondResolution = await CommercialInquiryService.resolve(
      db,
      organization.id,
      second.inquiry!.id,
      { contact: { fullName: "João", email: "joao@bellacosmeticos.test" }, companyId: company.id },
    );

    // No new Lead/Opportunity -- still Maria's original records.
    expect(secondResolution.lead.id).toBe(firstResolution.lead.id);
    expect(secondResolution.opportunity.id).toBe(firstResolution.opportunity.id);

    const joaoContacts = await db
      .select()
      .from(contacts)
      .where(eq(contacts.organizationId, organization.id));
    expect(joaoContacts.some((contact) => contact.fullName === "João")).toBe(true);
    expect(
      joaoContacts.some((contact) => contact.email === "joao@bellacosmeticos.test"),
    ).toBe(true);

    // The original Lead's contactId must remain pointed at Maria -- the new
    // contact does not reassign it.
    const [originalLead] = await db.select().from(leads).where(eq(leads.id, firstResolution.lead.id));
    const [mariaContact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, originalLead.contactId));
    expect(mariaContact.fullName).toBe("Maria");
  });

  it("refuses conversion with InquiryPartyRequiredError when no company/brand is available, leaving the inquiry unresolved", async () => {
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

    // No companyId/brandId is passed and the inquiry has no company/brand
    // guess either, so resolve()'s InquiryPartyRequiredError guard (bugfix
    // 2026-09-30) now refuses up front, before any Lead/Opportunity insert
    // is attempted -- this used to fail later, at
    // OpportunityService.createFromLeadWithTx's DB-level party validation,
    // after the Lead insert had already run inside the shared transaction.
    await expect(
      CommercialInquiryService.resolve(db, organization.id, inquiry!.id, {
        contact: { fullName: "Carlos" },
      }),
    ).rejects.toBeInstanceOf(InquiryPartyRequiredError);

    const remainingLeads = await db
      .select()
      .from(leads)
      .where(eq(leads.organizationId, organization.id));
    expect(remainingLeads).toHaveLength(0);

    const untouchedInquiry = await CommercialInquiryService.findById(db, organization.id, inquiry!.id);
    expect(untouchedInquiry?.status).toBe("NEW");
    expect(untouchedInquiry?.convertedLeadId).toBeNull();
  });

  async function ingestFanAmbiguousInquiry(
    db: NodePgDatabase<typeof schema>,
    organization: { id: string },
    creator: { id: string },
  ) {
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
    return inquiry!;
  }

  describe("terminal-status guard (Fix 4)", () => {
    it("throws when discard is called twice on the same inquiry", async () => {
      const { db, cleanup: c } = await withTestDb();
      cleanup = c;
      const { organization, creator } = await setupOrgAndCreator(db);
      const inquiry = await ingestFanAmbiguousInquiry(db, organization, creator);

      await CommercialInquiryService.discard(db, organization.id, inquiry.id);

      await expect(
        CommercialInquiryService.discard(db, organization.id, inquiry.id),
      ).rejects.toThrow(InquiryAlreadyResolvedError);
    });

    it("throws when resolve is called on an already-discarded inquiry", async () => {
      const { db, cleanup: c } = await withTestDb();
      cleanup = c;
      const { organization, creator } = await setupOrgAndCreator(db);
      const inquiry = await ingestFanAmbiguousInquiry(db, organization, creator);

      await CommercialInquiryService.discard(db, organization.id, inquiry.id);

      await expect(
        CommercialInquiryService.resolve(db, organization.id, inquiry.id, {
          contact: { fullName: "Alguém" },
        }),
      ).rejects.toThrow(InquiryAlreadyResolvedError);
    });

    it("throws a not-found error when discard targets a nonexistent inquiry", async () => {
      const { db, cleanup: c } = await withTestDb();
      cleanup = c;
      const { organization } = await setupOrgAndCreator(db);

      await expect(
        CommercialInquiryService.discard(db, organization.id, "00000000-0000-0000-0000-000000000000"),
      ).rejects.toThrow(InquiryNotFoundError);
    });

    it("throws a not-found error when markFalsePositive targets a nonexistent inquiry", async () => {
      const { db, cleanup: c } = await withTestDb();
      cleanup = c;
      const { organization } = await setupOrgAndCreator(db);

      await expect(
        CommercialInquiryService.markFalsePositive(
          db,
          organization.id,
          "00000000-0000-0000-0000-000000000000",
        ),
      ).rejects.toThrow(InquiryNotFoundError);
    });
  });

  describe("findOpenOpportunityForParty is scoped per creator (Fix 6)", () => {
    it("only reuses an open Opportunity belonging to the same creator", async () => {
      const { db, cleanup: c } = await withTestDb();
      cleanup = c;
      const { organization, creator: creatorA } = await setupOrgAndCreator(db);
      const creatorB = await CreatorService.onboardCreator(db, organization.id, {
        email: `creator-b-${Date.now()}-${Math.random()}@publyflow.test`,
        fullName: "Bruno",
        displayName: "Bruno",
      });

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

      const forA = await InboxService.ingestManualMessage(db, ai, organization.id, {
        creatorId: creatorA.id,
        source: "INSTAGRAM",
        externalContactLabel: "Maria — Bella Cosméticos",
        body: "Mensagem para a criadora A",
        receivedAt: new Date(),
      });
      const resolutionA = await CommercialInquiryService.resolve(db, organization.id, forA.inquiry!.id, {
        contact: { fullName: "Maria" },
        companyId: company.id,
      });

      const forB = await InboxService.ingestManualMessage(db, ai, organization.id, {
        creatorId: creatorB.id,
        source: "INSTAGRAM",
        externalContactLabel: "Maria — Bella Cosméticos",
        body: "Mensagem para a criadora B",
        receivedAt: new Date(),
      });
      const resolutionB = await CommercialInquiryService.resolve(db, organization.id, forB.inquiry!.id, {
        contact: { fullName: "Maria" },
        companyId: company.id,
      });

      // Same company, two different creators -- each must get their own
      // Opportunity, not share creator A's.
      expect(resolutionB.opportunity.id).not.toBe(resolutionA.opportunity.id);
      expect(resolutionA.opportunity.creatorId).toBe(creatorA.id);
      expect(resolutionB.opportunity.creatorId).toBe(creatorB.id);
    });
  });

  describe("guess-to-real-record resolution (Fix 8)", () => {
    it("creates a new company from companyGuess when companyId is not passed, and reuses it on a second inquiry", async () => {
      const { db, cleanup: c } = await withTestDb();
      cleanup = c;
      const { organization, creator } = await setupOrgAndCreator(db);

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

      const firstResolution = await CommercialInquiryService.resolve(db, organization.id, first.inquiry!.id, {
        contact: { fullName: "Maria" },
        // companyId intentionally omitted -- must resolve from companyGuess.
      });

      expect(firstResolution.opportunity.companyId).not.toBeNull();

      const allCompanies = await db
        .select()
        .from(companies)
        .where(eq(companies.organizationId, organization.id));
      expect(allCompanies).toHaveLength(1);
      expect(allCompanies[0].name).toBe("Bella Cosméticos");

      // A second inquiry with the same companyGuess, resolved with a brand
      // new contact so it doesn't itself match the first Opportunity, must
      // reuse the existing company row rather than creating a duplicate.
      const second = await InboxService.ingestManualMessage(db, ai, organization.id, {
        creatorId: creator.id,
        source: "INSTAGRAM",
        externalContactLabel: "Maria — Bella Cosméticos",
        body: "Segunda mensagem, cliente diferente",
        receivedAt: new Date(),
      });
      await CommercialInquiryService.resolve(db, organization.id, second.inquiry!.id, {
        contact: { fullName: "Outra pessoa" },
      });

      const allCompaniesAfter = await db
        .select()
        .from(companies)
        .where(eq(companies.organizationId, organization.id));
      expect(allCompaniesAfter).toHaveLength(1);
    });

    it("throws AmbiguousPartyGuessError when the company guess matches more than one existing company", async () => {
      const { db, cleanup: c } = await withTestDb();
      cleanup = c;
      const { organization, creator } = await setupOrgAndCreator(db);

      // Two companies sharing the exact same name -- no uniqueness constraint
      // stops this, and it's exactly the scenario resolve() must now refuse
      // to guess through.
      await runInTenantContext(db, organization.id, (tx) =>
        tx.insert(companies).values({ organizationId: organization.id, name: "Bella Cosméticos" }),
      );
      await runInTenantContext(db, organization.id, (tx) =>
        tx.insert(companies).values({ organizationId: organization.id, name: "Bella Cosméticos" }),
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
        body: "Olá, gostaríamos de saber os valores.",
        receivedAt: new Date(),
      });

      // companyId omitted -- resolve() must try to resolve from the guess
      // ("Bella Cosméticos"), find it ambiguous, and refuse.
      await expect(
        CommercialInquiryService.resolve(db, organization.id, inquiry!.id, {
          contact: { fullName: "Maria" },
        }),
      ).rejects.toThrow(AmbiguousPartyGuessError);

      // The inquiry must remain unresolved -- resolve()'s transaction rolls
      // back entirely, same guarantee as the existing
      // "rolls back the Lead insert if the Opportunity create fails" test.
      const stillNew = await CommercialInquiryService.findById(db, organization.id, inquiry!.id);
      expect(stillNew?.status).toBe("NEW");
    });
  });
});

describe("inquiry without company/brand (production bug 2026-09-30)", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  const noGuesses = fakeAI({
    category: "COMMERCIAL_LEAD",
    commercialScore: 80,
    intent: "orçamento",
    extracted: { companyName: null, brandName: null, contactName: null, email: null, phone: null, budget: null, deliverables: null },
  });

  async function setupInquiry() {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, creator } = await setupOrgAndCreator(db);
    const { inquiry } = await InboxService.ingestManualMessage(db, noGuesses, organization.id, {
      creatorId: creator.id,
      source: "INSTAGRAM",
      externalContactLabel: "Rodolfo Barbosa",
      body: "Queria fazer um orçamento para divulgação da minha marca contigo.",
      receivedAt: new Date(),
    });
    return { db, organization, creator, inquiryId: inquiry!.id };
  }

  it("resolve refuses with InquiryPartyRequiredError and inserts nothing", async () => {
    const { db, organization, inquiryId } = await setupInquiry();
    await expect(
      CommercialInquiryService.resolve(db, organization.id, inquiryId, { contact: { fullName: "Rodolfo Barbosa" } }),
    ).rejects.toBeInstanceOf(InquiryPartyRequiredError);
    expect(await db.select().from(leads).where(eq(leads.organizationId, organization.id))).toHaveLength(0);
    expect(await db.select().from(contacts).where(eq(contacts.organizationId, organization.id))).toHaveLength(0);
    expect((await CommercialInquiryService.findById(db, organization.id, inquiryId))?.status).toBe("NEW");
  });

  it("updateGuesses sets only the provided keys, trims, and null clears", async () => {
    const { db, organization, inquiryId } = await setupInquiry();
    const updated = await CommercialInquiryService.updateGuesses(db, organization.id, inquiryId, {
      contactName: "  Rodolfo Barbosa ",
      companyName: "Barbosa Moda",
    });
    expect(updated).toMatchObject({ contactNameGuess: "Rodolfo Barbosa", companyGuess: "Barbosa Moda", brandGuess: null });
    const cleared = await CommercialInquiryService.updateGuesses(db, organization.id, inquiryId, { companyName: null, brandName: "BM" });
    expect(cleared).toMatchObject({ contactNameGuess: "Rodolfo Barbosa", companyGuess: null, brandGuess: "BM" });
  });

  it("after updateGuesses, resolve creates the company and converts", async () => {
    const { db, organization, inquiryId } = await setupInquiry();
    await CommercialInquiryService.updateGuesses(db, organization.id, inquiryId, { companyName: "Barbosa Moda" });
    const result = await CommercialInquiryService.resolve(db, organization.id, inquiryId, { contact: { fullName: "Rodolfo Barbosa" } });
    expect(result.opportunity.companyId).not.toBeNull();
    const [company] = await db.select().from(companies).where(eq(companies.organizationId, organization.id));
    expect(company.name).toBe("Barbosa Moda");
    expect((await CommercialInquiryService.findById(db, organization.id, inquiryId))?.status).toBe("CONVERTED");
  });

  it("updateGuesses rejects non-NEW inquiries and other organizations", async () => {
    const { db, organization, inquiryId } = await setupInquiry();
    await CommercialInquiryService.discard(db, organization.id, inquiryId);
    await expect(
      CommercialInquiryService.updateGuesses(db, organization.id, inquiryId, { companyName: "X" }),
    ).rejects.toBeInstanceOf(InquiryAlreadyResolvedError);
    const other = await setupOrgAndCreator(db);
    await expect(
      CommercialInquiryService.updateGuesses(db, other.organization.id, inquiryId, { companyName: "X" }),
    ).rejects.toBeInstanceOf(InquiryNotFoundError);
  });
});
