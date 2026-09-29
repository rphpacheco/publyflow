import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { eq } from "drizzle-orm";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { ProposalService } from "@/services/proposal.service";
import { companies, contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";
import { users } from "@/db/schema/organizations";

let counter = 0;

/** One organization with two creators (X and Y), each owning an opportunity and a proposal. */
export async function seedTwoCreators(db: NodePgDatabase<typeof schema>) {
  counter += 1;
  const suffix = `${Date.now()}-${counter}`;
  const { organization, owner } = await OrganizationService.createWithOwner(db, {
    organizationName: `Org ${suffix}`,
    ownerEmail: `owner-${suffix}@publyflow.test`,
    ownerFullName: "Owner",
  });

  async function seedCreator(name: string) {
    const creator = await CreatorService.register(db, organization.id, {
      fullName: name,
      displayName: name,
      email: `${name.toLowerCase()}-${suffix}@publyflow.test`,
      instagramHandle: null,
    });
    const [user] = await db.select().from(users).where(eq(users.id, creator.userId));
    const [company] = await db.insert(companies).values({ organizationId: organization.id, name: `Marca ${name}` }).returning();
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: organization.id, companyId: company.id, fullName: `Contato ${name}` })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({ organizationId: organization.id, creatorId: creator.id, contactId: contact.id, companyId: company.id, qualified: true })
      .returning();
    const [opportunity] = await db
      .insert(opportunities)
      .values({ organizationId: organization.id, creatorId: creator.id, leadId: lead.id, companyId: company.id, brandId: null })
      .returning();
    const proposal = await ProposalService.create(db, organization.id, {
      opportunityId: opportunity.id,
      title: `Proposta ${name}`,
      theme: "PREMIUM",
      userId: owner.id,
    });
    return { creator, user, opportunity, proposal };
  }

  const x = await seedCreator("Xavier");
  const y = await seedCreator("Yara");
  return { organization, owner, x, y };
}
