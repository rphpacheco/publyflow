import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { companies, companyAliases, contacts } from "@/db/schema/companies-brands-contacts";
import { leads } from "@/db/schema/commercial-flow";

type Db = NodePgDatabase<typeof schema>;

export const UNKNOWN_ID = "00000000-0000-4000-8000-0000000000aa";

/** One org with a duplicate + stays company and contact, plus a creator for 403 checks. */
export async function seedMergePair(db: Db) {
  const a = await seedProposal(db);
  const orgId = a.organization.id;
  const duplicateCompanyId = a.opportunity.companyId!;
  const [staysCompany] = await db.insert(companies).values({ organizationId: orgId, name: "Bella Cosmeticos Ltda" }).returning();
  const [lead] = await db.select().from(leads).where(eq(leads.id, a.opportunity.leadId));
  const [staysContact] = await db.insert(contacts).values({ organizationId: orgId, fullName: "Bela Souza" }).returning();
  return {
    orgId,
    userId: a.owner.id,
    creatorId: a.creator.id,
    duplicateCompanyId,
    staysCompanyId: staysCompany.id,
    duplicateContactId: lead.contactId,
    staysContactId: staysContact.id,
  };
}

export async function addAlias(db: Db, organizationId: string, companyId: string, name: string) {
  const [alias] = await db.insert(companyAliases).values({ organizationId, companyId, name }).returning();
  return alias;
}
