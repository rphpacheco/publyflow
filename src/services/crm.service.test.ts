import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { brands, companies, companyAliases, contacts } from "@/db/schema/companies-brands-contacts";
import { eq } from "drizzle-orm";
import { CrmService } from "./crm.service";
import {
  BrandNotFoundError,
  CompanyAliasNotFoundError,
  CompanyNameTakenError,
  CompanyNotFoundError,
  CompanyRefNotFoundError,
  ContactNotFoundError,
} from "@/domain/crm/errors";

const MISSING = "00000000-0000-4000-8000-0000000000ff";

describe("CrmService", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup() {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const orgId = a.organization.id;
    const companyId = a.opportunity.companyId!;
    const [other] = await db.insert(companies).values({ organizationId: orgId, name: "Outra Empresa" }).returning();
    const [contact] = await db.insert(contacts).values({ organizationId: orgId, fullName: "João", email: "j@x.com" }).returning();
    const [brand] = await db.insert(brands).values({ organizationId: orgId, companyId, name: "Linha" }).returning();
    const b = await seedProposal(db);
    return { db, orgId, companyId, other, contact, brand, foreignCompanyId: b.opportunity.companyId!, orgB: b.organization.id };
  }

  describe("updateCompany", () => {
    it("renames the company (trimmed input arrives already trimmed from the schema)", async () => {
      const { db, orgId, companyId } = await setup();
      const updated = await CrmService.updateCompany(db, orgId, companyId, { name: "Bella Cosméticos Ltda" });
      expect(updated.name).toBe("Bella Cosméticos Ltda");
    });

    it("allows renaming to its own name with different case", async () => {
      const { db, orgId, companyId } = await setup();
      const updated = await CrmService.updateCompany(db, orgId, companyId, { name: "BELLA COSMÉTICOS" });
      expect(updated.name).toBe("BELLA COSMÉTICOS");
    });

    it("refuses a name another company of the org already has (case/space-insensitive)", async () => {
      const { db, orgId, companyId } = await setup();
      await expect(CrmService.updateCompany(db, orgId, companyId, { name: "outra empresa" })).rejects.toBeInstanceOf(CompanyNameTakenError);
    });

    it("refuses a name that is another company's alias", async () => {
      const { db, orgId, companyId, other } = await setup();
      await db.insert(companyAliases).values({ organizationId: orgId, companyId: other.id, name: "Apelido Alheio" });
      await expect(CrmService.updateCompany(db, orgId, companyId, { name: " apelido alheio" })).rejects.toBeInstanceOf(CompanyNameTakenError);
    });

    it("renaming to its own alias succeeds and removes that alias", async () => {
      const { db, orgId, companyId } = await setup();
      await db.insert(companyAliases).values({ organizationId: orgId, companyId, name: "Bella Ltda" });
      const updated = await CrmService.updateCompany(db, orgId, companyId, { name: "Bella Ltda" });
      expect(updated.name).toBe("Bella Ltda");
      expect(await db.select().from(companyAliases).where(eq(companyAliases.companyId, companyId))).toEqual([]);
    });

    it("ignores same-named companies of another org", async () => {
      const { db, orgId, other, orgB } = await setup();
      await db.insert(companies).values({ organizationId: orgB, name: "Só da Org B" });
      const updated = await CrmService.updateCompany(db, orgId, other.id, { name: "Só da Org B" });
      expect(updated.name).toBe("Só da Org B");
    });

    it("throws not found for a missing or foreign company", async () => {
      const { db, orgId, foreignCompanyId } = await setup();
      await expect(CrmService.updateCompany(db, orgId, MISSING, { name: "X" })).rejects.toBeInstanceOf(CompanyNotFoundError);
      await expect(CrmService.updateCompany(db, orgId, foreignCompanyId, { name: "X" })).rejects.toBeInstanceOf(CompanyNotFoundError);
    });
  });

  describe("removeCompanyAlias", () => {
    it("removes the alias", async () => {
      const { db, orgId, companyId } = await setup();
      const [alias] = await db.insert(companyAliases).values({ organizationId: orgId, companyId, name: "Apelido" }).returning();
      await CrmService.removeCompanyAlias(db, orgId, companyId, alias.id);
      expect(await db.select().from(companyAliases).where(eq(companyAliases.companyId, companyId))).toEqual([]);
    });

    it("throws not found for an unknown or another company's alias", async () => {
      const { db, orgId, companyId, other } = await setup();
      const [alias] = await db.insert(companyAliases).values({ organizationId: orgId, companyId: other.id, name: "Apelido" }).returning();
      await expect(CrmService.removeCompanyAlias(db, orgId, companyId, MISSING)).rejects.toBeInstanceOf(CompanyAliasNotFoundError);
      await expect(CrmService.removeCompanyAlias(db, orgId, companyId, alias.id)).rejects.toBeInstanceOf(CompanyAliasNotFoundError);
    });
  });

  describe("updateContact", () => {
    it("updates only the provided fields and clears nulls", async () => {
      const { db, orgId, contact, companyId } = await setup();
      const updated = await CrmService.updateContact(db, orgId, contact.id, { email: null, companyId, phone: "48 99999-0000" });
      expect(updated).toMatchObject({ fullName: "João", email: null, phone: "48 99999-0000", companyId });
    });

    it("refuses a company of another org", async () => {
      const { db, orgId, contact, foreignCompanyId } = await setup();
      await expect(CrmService.updateContact(db, orgId, contact.id, { companyId: foreignCompanyId })).rejects.toBeInstanceOf(CompanyRefNotFoundError);
    });

    it("throws not found for a missing contact", async () => {
      const { db, orgId } = await setup();
      await expect(CrmService.updateContact(db, orgId, MISSING, { fullName: "X" })).rejects.toBeInstanceOf(ContactNotFoundError);
    });
  });

  describe("updateBrand", () => {
    it("renames and detaches from the company", async () => {
      const { db, orgId, brand } = await setup();
      const updated = await CrmService.updateBrand(db, orgId, brand.id, { name: "Linha Nova", companyId: null });
      expect(updated).toMatchObject({ name: "Linha Nova", companyId: null });
    });

    it("moves to another company of the org and refuses a foreign one", async () => {
      const { db, orgId, brand, other, foreignCompanyId } = await setup();
      expect((await CrmService.updateBrand(db, orgId, brand.id, { companyId: other.id })).companyId).toBe(other.id);
      await expect(CrmService.updateBrand(db, orgId, brand.id, { companyId: foreignCompanyId })).rejects.toBeInstanceOf(CompanyRefNotFoundError);
    });

    it("throws not found for a missing brand", async () => {
      const { db, orgId } = await setup();
      await expect(CrmService.updateBrand(db, orgId, MISSING, { name: "X" })).rejects.toBeInstanceOf(BrandNotFoundError);
    });
  });

  describe("details", () => {
    it("throws not found for missing ids", async () => {
      const { db, orgId } = await setup();
      await expect(CrmService.getCompanyDetail(db, orgId, MISSING)).rejects.toBeInstanceOf(CompanyNotFoundError);
      await expect(CrmService.getContactDetail(db, orgId, MISSING)).rejects.toBeInstanceOf(ContactNotFoundError);
    });
  });
});
