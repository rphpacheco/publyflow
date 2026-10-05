import { and, count, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { brands, companies, contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";
import { runInTenantContext } from "@/repositories/tenant-context";
import { CompaniesRepository, type Company } from "@/repositories/companies.repository";
import type { Contact } from "@/repositories/contacts.repository";
import { CompanyAliasesRepository } from "@/repositories/company-aliases.repository";
import { DomainEventsRepository } from "@/repositories/domain-events.repository";
import { CompanyNotFoundError, ContactNotFoundError, MergeSameRecordError } from "@/domain/crm/errors";

type Db = NodePgDatabase<typeof schema>;

export interface CompanyMergePreview {
  duplicate: { id: string; name: string };
  stays: { id: string; name: string };
  result: { name: string };
  impact: { brands: number; contacts: number; leads: number; opportunities: number };
  aliasToAdd: string | null;
  aliasesMoved: number;
}

export interface ContactMergePreview {
  duplicate: { id: string; name: string };
  stays: { id: string; name: string };
  result: {
    fullName: string;
    email: string | null;
    phone: string | null;
    instagramHandle: string | null;
    company: { id: string; name: string } | null;
  };
  filledFromDuplicate: Array<"email" | "phone" | "instagramHandle" | "companyId">;
  impact: { leads: number };
}

const norm = (s: string) => s.trim().toLowerCase();

/** Tables whose rows point at a company and move with a company merge. */
type CompanyRefTable = typeof brands | typeof contacts | typeof leads | typeof opportunities;

// Lock both rows in ascending id order so two merges of the same pair never deadlock.
async function lockCompanies(tx: Db, organizationId: string, duplicateId: string, staysId: string) {
  if (duplicateId === staysId) throw new MergeSameRecordError("company");
  const [first, second] = [duplicateId, staysId].sort();
  const a = await CompaniesRepository.lockByIdWithTx(tx, organizationId, first);
  const b = await CompaniesRepository.lockByIdWithTx(tx, organizationId, second);
  const duplicate = [a, b].find((c) => c?.id === duplicateId);
  const stays = [a, b].find((c) => c?.id === staysId);
  if (!duplicate) throw new CompanyNotFoundError(duplicateId);
  if (!stays) throw new CompanyNotFoundError(staysId);
  return { duplicate, stays };
}

async function countWhere(tx: Db, table: CompanyRefTable, organizationId: string, companyId: string) {
  const [row] = await tx.select({ n: count() }).from(table)
    .where(and(eq(table.organizationId, organizationId), eq(table.companyId, companyId)));
  return Number(row.n);
}

async function companyImpact(tx: Db, organizationId: string, duplicate: Company, stays: Company) {
  const aliases = await CompanyAliasesRepository.listByCompanyWithTx(tx, organizationId, duplicate.id);
  const staysAliases = await CompanyAliasesRepository.listByCompanyWithTx(tx, organizationId, stays.id);
  const nameIsNew =
    norm(duplicate.name) !== norm(stays.name) && !staysAliases.some((a) => norm(a.name) === norm(duplicate.name));
  return {
    impact: {
      brands: await countWhere(tx, brands, organizationId, duplicate.id),
      contacts: await countWhere(tx, contacts, organizationId, duplicate.id),
      leads: await countWhere(tx, leads, organizationId, duplicate.id),
      opportunities: await countWhere(tx, opportunities, organizationId, duplicate.id),
    },
    aliasToAdd: nameIsNew ? duplicate.name : null,
    aliasesMoved: aliases.filter((a) => norm(a.name) !== norm(stays.name)).length,
    aliases,
  };
}

async function repoint(tx: Db, table: CompanyRefTable, organizationId: string, fromId: string, toId: string) {
  const rows = await tx.update(table).set({ companyId: toId })
    .where(and(eq(table.organizationId, organizationId), eq(table.companyId, fromId)))
    .returning({ id: table.id });
  return rows.map((r) => r.id);
}

const CONTACT_FILLABLE = ["email", "phone", "instagramHandle", "companyId"] as const;
type Fillable = (typeof CONTACT_FILLABLE)[number];

async function lockContacts(tx: Db, organizationId: string, duplicateId: string, staysId: string) {
  if (duplicateId === staysId) throw new MergeSameRecordError("contact");
  const [first, second] = [duplicateId, staysId].sort();
  const lock = (id: string) =>
    tx.select().from(contacts).where(and(eq(contacts.id, id), eq(contacts.organizationId, organizationId))).for("update");
  const [a] = await lock(first);
  const [b] = await lock(second);
  const duplicate = [a, b].find((c) => c?.id === duplicateId);
  const stays = [a, b].find((c) => c?.id === staysId);
  if (!duplicate) throw new ContactNotFoundError(duplicateId);
  if (!stays) throw new ContactNotFoundError(staysId);
  return { duplicate, stays };
}

/** Fields empty on stays (null or "") that the duplicate can fill. */
function filledFields(duplicate: Contact, stays: Contact): Fillable[] {
  return CONTACT_FILLABLE.filter(
    (f) => (stays[f] === null || stays[f] === "") && duplicate[f] !== null && duplicate[f] !== "",
  );
}

function fillValues(duplicate: Contact, fill: Fillable[]): Partial<Pick<Contact, Fillable>> {
  return Object.fromEntries(fill.map((f) => [f, duplicate[f]]));
}

export const CrmMergeService = {
  async previewCompanyMerge(db: Db, organizationId: string, duplicateId: string, staysId: string): Promise<CompanyMergePreview> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const { duplicate, stays } = await lockCompanies(tx, organizationId, duplicateId, staysId);
      const { impact, aliasToAdd, aliasesMoved } = await companyImpact(tx, organizationId, duplicate, stays);
      return {
        duplicate: { id: duplicate.id, name: duplicate.name },
        stays: { id: stays.id, name: stays.name },
        result: { name: stays.name },
        impact,
        aliasToAdd,
        aliasesMoved,
      };
    });
  },

  async mergeCompany(
    db: Db,
    organizationId: string,
    duplicateId: string,
    staysId: string,
    actor: { userId: string },
  ): Promise<Company> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const { duplicate, stays } = await lockCompanies(tx, organizationId, duplicateId, staysId);
      const { aliasToAdd, aliases } = await companyImpact(tx, organizationId, duplicate, stays);
      const moved = {
        brandIds: await repoint(tx, brands, organizationId, duplicate.id, stays.id),
        contactIds: await repoint(tx, contacts, organizationId, duplicate.id, stays.id),
        leadIds: await repoint(tx, leads, organizationId, duplicate.id, stays.id),
        opportunityIds: await repoint(tx, opportunities, organizationId, duplicate.id, stays.id),
      };
      for (const alias of aliases) {
        if (norm(alias.name) === norm(stays.name)) {
          await CompanyAliasesRepository.deleteByIdWithTx(tx, organizationId, alias.id);
        }
      }
      // Aliases must move before the duplicate is deleted (company_aliases cascades on delete).
      await CompanyAliasesRepository.moveWithTx(tx, organizationId, duplicate.id, stays.id);
      await tx.delete(companies).where(and(eq(companies.id, duplicate.id), eq(companies.organizationId, organizationId)));
      const aliasesAdded: string[] = [];
      if (aliasToAdd && (await CompanyAliasesRepository.insertIfAbsentWithTx(tx, organizationId, stays.id, aliasToAdd))) {
        aliasesAdded.push(aliasToAdd);
      }
      await DomainEventsRepository.appendWithTx(tx, organizationId, {
        eventType: "company.merged",
        entityType: "company",
        entityId: stays.id,
        payload: { duplicateId: duplicate.id, duplicateName: duplicate.name, staysId: stays.id, moved, aliasesAdded },
        actor: { userId: actor.userId },
      });
      return stays;
    });
  },

  async previewContactMerge(db: Db, organizationId: string, duplicateId: string, staysId: string): Promise<ContactMergePreview> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const { duplicate, stays } = await lockContacts(tx, organizationId, duplicateId, staysId);
      const fill = filledFields(duplicate, stays);
      const merged: Contact = { ...stays, ...fillValues(duplicate, fill) };
      let company: { id: string; name: string } | null = null;
      if (merged.companyId) {
        const found = await CompaniesRepository.findByIdWithTx(tx, organizationId, merged.companyId);
        company = found ? { id: found.id, name: found.name } : null;
      }
      const [row] = await tx.select({ n: count() }).from(leads)
        .where(and(eq(leads.organizationId, organizationId), eq(leads.contactId, duplicate.id)));
      return {
        duplicate: { id: duplicate.id, name: duplicate.fullName },
        stays: { id: stays.id, name: stays.fullName },
        result: {
          fullName: stays.fullName,
          email: merged.email,
          phone: merged.phone,
          instagramHandle: merged.instagramHandle,
          company,
        },
        filledFromDuplicate: fill,
        impact: { leads: Number(row.n) },
      };
    });
  },

  async mergeContact(
    db: Db,
    organizationId: string,
    duplicateId: string,
    staysId: string,
    actor: { userId: string },
  ): Promise<Contact> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const { duplicate, stays } = await lockContacts(tx, organizationId, duplicateId, staysId);
      const fill = filledFields(duplicate, stays);
      const leadIds = (
        await tx.update(leads).set({ contactId: stays.id })
          .where(and(eq(leads.organizationId, organizationId), eq(leads.contactId, duplicate.id)))
          .returning({ id: leads.id })
      ).map((r) => r.id);
      let updated = stays;
      if (fill.length > 0) {
        [updated] = await tx.update(contacts).set(fillValues(duplicate, fill))
          .where(and(eq(contacts.id, stays.id), eq(contacts.organizationId, organizationId)))
          .returning();
      }
      await tx.delete(contacts).where(and(eq(contacts.id, duplicate.id), eq(contacts.organizationId, organizationId)));
      await DomainEventsRepository.appendWithTx(tx, organizationId, {
        eventType: "contact.merged",
        entityType: "contact",
        entityId: stays.id,
        payload: {
          duplicateId: duplicate.id,
          duplicateName: duplicate.fullName,
          staysId: stays.id,
          moved: { leadIds },
          filledFields: fill,
        },
        actor: { userId: actor.userId },
      });
      return updated;
    });
  },
};
