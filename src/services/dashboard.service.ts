import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { DashboardRepository, type Bounds, type ClosedOpportunityRow } from "@/repositories/dashboard.repository";
import { STAGES, type OpportunityStage } from "@/lib/opportunity-stages";
import {
  bucketFor, bucketKey, bucketStarts, periodBounds, previousPeriod, toLocalDate, type Bucket, type Period,
} from "@/lib/dashboard/period";
import { resolveValueCents, snapshotTotalCents } from "@/lib/dashboard/value";

type Db = NodePgDatabase<typeof schema>;
const DAY_MS = 86_400_000;

export interface PeriodMetrics {
  inquiriesReceived: number; inquiriesConverted: number; conversionRate: number | null;
  opportunitiesCreated: number;
  wonCount: number; wonCents: number; lostCount: number;
  winRate: number | null; averageTicketCents: number | null; averageDaysToClose: number | null;
}

export interface DashboardMetrics {
  period: Period; previousPeriod: Period;
  current: PeriodMetrics; previous: PeriodMetrics;
  series: { bucket: Bucket; points: Array<{ start: string; wonCents: number; wonCount: number }> };
  openNow: { count: number; valueCents: number };
  funnel: Array<{ stage: OpportunityStage; count: number }>;
  creators: Array<{ creatorId: string; name: string; openOpportunities: number; proposalsSent: number; wonCount: number; wonCents: number; approvalRate: number | null }>;
}

const ratio = (numerator: number, denominator: number) => (denominator === 0 ? null : numerator / denominator);

async function wonWithValues(tx: Db, organizationId: string, won: ClosedOpportunityRow[]) {
  const snapshots = await DashboardRepository.acceptedSnapshots(tx, organizationId, won.map((w) => w.id));
  return won.map((row) => {
    const snapshot = snapshots.get(row.id);
    const accepted = snapshot === undefined ? null : snapshotTotalCents(snapshot);
    return { ...row, valueCents: resolveValueCents({ preferredCents: accepted, estimatedValueCents: row.estimatedValueCents }) };
  });
}

async function periodMetrics(tx: Db, organizationId: string, bounds: Bounds, scope: string | null) {
  const [inquiries, created, wonRows, lostRows] = await Promise.all([
    DashboardRepository.inquiryCounts(tx, organizationId, bounds, scope),
    DashboardRepository.opportunitiesCreatedCount(tx, organizationId, bounds, scope),
    DashboardRepository.closedOpportunities(tx, organizationId, bounds, "FECHADO", scope),
    DashboardRepository.closedOpportunities(tx, organizationId, bounds, "PERDIDO", scope),
  ]);
  const won = await wonWithValues(tx, organizationId, wonRows);
  const wonCents = won.reduce((sum, w) => sum + w.valueCents, 0);
  const days = won.map((w) => (w.closedAt.getTime() - w.createdAt.getTime()) / DAY_MS);
  const metrics: PeriodMetrics = {
    inquiriesReceived: inquiries.received,
    inquiriesConverted: inquiries.converted,
    conversionRate: ratio(inquiries.converted, inquiries.received),
    opportunitiesCreated: created,
    wonCount: won.length,
    wonCents,
    lostCount: lostRows.length,
    winRate: ratio(won.length, won.length + lostRows.length),
    averageTicketCents: won.length === 0 ? null : Math.round(wonCents / won.length),
    averageDaysToClose: days.length === 0 ? null : Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10,
  };
  return { metrics, won };
}

export const DashboardService = {
  async getMetrics(db: Db, organizationId: string, period: Period, options: { creatorScope: string | null }): Promise<DashboardMetrics> {
    const scope = options.creatorScope;
    const previous = previousPeriod(period);
    return runInTenantContext(db, organizationId, async (tx) => {
      const bounds = periodBounds(period);
      const [current, prev, open, creatorList, sent, responses] = await Promise.all([
        periodMetrics(tx, organizationId, bounds, scope),
        periodMetrics(tx, organizationId, periodBounds(previous), scope),
        DashboardRepository.openOpportunities(tx, organizationId, scope),
        DashboardRepository.creators(tx, organizationId, scope),
        DashboardRepository.proposalsSentByCreator(tx, organizationId, bounds, scope),
        DashboardRepository.clientResponsesByCreator(tx, organizationId, bounds, scope),
      ]);

      const totals = await DashboardRepository.currentProposalTotals(tx, organizationId, open.map((o) => o.id));
      const openValue = open.reduce(
        (sum, o) => sum + resolveValueCents({ preferredCents: totals.get(o.id) ?? null, estimatedValueCents: o.estimatedValueCents }),
        0,
      );

      const bucket = bucketFor(period);
      const points = new Map(bucketStarts(period, bucket).map((start) => [start, { start, wonCents: 0, wonCount: 0 }]));
      for (const w of current.won) {
        const point = points.get(bucketKey(toLocalDate(w.closedAt), bucket));
        if (point) {
          point.wonCents += w.valueCents;
          point.wonCount += 1;
        }
      }

      const funnel = STAGES.filter((s) => s !== "FECHADO" && s !== "PERDIDO").map((stage) => ({
        stage,
        count: open.filter((o) => o.stage === stage).length,
      }));

      const creators = creatorList
        .map((creator) => {
          const wonOfCreator = current.won.filter((w) => w.creatorId === creator.id);
          const r = responses.get(creator.id) ?? { accepts: 0, rejects: 0 };
          return {
            creatorId: creator.id,
            name: creator.name,
            openOpportunities: open.filter((o) => o.creatorId === creator.id).length,
            proposalsSent: sent.get(creator.id) ?? 0,
            wonCount: wonOfCreator.length,
            wonCents: wonOfCreator.reduce((sum, w) => sum + w.valueCents, 0),
            approvalRate: ratio(r.accepts, r.accepts + r.rejects),
          };
        })
        .sort((a, b) => b.wonCents - a.wonCents || a.name.localeCompare(b.name, "pt-BR"));

      return {
        period,
        previousPeriod: previous,
        current: current.metrics,
        previous: prev.metrics,
        series: { bucket, points: [...points.values()] },
        openNow: { count: open.length, valueCents: openValue },
        funnel,
        creators,
      };
    });
  },
};
