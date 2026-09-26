import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import type * as schema from "@/db/schema";
import { OrganizationService } from "@/services/organization.service";
import { CreatorService } from "@/services/creator.service";
import { ProposalService } from "@/services/proposal.service";
import { companies, contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";
import type { ProposalTheme } from "@/lib/proposal-themes";

type OpportunityStage = (typeof opportunities.$inferSelect)["stage"];

let counter = 0;

/** Org + owner + creator Thais (@thais) + Bella Cosméticos + opportunity + proposal (version 1, COVER, TEXT). */
export async function seedProposal(
  db: NodePgDatabase<typeof schema>,
  options: { theme?: ProposalTheme; opportunityStage?: OpportunityStage } = {},
) {
  counter += 1;
  const suffix = `${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
  const { organization, owner } = await OrganizationService.createWithOwner(db, {
    organizationName: `Org ${suffix}`,
    ownerEmail: `owner-${suffix}@publyflow.test`,
    ownerFullName: "Owner",
  });
  const creator = await CreatorService.onboardCreator(db, organization.id, {
    email: `creator-${suffix}@publyflow.test`,
    fullName: "Thais",
    displayName: "Thais",
    instagramHandle: "@thais",
  });
  const [company] = await db.insert(companies).values({ organizationId: organization.id, name: "Bella Cosméticos" }).returning();
  const [contact] = await db
    .insert(contacts)
    .values({ organizationId: organization.id, companyId: company.id, fullName: "Maria Fernandes" })
    .returning();
  const [lead] = await db
    .insert(leads)
    .values({ organizationId: organization.id, creatorId: creator.id, contactId: contact.id, companyId: company.id, qualified: true })
    .returning();
  let [opportunity] = await db
    .insert(opportunities)
    .values({ organizationId: organization.id, creatorId: creator.id, leadId: lead.id, companyId: company.id, brandId: null })
    .returning();
  if (options.opportunityStage) {
    [opportunity] = await db
      .update(opportunities)
      .set({ stage: options.opportunityStage })
      .where(eq(opportunities.id, opportunity.id))
      .returning();
  }
  const proposal = await ProposalService.create(db, organization.id, {
    opportunityId: opportunity.id,
    title: "Campanha Verão",
    theme: options.theme ?? "PREMIUM",
    userId: owner.id,
  });
  return { organization, owner, creator, opportunity, proposal };
}
