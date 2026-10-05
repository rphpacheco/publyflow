import { and, count, desc, eq, gte, inArray, lt, max, ne, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { commercialInquiries, opportunities, opportunityStageHistory } from "@/db/schema/commercial-flow";
import { proposalItems, proposalPublications, proposalResponses, proposals, proposalVersions } from "@/db/schema/proposals";
import { creators } from "@/db/schema/creators";
import type { OpportunityStage } from "@/lib/opportunity-stages";

type Db = NodePgDatabase<typeof schema>;
export interface Bounds { start: Date; endExclusive: Date }
export interface ClosedOpportunityRow { id: string; creatorId: string; createdAt: Date; closedAt: Date; estimatedValueCents: number | null }
export interface OpenOpportunityRow { id: string; creatorId: string; stage: OpportunityStage; estimatedValueCents: number | null }

const scoped = (column: AnyPgColumn, scope: string | null) => (scope === null ? undefined : eq(column, scope));

export const DashboardRepository = {
  async inquiryCounts(tx: Db, organizationId: string, bounds: Bounds, scope: string | null) {
    const [row] = await tx
      .select({
        received: count(),
        converted: sql<number>`count(*) filter (where ${commercialInquiries.status} = 'CONVERTED')`.mapWith(Number),
      })
      .from(commercialInquiries)
      .where(and(
        eq(commercialInquiries.organizationId, organizationId),
        gte(commercialInquiries.createdAt, bounds.start),
        lt(commercialInquiries.createdAt, bounds.endExclusive),
        scoped(commercialInquiries.creatorId, scope),
      ));
    return { received: Number(row.received), converted: Number(row.converted) };
  },

  async opportunitiesCreatedCount(tx: Db, organizationId: string, bounds: Bounds, scope: string | null) {
    const [row] = await tx
      .select({ n: count() })
      .from(opportunities)
      .where(and(
        eq(opportunities.organizationId, organizationId),
        gte(opportunities.createdAt, bounds.start),
        lt(opportunities.createdAt, bounds.endExclusive),
        scoped(opportunities.creatorId, scope),
      ));
    return Number(row.n);
  },

  // Spec D5: most recent entry into the terminal stage inside the period AND current status matches.
  async closedOpportunities(tx: Db, organizationId: string, bounds: Bounds, terminal: "FECHADO" | "PERDIDO", scope: string | null): Promise<ClosedOpportunityRow[]> {
    const lastEntry = tx
      .select({
        opportunityId: opportunityStageHistory.opportunityId,
        closedAt: max(opportunityStageHistory.changedAt).as("closed_at"),
      })
      .from(opportunityStageHistory)
      .where(and(eq(opportunityStageHistory.organizationId, organizationId), eq(opportunityStageHistory.toStage, terminal)))
      .groupBy(opportunityStageHistory.opportunityId)
      .as("last_entry");
    const rows = await tx
      .select({
        id: opportunities.id,
        creatorId: opportunities.creatorId,
        createdAt: opportunities.createdAt,
        estimatedValueCents: opportunities.estimatedValueCents,
        closedAt: lastEntry.closedAt,
      })
      .from(opportunities)
      .innerJoin(lastEntry, eq(lastEntry.opportunityId, opportunities.id))
      .where(and(
        eq(opportunities.organizationId, organizationId),
        eq(opportunities.status, terminal === "FECHADO" ? "WON" : "LOST"),
        gte(lastEntry.closedAt, bounds.start),
        lt(lastEntry.closedAt, bounds.endExclusive),
        scoped(opportunities.creatorId, scope),
      ));
    return rows.map((row) => ({ ...row, closedAt: new Date(row.closedAt as unknown as string) }));
  },

  async openOpportunities(tx: Db, organizationId: string, scope: string | null): Promise<OpenOpportunityRow[]> {
    return tx
      .select({ id: opportunities.id, creatorId: opportunities.creatorId, stage: opportunities.stage, estimatedValueCents: opportunities.estimatedValueCents })
      .from(opportunities)
      .where(and(eq(opportunities.organizationId, organizationId), eq(opportunities.status, "OPEN"), scoped(opportunities.creatorId, scope)));
  },

  async acceptedSnapshots(tx: Db, organizationId: string, opportunityIds: string[]): Promise<Map<string, unknown>> {
    if (opportunityIds.length === 0) return new Map();
    const rows = await tx
      .select({ opportunityId: proposals.opportunityId, snapshot: proposalVersions.snapshotJson })
      .from(proposalResponses)
      .innerJoin(proposalPublications, and(eq(proposalPublications.id, proposalResponses.publicationId), eq(proposalPublications.organizationId, organizationId)))
      .innerJoin(proposals, and(eq(proposals.id, proposalPublications.proposalId), eq(proposals.organizationId, organizationId)))
      .innerJoin(proposalVersions, and(eq(proposalVersions.id, proposalPublications.versionId), eq(proposalVersions.organizationId, organizationId)))
      .where(and(eq(proposalResponses.organizationId, organizationId), eq(proposalResponses.action, "ACCEPT"), inArray(proposals.opportunityId, opportunityIds)))
      .orderBy(desc(proposalPublications.publishedAt));
    const result = new Map<string, unknown>();
    for (const row of rows) if (!result.has(row.opportunityId)) result.set(row.opportunityId, row.snapshot);
    return result;
  },

  async currentProposalTotals(tx: Db, organizationId: string, opportunityIds: string[]): Promise<Map<string, number>> {
    if (opportunityIds.length === 0) return new Map();
    const rows = await tx
      .select({
        opportunityId: proposals.opportunityId,
        total: sql<number>`coalesce(sum(${proposalItems.quantity} * ${proposalItems.unitPrice}), 0)`.mapWith(Number),
      })
      .from(proposals)
      .leftJoin(proposalItems, and(eq(proposalItems.proposalId, proposals.id), eq(proposalItems.organizationId, organizationId)))
      .where(and(eq(proposals.organizationId, organizationId), ne(proposals.status, "ARCHIVED"), inArray(proposals.opportunityId, opportunityIds)))
      .groupBy(proposals.id, proposals.opportunityId, proposals.createdAt)
      .orderBy(desc(proposals.createdAt));
    const result = new Map<string, number>();
    for (const row of rows) if (!result.has(row.opportunityId)) result.set(row.opportunityId, Number(row.total));
    return result;
  },

  async creators(tx: Db, organizationId: string, scope: string | null) {
    return tx
      .select({ id: creators.id, name: creators.displayName })
      .from(creators)
      .where(and(eq(creators.organizationId, organizationId), scoped(creators.id, scope)))
      .orderBy(creators.displayName);
  },

  async proposalsSentByCreator(tx: Db, organizationId: string, bounds: Bounds, scope: string | null): Promise<Map<string, number>> {
    const rows = await tx
      .select({ creatorId: opportunities.creatorId, n: count() })
      .from(proposalPublications)
      .innerJoin(proposals, and(eq(proposals.id, proposalPublications.proposalId), eq(proposals.organizationId, organizationId)))
      .innerJoin(opportunities, and(eq(opportunities.id, proposals.opportunityId), eq(opportunities.organizationId, organizationId)))
      .where(and(
        eq(proposalPublications.organizationId, organizationId),
        gte(proposalPublications.publishedAt, bounds.start),
        lt(proposalPublications.publishedAt, bounds.endExclusive),
        scoped(opportunities.creatorId, scope),
      ))
      .groupBy(opportunities.creatorId);
    return new Map(rows.map((r) => [r.creatorId, Number(r.n)]));
  },

  async clientResponsesByCreator(tx: Db, organizationId: string, bounds: Bounds, scope: string | null) {
    const rows = await tx
      .select({
        creatorId: opportunities.creatorId,
        accepts: sql<number>`count(*) filter (where ${proposalResponses.action} = 'ACCEPT')`.mapWith(Number),
        rejects: sql<number>`count(*) filter (where ${proposalResponses.action} = 'REJECT')`.mapWith(Number),
      })
      .from(proposalResponses)
      .innerJoin(proposalPublications, and(eq(proposalPublications.id, proposalResponses.publicationId), eq(proposalPublications.organizationId, organizationId)))
      .innerJoin(proposals, and(eq(proposals.id, proposalPublications.proposalId), eq(proposals.organizationId, organizationId)))
      .innerJoin(opportunities, and(eq(opportunities.id, proposals.opportunityId), eq(opportunities.organizationId, organizationId)))
      .where(and(
        eq(proposalResponses.organizationId, organizationId),
        gte(proposalResponses.respondedAt, bounds.start),
        lt(proposalResponses.respondedAt, bounds.endExclusive),
        scoped(opportunities.creatorId, scope),
      ))
      .groupBy(opportunities.creatorId);
    return new Map(rows.map((r) => [r.creatorId, { accepts: Number(r.accepts), rejects: Number(r.rejects) }]));
  },
};
