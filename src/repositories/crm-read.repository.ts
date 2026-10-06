import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { brands, companies, companyAliases, contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";
import { proposals } from "@/db/schema/proposals";
import { creators } from "@/db/schema/creators";
import type { OpportunityStage } from "@/lib/opportunity-stages";
import type { ProposalStatus } from "@/lib/proposal-themes";
import type { Company } from "./companies.repository";
import type { Contact } from "./contacts.repository";
import { runInTenantContext } from "./tenant-context";

type Db = NodePgDatabase<typeof schema>;

export interface CompanyListItem {
  id: string;
  organizationId: string;
  name: string;
  createdAt: Date;
  brandCount: number;
  contactCount: number;
  openOpportunityCount: number;
}

export interface ContactListItem {
  id: string;
  organizationId: string;
  companyId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  instagramHandle: string | null;
  createdAt: Date;
  companyName: string | null;
}

export interface CrmOpportunityRow {
  id: string;
  brandName: string | null;
  creatorName: string;
  stage: OpportunityStage;
  status: "OPEN" | "WON" | "LOST";
  estimatedValueCents: number | null;
  createdAt: Date;
  proposals: Array<{ id: string; title: string; status: ProposalStatus }>;
}

export interface CompanyDetail {
  company: Company;
  brands: Array<{ id: string; name: string }>;
  aliases: Array<{ id: string; name: string }>;
  contacts: Array<{ id: string; fullName: string; email: string | null; phone: string | null; instagramHandle: string | null }>;
  opportunities: CrmOpportunityRow[];
}

export interface ContactDetail {
  contact: Contact;
  company: { id: string; name: string } | null;
  opportunities: CrmOpportunityRow[];
}

// Opportunities matching `where` (already org-scoped by the caller), with
// brand and creator names and their proposals. Every join repeats the
// organization predicate: the app role bypasses RLS.
async function opportunityRows(tx: Db, organizationId: string, where: SQL): Promise<CrmOpportunityRow[]> {
  const rows = await tx
    .select({
      id: opportunities.id,
      brandName: brands.name,
      creatorName: creators.displayName,
      stage: opportunities.stage,
      status: opportunities.status,
      estimatedValueCents: opportunities.estimatedValueCents,
      createdAt: opportunities.createdAt,
    })
    .from(opportunities)
    .innerJoin(creators, and(eq(creators.id, opportunities.creatorId), eq(creators.organizationId, organizationId)))
    .leftJoin(brands, and(eq(brands.id, opportunities.brandId), eq(brands.organizationId, organizationId)))
    .where(and(eq(opportunities.organizationId, organizationId), where))
    .orderBy(desc(opportunities.createdAt));
  if (rows.length === 0) return [];

  const proposalRows = await tx
    .select({ id: proposals.id, title: proposals.title, status: proposals.status, opportunityId: proposals.opportunityId })
    .from(proposals)
    .where(and(eq(proposals.organizationId, organizationId), inArray(proposals.opportunityId, rows.map((row) => row.id))))
    .orderBy(asc(proposals.createdAt));

  return rows.map((row) => ({
    ...row,
    proposals: proposalRows
      .filter((proposal) => proposal.opportunityId === row.id)
      .map(({ id, title, status }) => ({ id, title, status })),
  }));
}

export const CrmReadRepository = {
  async listCompanies(db: Db, organizationId: string): Promise<CompanyListItem[]> {
    return runInTenantContext(db, organizationId, (tx) =>
      tx
        .select({
          id: companies.id,
          organizationId: companies.organizationId,
          name: companies.name,
          createdAt: companies.createdAt,
          brandCount: sql<number>`(select count(*)::int from ${brands} where ${brands.companyId} = ${sql.raw('"companies"."id"')} and ${brands.organizationId} = ${organizationId})`,
          contactCount: sql<number>`(select count(*)::int from ${contacts} where ${contacts.companyId} = ${sql.raw('"companies"."id"')} and ${contacts.organizationId} = ${organizationId})`,
          openOpportunityCount: sql<number>`(select count(*)::int from ${opportunities} where ${opportunities.companyId} = ${sql.raw('"companies"."id"')} and ${opportunities.organizationId} = ${organizationId} and ${opportunities.status} = 'OPEN')`,
        })
        .from(companies)
        .where(eq(companies.organizationId, organizationId))
        .orderBy(desc(companies.createdAt)),
    );
  },

  async listContacts(db: Db, organizationId: string): Promise<ContactListItem[]> {
    return runInTenantContext(db, organizationId, (tx) =>
      tx
        .select({
          id: contacts.id,
          organizationId: contacts.organizationId,
          companyId: contacts.companyId,
          fullName: contacts.fullName,
          email: contacts.email,
          phone: contacts.phone,
          instagramHandle: contacts.instagramHandle,
          createdAt: contacts.createdAt,
          companyName: companies.name,
        })
        .from(contacts)
        .leftJoin(companies, and(eq(companies.id, contacts.companyId), eq(companies.organizationId, organizationId)))
        .where(eq(contacts.organizationId, organizationId))
        .orderBy(desc(contacts.createdAt)),
    );
  },

  async companyDetail(db: Db, organizationId: string, companyId: string): Promise<CompanyDetail | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [company] = await tx
        .select()
        .from(companies)
        .where(and(eq(companies.id, companyId), eq(companies.organizationId, organizationId)));
      if (!company) return null;

      const brandRows = await tx
        .select({ id: brands.id, name: brands.name })
        .from(brands)
        .where(and(eq(brands.companyId, companyId), eq(brands.organizationId, organizationId)))
        .orderBy(asc(brands.name));
      const aliasRows = await tx
        .select({ id: companyAliases.id, name: companyAliases.name })
        .from(companyAliases)
        .where(and(eq(companyAliases.companyId, companyId), eq(companyAliases.organizationId, organizationId)))
        .orderBy(asc(companyAliases.name));
      const contactRows = await tx
        .select({
          id: contacts.id,
          fullName: contacts.fullName,
          email: contacts.email,
          phone: contacts.phone,
          instagramHandle: contacts.instagramHandle,
        })
        .from(contacts)
        .where(and(eq(contacts.companyId, companyId), eq(contacts.organizationId, organizationId)))
        .orderBy(asc(contacts.fullName));
      const opportunityList = await opportunityRows(tx, organizationId, eq(opportunities.companyId, companyId));
      return { company, brands: brandRows, aliases: aliasRows, contacts: contactRows, opportunities: opportunityList };
    });
  },

  async contactDetail(db: Db, organizationId: string, contactId: string): Promise<ContactDetail | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [contact] = await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)));
      if (!contact) return null;

      let company: { id: string; name: string } | null = null;
      if (contact.companyId) {
        const [row] = await tx
          .select({ id: companies.id, name: companies.name })
          .from(companies)
          .where(and(eq(companies.id, contact.companyId), eq(companies.organizationId, organizationId)));
        company = row ?? null;
      }

      const leadIds = tx
        .select({ id: leads.id })
        .from(leads)
        .where(and(eq(leads.contactId, contactId), eq(leads.organizationId, organizationId)));
      const opportunityList = await opportunityRows(tx, organizationId, inArray(opportunities.leadId, leadIds));
      return { contact, company, opportunities: opportunityList };
    });
  },
};
