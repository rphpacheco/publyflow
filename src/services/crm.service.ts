import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { CompaniesRepository, type Company } from "@/repositories/companies.repository";
import { CompanyAliasesRepository } from "@/repositories/company-aliases.repository";
import { ContactsRepository, type Contact } from "@/repositories/contacts.repository";
import { BrandsRepository, type Brand } from "@/repositories/brands.repository";
import {
  CrmReadRepository,
  type CompanyDetail,
  type CompanyListItem,
  type ContactDetail,
  type ContactListItem,
} from "@/repositories/crm-read.repository";
import {
  BrandNotFoundError,
  CompanyAliasNotFoundError,
  CompanyNameTakenError,
  CompanyNotFoundError,
  CompanyRefNotFoundError,
  ContactNotFoundError,
} from "@/domain/crm/errors";
import type { UpdateBrandInput, UpdateContactInput } from "@/lib/crm/crm-input";

type Db = NodePgDatabase<typeof schema>;

async function assertCompanyInOrg(tx: Db, organizationId: string, companyId: string | null | undefined) {
  if (!companyId) return;
  const company = await CompaniesRepository.findByIdWithTx(tx, organizationId, companyId);
  if (!company) throw new CompanyRefNotFoundError(companyId);
}

export const CrmService = {
  listCompanies(db: Db, organizationId: string): Promise<CompanyListItem[]> {
    return CrmReadRepository.listCompanies(db, organizationId);
  },

  listContacts(db: Db, organizationId: string): Promise<ContactListItem[]> {
    return CrmReadRepository.listContacts(db, organizationId);
  },

  async getCompanyDetail(db: Db, organizationId: string, companyId: string): Promise<CompanyDetail> {
    const detail = await CrmReadRepository.companyDetail(db, organizationId, companyId);
    if (!detail) throw new CompanyNotFoundError(companyId);
    return detail;
  },

  async getContactDetail(db: Db, organizationId: string, contactId: string): Promise<ContactDetail> {
    const detail = await CrmReadRepository.contactDetail(db, organizationId, contactId);
    if (!detail) throw new ContactNotFoundError(contactId);
    return detail;
  },

  // Row lock serializes concurrent renames of the same company. Two renames of
  // *different* companies to the same name can still race (no unique index) —
  // accepted in the spec; merging duplicates is a later spec.
  async updateCompany(db: Db, organizationId: string, companyId: string, input: { name: string }): Promise<Company> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const company = await CompaniesRepository.lockByIdWithTx(tx, organizationId, companyId);
      if (!company) throw new CompanyNotFoundError(companyId);
      const taken = await CompaniesRepository.findOtherByNameCiWithTx(tx, organizationId, input.name, companyId);
      if (taken) throw new CompanyNameTakenError(input.name);
      const alias = await CompanyAliasesRepository.findOwnerCiWithTx(tx, organizationId, input.name);
      if (alias && alias.companyId !== companyId) throw new CompanyNameTakenError(input.name);
      const updated = await CompaniesRepository.updateNameWithTx(tx, organizationId, companyId, input.name);
      if (alias) await CompanyAliasesRepository.deleteByIdWithTx(tx, organizationId, alias.id); // renamed to its own alias
      return updated;
    });
  },

  async removeCompanyAlias(db: Db, organizationId: string, companyId: string, aliasId: string): Promise<void> {
    await runInTenantContext(db, organizationId, async (tx) => {
      const removed = await CompanyAliasesRepository.deleteWithTx(tx, organizationId, companyId, aliasId);
      if (!removed) throw new CompanyAliasNotFoundError(aliasId);
    });
  },

  async updateContact(db: Db, organizationId: string, contactId: string, input: UpdateContactInput): Promise<Contact> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const existing = await ContactsRepository.findByIdWithTx(tx, organizationId, contactId);
      if (!existing) throw new ContactNotFoundError(contactId);
      await assertCompanyInOrg(tx, organizationId, input.companyId);
      const updated = await ContactsRepository.updateWithTx(tx, organizationId, contactId, input);
      if (!updated) throw new ContactNotFoundError(contactId);
      return updated;
    });
  },

  async updateBrand(db: Db, organizationId: string, brandId: string, input: UpdateBrandInput): Promise<Brand> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const existing = await BrandsRepository.findByIdWithTx(tx, organizationId, brandId);
      if (!existing) throw new BrandNotFoundError(brandId);
      await assertCompanyInOrg(tx, organizationId, input.companyId);
      const updated = await BrandsRepository.updateWithTx(tx, organizationId, brandId, input);
      if (!updated) throw new BrandNotFoundError(brandId);
      return updated;
    });
  },
};
