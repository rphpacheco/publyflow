import { and, desc, eq, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { opportunities, opportunityStageHistory, leads } from "@/db/schema/commercial-flow";
import { runInTenantContext } from "./tenant-context";

export type Opportunity = typeof opportunities.$inferSelect;

export interface CreateOpportunityInput {
  creatorId: string;
  leadId: string;
  companyId: string | null;
  brandId: string | null;
}

export interface FindOpenForPartyInput {
  creatorId: string;
  contactId?: string;
  companyId?: string;
  brandId?: string;
}

// Shared insert logic (opportunity + its initial stage-history row) — see
// conversations.repository.ts for the pattern. `create` opens its own
// transaction; `createWithTx` lets a caller fold both inserts into a
// larger, caller-owned transaction (e.g. CommercialInquiryService.resolve).
async function insertOpportunity(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  input: CreateOpportunityInput,
): Promise<Opportunity> {
  const [opportunity] = await tx
    .insert(opportunities)
    .values({
      organizationId,
      creatorId: input.creatorId,
      leadId: input.leadId,
      companyId: input.companyId,
      brandId: input.brandId,
      stage: "NOVO_LEAD",
      status: "OPEN",
    })
    .returning();

  await tx.insert(opportunityStageHistory).values({
    organizationId,
    opportunityId: opportunity.id,
    fromStage: null,
    toStage: "NOVO_LEAD",
  });

  return opportunity;
}

async function selectOpportunityById(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  opportunityId: string,
): Promise<Opportunity | null> {
  const [opportunity] = await tx
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)));
  return opportunity ?? null;
}

async function selectOpenForParty(
  tx: NodePgDatabase<typeof schema>,
  party: FindOpenForPartyInput,
): Promise<Opportunity | null> {
  const conditions = [];
  if (party.companyId) conditions.push(eq(opportunities.companyId, party.companyId));
  if (party.brandId) conditions.push(eq(opportunities.brandId, party.brandId));
  if (party.contactId) {
    conditions.push(eq(leads.contactId, party.contactId));
  }

  if (conditions.length === 0) return null;

  const [opportunity] = await tx
    .select({ opportunity: opportunities })
    .from(opportunities)
    .innerJoin(leads, eq(leads.id, opportunities.leadId))
    .where(
      and(eq(opportunities.status, "OPEN"), eq(opportunities.creatorId, party.creatorId), or(...conditions)),
    )
    .orderBy(desc(opportunities.createdAt))
    .limit(1);

  return opportunity?.opportunity ?? null;
}

export const OpportunitiesRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateOpportunityInput,
  ): Promise<Opportunity> {
    return runInTenantContext(db, organizationId, (tx) => insertOpportunity(tx, organizationId, input));
  },

  async createWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateOpportunityInput,
  ): Promise<Opportunity> {
    return insertOpportunity(tx, organizationId, input);
  },

  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    opportunityId: string,
  ): Promise<Opportunity | null> {
    return runInTenantContext(db, organizationId, (tx) =>
      selectOpportunityById(tx, organizationId, opportunityId),
    );
  },

  async findByIdWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    opportunityId: string,
  ): Promise<Opportunity | null> {
    return selectOpportunityById(tx, organizationId, opportunityId);
  },

  async findOpenForParty(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    party: FindOpenForPartyInput,
  ): Promise<Opportunity | null> {
    return runInTenantContext(db, organizationId, (tx) => selectOpenForParty(tx, party));
  },

  async findOpenForPartyWithTx(
    tx: NodePgDatabase<typeof schema>,
    _organizationId: string,
    party: FindOpenForPartyInput,
  ): Promise<Opportunity | null> {
    return selectOpenForParty(tx, party);
  },
};
