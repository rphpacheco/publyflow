import { describe, it, expect, afterEach, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { brands, companies, companyAliases, contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";
import { domainEvents } from "@/db/schema/domain-events";
import { DomainEventsRepository } from "@/repositories/domain-events.repository";
import { CompanyNotFoundError, ContactNotFoundError, MergeSameRecordError } from "@/domain/crm/errors";
import { CrmMergeService } from "./crm-merge.service";

type TestDb = Awaited<ReturnType<typeof withTestDb>>["db"];

describe("CrmMergeService", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup?.();
  });

  /**
   * Org A: duplicate "Bella Cosméticos" (from seedProposal, with its contact/lead/opportunity)
   * plus one brand; stays "Bella Cosmeticos Ltda". Org B: an untouched seed.
   */
  async function setup() {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const orgId = a.organization.id;
    const duplicateId = a.opportunity.companyId!;
    const [stays] = await db.insert(companies).values({ organizationId: orgId, name: "Bella Cosmeticos Ltda" }).returning();
    const [brand] = await db.insert(brands).values({ organizationId: orgId, companyId: duplicateId, name: "Bella Skin" }).returning();
    const [lead] = await db.select().from(leads).where(eq(leads.id, a.opportunity.leadId));
    const b = await seedProposal(db);
    return {
      db,
      orgId,
      userId: a.owner.id,
      creatorId: a.creator.id,
      duplicateId,
      staysId: stays.id,
      brandId: brand.id,
      contactId: lead.contactId,
      leadId: lead.id,
      opportunityId: a.opportunity.id,
      orgB: b.organization.id,
      companyB: b.opportunity.companyId!,
    };
  }

  async function rowCounts(db: TestDb) {
    return {
      companies: (await db.select().from(companies)).length,
      brands: (await db.select().from(brands)).length,
      contacts: (await db.select().from(contacts)).length,
      leads: (await db.select().from(leads)).length,
      opportunities: (await db.select().from(opportunities)).length,
      aliases: (await db.select().from(companyAliases)).length,
      events: (await db.select().from(domainEvents)).length,
      snapshot: JSON.stringify([
        await db.select({ id: brands.id, c: brands.companyId }).from(brands).orderBy(brands.id),
        await db.select({ id: contacts.id, c: contacts.companyId }).from(contacts).orderBy(contacts.id),
        await db.select({ id: leads.id, c: leads.companyId, k: leads.contactId }).from(leads).orderBy(leads.id),
        await db.select({ id: opportunities.id, c: opportunities.companyId }).from(opportunities).orderBy(opportunities.id),
        await db.select({ id: companyAliases.id, c: companyAliases.companyId }).from(companyAliases).orderBy(companyAliases.id),
      ]),
    };
  }

  async function aliasNames(db: TestDb, companyId: string) {
    const rows = await db.select().from(companyAliases).where(eq(companyAliases.companyId, companyId));
    return rows.map((r) => r.name).sort();
  }

  it("company merge moves brands, contacts, leads and opportunities, deletes the duplicate, returns stays", async () => {
    const s = await setup();
    const result = await CrmMergeService.mergeCompany(s.db, s.orgId, s.duplicateId, s.staysId, { userId: s.userId });
    expect(result.id).toBe(s.staysId);
    expect(result.name).toBe("Bella Cosmeticos Ltda");
    const [brand] = await s.db.select().from(brands).where(eq(brands.id, s.brandId));
    const [contact] = await s.db.select().from(contacts).where(eq(contacts.id, s.contactId));
    const [lead] = await s.db.select().from(leads).where(eq(leads.id, s.leadId));
    const [opp] = await s.db.select().from(opportunities).where(eq(opportunities.id, s.opportunityId));
    expect([brand.companyId, contact.companyId, lead.companyId, opp.companyId]).toEqual([s.staysId, s.staysId, s.staysId, s.staysId]);
    expect(await s.db.select().from(companies).where(eq(companies.id, s.duplicateId))).toEqual([]);
  });

  it("adds the duplicate's name as alias, moves its aliases, drops the one equal to stays' name", async () => {
    const s = await setup();
    await s.db.insert(companyAliases).values([
      { organizationId: s.orgId, companyId: s.duplicateId, name: "Bella BR" },
      { organizationId: s.orgId, companyId: s.duplicateId, name: " bella cosmeticos LTDA " },
    ]);
    await CrmMergeService.mergeCompany(s.db, s.orgId, s.duplicateId, s.staysId, { userId: s.userId });
    expect(await aliasNames(s.db, s.staysId)).toEqual(["Bella BR", "Bella Cosméticos"]);
  });

  it("does not add the duplicate's name as alias when it equals stays' name (case/space)", async () => {
    const s = await setup();
    await s.db.update(companies).set({ name: "  BELLA COSMÉTICOS " }).where(eq(companies.id, s.staysId));
    const preview = await CrmMergeService.previewCompanyMerge(s.db, s.orgId, s.duplicateId, s.staysId);
    expect(preview.aliasToAdd).toBeNull();
    await CrmMergeService.mergeCompany(s.db, s.orgId, s.duplicateId, s.staysId, { userId: s.userId });
    expect(await aliasNames(s.db, s.staysId)).toEqual([]);
  });

  it("records a company.merged event with the exact moved ids", async () => {
    const s = await setup();
    await CrmMergeService.mergeCompany(s.db, s.orgId, s.duplicateId, s.staysId, { userId: s.userId });
    const events = await s.db.select().from(domainEvents)
      .where(and(eq(domainEvents.organizationId, s.orgId), eq(domainEvents.eventType, "company.merged")));
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event.entityType).toBe("company");
    expect(event.entityId).toBe(s.staysId);
    expect(event.actor).toEqual({ userId: s.userId });
    expect(event.payload).toEqual({
      duplicateId: s.duplicateId,
      duplicateName: "Bella Cosméticos",
      staysId: s.staysId,
      moved: { brandIds: [s.brandId], contactIds: [s.contactId], leadIds: [s.leadId], opportunityIds: [s.opportunityId] },
      aliasesAdded: ["Bella Cosméticos"],
    });
  });

  it("previewCompanyMerge matches what mergeCompany moves and writes nothing", async () => {
    const s = await setup();
    await s.db.insert(companyAliases).values([
      { organizationId: s.orgId, companyId: s.duplicateId, name: "Bella BR" },
      { organizationId: s.orgId, companyId: s.duplicateId, name: "Bella Cosmeticos Ltda." },
      { organizationId: s.orgId, companyId: s.duplicateId, name: "bella cosmeticos ltda" },
    ]);
    const before = await rowCounts(s.db);
    const preview = await CrmMergeService.previewCompanyMerge(s.db, s.orgId, s.duplicateId, s.staysId);
    await CrmMergeService.previewCompanyMerge(s.db, s.orgId, s.duplicateId, s.staysId);
    expect(await rowCounts(s.db)).toEqual(before);
    expect(preview).toEqual({
      duplicate: { id: s.duplicateId, name: "Bella Cosméticos" },
      stays: { id: s.staysId, name: "Bella Cosmeticos Ltda" },
      result: { name: "Bella Cosmeticos Ltda" },
      impact: { brands: 1, contacts: 1, leads: 1, opportunities: 1 },
      aliasToAdd: "Bella Cosméticos",
      aliasesMoved: 2,
    });
    await CrmMergeService.mergeCompany(s.db, s.orgId, s.duplicateId, s.staysId, { userId: s.userId });
    const [event] = await s.db.select().from(domainEvents).where(eq(domainEvents.eventType, "company.merged"));
    const moved = (event.payload as { moved: Record<string, string[]> }).moved;
    expect({
      brands: moved.brandIds.length,
      contacts: moved.contactIds.length,
      leads: moved.leadIds.length,
      opportunities: moved.opportunityIds.length,
    }).toEqual(preview.impact);
    expect(await aliasNames(s.db, s.staysId)).toEqual(["Bella BR", "Bella Cosmeticos Ltda.", "Bella Cosméticos"]);
  });

  it("rejects same id, other-org ids, and leaves org B untouched", async () => {
    const s = await setup();
    await expect(CrmMergeService.mergeCompany(s.db, s.orgId, s.staysId, s.staysId, { userId: s.userId }))
      .rejects.toBeInstanceOf(MergeSameRecordError);
    await expect(CrmMergeService.previewCompanyMerge(s.db, s.orgId, s.staysId, s.staysId))
      .rejects.toBeInstanceOf(MergeSameRecordError);
    await expect(CrmMergeService.mergeCompany(s.db, s.orgId, s.companyB, s.staysId, { userId: s.userId }))
      .rejects.toBeInstanceOf(CompanyNotFoundError);
    await expect(CrmMergeService.mergeCompany(s.db, s.orgId, s.duplicateId, s.companyB, { userId: s.userId }))
      .rejects.toBeInstanceOf(CompanyNotFoundError);
    await expect(CrmMergeService.previewCompanyMerge(s.db, s.orgId, s.duplicateId, s.companyB))
      .rejects.toBeInstanceOf(CompanyNotFoundError);
    const orgBBefore = JSON.stringify([
      await s.db.select().from(companies).where(eq(companies.organizationId, s.orgB)),
      await s.db.select().from(contacts).where(eq(contacts.organizationId, s.orgB)),
      await s.db.select().from(leads).where(eq(leads.organizationId, s.orgB)),
      await s.db.select().from(opportunities).where(eq(opportunities.organizationId, s.orgB)),
    ]);
    await CrmMergeService.mergeCompany(s.db, s.orgId, s.duplicateId, s.staysId, { userId: s.userId });
    const orgBAfter = JSON.stringify([
      await s.db.select().from(companies).where(eq(companies.organizationId, s.orgB)),
      await s.db.select().from(contacts).where(eq(contacts.organizationId, s.orgB)),
      await s.db.select().from(leads).where(eq(leads.organizationId, s.orgB)),
      await s.db.select().from(opportunities).where(eq(opportunities.organizationId, s.orgB)),
    ]);
    expect(orgBAfter).toBe(orgBBefore);
    expect(await s.db.select().from(companies).where(eq(companies.id, s.companyB))).toHaveLength(1);
  });

  it("is atomic: a failing event append rolls back the whole company merge", async () => {
    const s = await setup();
    await s.db.insert(companyAliases).values({ organizationId: s.orgId, companyId: s.duplicateId, name: "Bella BR" });
    const before = await rowCounts(s.db);
    vi.spyOn(DomainEventsRepository, "appendWithTx").mockRejectedValueOnce(new Error("boom"));
    await expect(CrmMergeService.mergeCompany(s.db, s.orgId, s.duplicateId, s.staysId, { userId: s.userId }))
      .rejects.toThrow("boom");
    expect(await rowCounts(s.db)).toEqual(before);
    expect(await s.db.select().from(companies).where(eq(companies.id, s.duplicateId))).toHaveLength(1);
    expect(await aliasNames(s.db, s.staysId)).toEqual([]);
    expect(await aliasNames(s.db, s.duplicateId)).toEqual(["Bella BR"]);
  });

  async function setupContacts() {
    const s = await setup();
    const [stays] = await s.db.insert(contacts)
      .values({ organizationId: s.orgId, companyId: null, fullName: "Maria F.", email: "maria@bella.com", phone: null, instagramHandle: "" })
      .returning();
    await s.db.update(contacts)
      .set({ email: "outra@bella.com", phone: "+5511999999999", instagramHandle: "@maria" })
      .where(eq(contacts.id, s.contactId));
    const [extraLead] = await s.db.insert(leads)
      .values({ organizationId: s.orgId, creatorId: s.creatorId, contactId: s.contactId, companyId: s.duplicateId })
      .returning();
    return { ...s, contactDuplicateId: s.contactId, contactStaysId: stays.id, leadIds: [s.leadId, extraLead.id].sort() };
  }

  it("contact merge moves leads, fills only empty fields, deletes the duplicate, records contact.merged", async () => {
    const s = await setupContacts();
    const result = await CrmMergeService.mergeContact(s.db, s.orgId, s.contactDuplicateId, s.contactStaysId, { userId: s.userId });
    expect(result).toMatchObject({
      id: s.contactStaysId,
      fullName: "Maria F.",
      email: "maria@bella.com",
      phone: "+5511999999999",
      instagramHandle: "@maria",
      companyId: s.duplicateId,
    });
    const moved = await s.db.select().from(leads).where(inArray(leads.id, s.leadIds));
    expect(moved.map((l) => l.contactId)).toEqual([s.contactStaysId, s.contactStaysId]);
    expect(await s.db.select().from(contacts).where(eq(contacts.id, s.contactDuplicateId))).toEqual([]);
    const [event] = await s.db.select().from(domainEvents)
      .where(and(eq(domainEvents.organizationId, s.orgId), eq(domainEvents.eventType, "contact.merged")));
    expect(event.entityType).toBe("contact");
    expect(event.entityId).toBe(s.contactStaysId);
    expect(event.actor).toEqual({ userId: s.userId });
    const payload = event.payload as { moved: { leadIds: string[] } } & Record<string, unknown>;
    expect([...payload.moved.leadIds].sort()).toEqual(s.leadIds);
    expect(payload).toMatchObject({
      duplicateId: s.contactDuplicateId,
      duplicateName: "Maria Fernandes",
      staysId: s.contactStaysId,
      filledFields: ["phone", "instagramHandle", "companyId"],
    });
  });

  it("previewContactMerge returns final fields, filled list and impact; writes nothing; rejects bad ids", async () => {
    const s = await setupContacts();
    const before = await rowCounts(s.db);
    const preview = await CrmMergeService.previewContactMerge(s.db, s.orgId, s.contactDuplicateId, s.contactStaysId);
    expect(await rowCounts(s.db)).toEqual(before);
    expect(preview).toEqual({
      duplicate: { id: s.contactDuplicateId, name: "Maria Fernandes" },
      stays: { id: s.contactStaysId, name: "Maria F." },
      result: {
        fullName: "Maria F.",
        email: "maria@bella.com",
        phone: "+5511999999999",
        instagramHandle: "@maria",
        company: { id: s.duplicateId, name: "Bella Cosméticos" },
      },
      filledFromDuplicate: ["phone", "instagramHandle", "companyId"],
      impact: { leads: 2 },
    });
    await expect(CrmMergeService.previewContactMerge(s.db, s.orgId, s.contactStaysId, s.contactStaysId))
      .rejects.toBeInstanceOf(MergeSameRecordError);
    await expect(CrmMergeService.mergeContact(s.db, s.orgId, s.contactStaysId, s.contactStaysId, { userId: s.userId }))
      .rejects.toBeInstanceOf(MergeSameRecordError);
    const [contactB] = await s.db.select().from(contacts).where(eq(contacts.organizationId, s.orgB));
    await expect(CrmMergeService.previewContactMerge(s.db, s.orgId, contactB.id, s.contactStaysId))
      .rejects.toBeInstanceOf(ContactNotFoundError);
    await expect(CrmMergeService.mergeContact(s.db, s.orgId, s.contactDuplicateId, contactB.id, { userId: s.userId }))
      .rejects.toBeInstanceOf(ContactNotFoundError);
    expect(await rowCounts(s.db)).toEqual(before);
  });
});
