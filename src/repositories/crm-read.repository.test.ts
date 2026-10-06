import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { brands, companies, companyAliases, contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";
import { CrmReadRepository } from "./crm-read.repository";

describe("CrmReadRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup() {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    // Org A: Bella Cosméticos + contact Maria + open opportunity + proposal "Campanha Verão".
    const a = await seedProposal(db);
    const companyId = a.opportunity.companyId!;
    const [brand] = await db.insert(brands).values({ organizationId: a.organization.id, companyId, name: "Linha Verão" }).returning();
    await db.update(opportunities).set({ brandId: brand.id, estimatedValueCents: 150000 }).where(eq(opportunities.id, a.opportunity.id));
    const [orphanBrand] = await db.insert(brands).values({ organizationId: a.organization.id, companyId: null, name: "Sem Dono" }).returning();
    // A WON opportunity on the same company must not count as open.
    const [lead] = await db.select().from(leads).where(eq(leads.id, a.opportunity.leadId));
    await db.insert(opportunities).values({
      organizationId: a.organization.id,
      creatorId: a.creator.id,
      leadId: lead.id,
      companyId,
      status: "WON",
      stage: "FECHADO",
    });
    // Org B: same-named company, must never leak into org A.
    const b = await seedProposal(db);
    return { db, a, b, companyId, brand, orphanBrand, contactId: lead.contactId };
  }

  it("lists companies with brand, contact and open-opportunity counts, scoped to the org", async () => {
    const { db, a, companyId } = await setup();
    const list = await CrmReadRepository.listCompanies(db, a.organization.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: companyId, name: "Bella Cosméticos", brandCount: 1, contactCount: 1, openOpportunityCount: 1 });
  });

  it("lists contacts with their company name, scoped to the org", async () => {
    const { db, a, contactId } = await setup();
    const list = await CrmReadRepository.listContacts(db, a.organization.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: contactId, fullName: "Maria Fernandes", companyName: "Bella Cosméticos" });
  });

  it("returns the company detail with brands, contacts, opportunities and their proposals", async () => {
    const { db, a, companyId } = await setup();
    const detail = await CrmReadRepository.companyDetail(db, a.organization.id, companyId);
    expect(detail?.company.name).toBe("Bella Cosméticos");
    expect(detail?.brands).toEqual([{ id: expect.any(String), name: "Linha Verão" }]);
    expect(detail?.contacts.map((c) => c.fullName)).toEqual(["Maria Fernandes"]);
    expect(detail?.opportunities).toHaveLength(2);
    const open = detail!.opportunities.find((o) => o.status === "OPEN")!;
    expect(open).toMatchObject({ brandName: "Linha Verão", creatorName: "Thais", estimatedValueCents: 150000 });
    expect(open.proposals).toEqual([{ id: a.proposal.id, title: "Campanha Verão", status: "DRAFT" }]);
  });

  it("lists the company aliases as { id, name } ordered by name", async () => {
    const { db, a, companyId } = await setup();
    await db.insert(companyAliases).values([
      { organizationId: a.organization.id, companyId, name: "Zeta" },
      { organizationId: a.organization.id, companyId, name: "Alfa" },
    ]);
    const detail = await CrmReadRepository.companyDetail(db, a.organization.id, companyId);
    expect(detail?.aliases).toEqual([
      { id: expect.any(String), name: "Alfa" },
      { id: expect.any(String), name: "Zeta" },
    ]);
  });

  it("returns the contact detail with company and opportunities reached through leads", async () => {
    const { db, a, contactId, companyId } = await setup();
    const detail = await CrmReadRepository.contactDetail(db, a.organization.id, contactId);
    expect(detail?.company).toEqual({ id: companyId, name: "Bella Cosméticos" });
    expect(detail?.opportunities).toHaveLength(2);
  });

  it("returns null for another org's company or contact", async () => {
    const { db, a, b } = await setup();
    const [bLead] = await db.select().from(leads).where(eq(leads.id, b.opportunity.leadId));
    expect(await CrmReadRepository.companyDetail(db, a.organization.id, b.opportunity.companyId!)).toBeNull();
    expect(await CrmReadRepository.contactDetail(db, a.organization.id, bLead.contactId)).toBeNull();
  });

  it("does not count another org's rows that point at a company id (defensive join predicates)", async () => {
    const { db, a, b, companyId } = await setup();
    // A row of org B wrongly pointing at org A's company must not be counted.
    await db.insert(contacts).values({ organizationId: b.organization.id, companyId, fullName: "Intruso" });
    const [row] = await CrmReadRepository.listCompanies(db, a.organization.id);
    expect(row.contactCount).toBe(1);
    const detail = await CrmReadRepository.companyDetail(db, a.organization.id, companyId);
    expect(detail?.contacts.map((c) => c.fullName)).toEqual(["Maria Fernandes"]);
    const companiesOfB = await db.select().from(companies).where(eq(companies.organizationId, b.organization.id));
    expect(companiesOfB).toHaveLength(1);
  });
});
