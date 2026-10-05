import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { opportunities, opportunityStageHistory } from "@/db/schema";
import { proposalItems, proposals } from "@/db/schema/proposals";
import { OpportunitiesRepository } from "@/repositories/opportunities.repository";
import { runInTenantContext } from "@/repositories/tenant-context";
import { ProposalVersionService } from "@/services/proposal-version.service";
import { ProposalService } from "@/services/proposal.service";
import { ProposalSendingService } from "@/services/proposal-sending.service";
import { ProposalResponseService } from "@/services/proposal-response.service";
import { STAGES } from "@/lib/opportunity-stages";
import { toLocalDate } from "@/lib/dashboard/period";
import { DashboardService } from "./dashboard.service";

const OCT = { from: "2026-10-01", to: "2026-10-31" };
// Publications/responses are immutable (published_at/responded_at = now), so tests that need them use a period around today.
const CURRENT_YEAR = toLocalDate(new Date()).slice(0, 4); // São Paulo year, not UTC
const THIS_YEAR = { from: `${CURRENT_YEAR}-01-01`, to: `${CURRENT_YEAR}-12-31` };
// Fixed clock after October 2026, so OCT is a closed (past) period and previousPeriod is the whole month.
const NOW = new Date("2026-11-15T12:00:00Z");
const NO_SCOPE: { creatorScope: string | null; now?: Date } = { creatorScope: null, now: NOW };

type Seed = Awaited<ReturnType<typeof seedProposal>>;
type Db = Parameters<typeof OpportunitiesRepository.updateStage>[0];

async function closeAt(db: Db, orgId: string, opportunityId: string, stage: "FECHADO" | "PERDIDO", at: string) {
  await OpportunitiesRepository.updateStage(db, orgId, opportunityId, stage);
  await db.update(opportunityStageHistory).set({ changedAt: new Date(at) }).where(eq(opportunityStageHistory.opportunityId, opportunityId));
}

async function setCreatedAt(db: Db, opportunityId: string, at: string) {
  await db.update(opportunities).set({ createdAt: new Date(at) }).where(eq(opportunities.id, opportunityId));
}

async function addItem(db: Db, s: Seed, proposalId: string, unitPrice: number) {
  await db.insert(proposalItems).values({ organizationId: s.organization.id, proposalId, description: "Reels", quantity: 1, unitPrice });
  // Publishing uses the latest stored version, so snapshot the item into a new one.
  await runInTenantContext(db, s.organization.id, (tx) => ProposalVersionService.createVersionWithTx(tx, s.organization.id, proposalId, s.owner.id));
}

/** A second opportunity (+ proposal) in the same org/creator as `s`. */
async function addOpportunity(db: Db, s: Seed) {
  const [opportunity] = await db
    .insert(opportunities)
    .values({ organizationId: s.organization.id, creatorId: s.creator.id, leadId: s.opportunity.leadId, companyId: s.opportunity.companyId, brandId: null })
    .returning();
  const proposal = await ProposalService.create(db, s.organization.id, { opportunityId: opportunity.id, title: "Outra", theme: "PREMIUM", userId: s.owner.id });
  return { opportunity, proposal };
}

async function publishAndRespond(db: Db, s: Seed, proposalId: string, action: "ACCEPT" | "REJECT" | "REQUEST_CHANGES") {
  const { publication, publicPath } = await ProposalSendingService.publish(db, s.organization.id, proposalId, s.owner.id);
  const token = publicPath.split("/").pop()!;
  await ProposalResponseService.respond(db, token, { publicationId: publication.id, action, name: "Cliente", email: "c@x.com", message: action === "REQUEST_CHANGES" ? "ajustar" : null });
}

describe("DashboardService.getMetrics", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup() {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const get = (s: Seed = a, period = OCT, options = NO_SCOPE) => DashboardService.getMetrics(db, s.organization.id, period, options);
    return { db, a, get };
  }

  it("won value prefers the accepted snapshot over the estimate", async () => {
    const { db, a, get } = await setup();
    await addItem(db, a, a.proposal.id, 70000);
    await db.update(opportunities).set({ estimatedValueCents: 90000 }).where(eq(opportunities.id, a.opportunity.id));
    await publishAndRespond(db, a, a.proposal.id, "ACCEPT");
    await closeAt(db, a.organization.id, a.opportunity.id, "FECHADO", "2026-10-10T12:00:00Z");
    const { current } = await get();
    expect(current.wonCents).toBe(70000);
    expect(current.wonCount).toBe(1);
    expect(current.averageTicketCents).toBe(70000);
  });

  it("won without acceptance uses the estimate, or 0 with neither", async () => {
    const { db, a, get } = await setup();
    await db.update(opportunities).set({ estimatedValueCents: 90000 }).where(eq(opportunities.id, a.opportunity.id));
    await closeAt(db, a.organization.id, a.opportunity.id, "FECHADO", "2026-10-10T12:00:00Z");
    expect((await get()).current.wonCents).toBe(90000);
    await db.update(opportunities).set({ estimatedValueCents: null }).where(eq(opportunities.id, a.opportunity.id));
    const { current } = await get();
    expect(current.wonCents).toBe(0);
    expect(current.wonCount).toBe(1);
  });

  it("averageDaysToClose is created to closed in days", async () => {
    const { db, a, get } = await setup();
    await setCreatedAt(db, a.opportunity.id, "2026-10-01T15:00:00Z");
    await closeAt(db, a.organization.id, a.opportunity.id, "FECHADO", "2026-10-11T15:00:00Z");
    expect((await get()).current.averageDaysToClose).toBe(10);
  });

  it("winRate is won/(won+lost); null metrics when nothing closed", async () => {
    const { db, a, get } = await setup();
    const empty = (await get()).current;
    expect(empty.winRate).toBeNull();
    expect(empty.averageTicketCents).toBeNull();
    expect(empty.averageDaysToClose).toBeNull();

    const other = await addOpportunity(db, a);
    await closeAt(db, a.organization.id, a.opportunity.id, "FECHADO", "2026-10-10T12:00:00Z");
    await closeAt(db, a.organization.id, other.opportunity.id, "PERDIDO", "2026-10-12T12:00:00Z");
    const { current } = await get();
    expect(current.wonCount).toBe(1);
    expect(current.lostCount).toBe(1);
    expect(current.winRate).toBe(0.5);
  });

  it("previous period holds the prior window", async () => {
    const { db, a, get } = await setup();
    await closeAt(db, a.organization.id, a.opportunity.id, "FECHADO", "2026-09-15T12:00:00Z");
    const result = await get();
    expect(result.previousPeriod).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(result.previous.wonCount).toBe(1);
    expect(result.current.wonCount).toBe(0);
  });

  it("while the period is running, previous compares the same elapsed span", async () => {
    const { db, a, get } = await setup();
    const other = await addOpportunity(db, a);
    await closeAt(db, a.organization.id, a.opportunity.id, "FECHADO", "2026-09-03T12:00:00Z");
    await closeAt(db, a.organization.id, other.opportunity.id, "FECHADO", "2026-09-15T12:00:00Z");
    const result = await get(a, OCT, { creatorScope: null, now: new Date("2026-10-05T15:00:00Z") });
    expect(result.period).toEqual(OCT);
    expect(result.previousPeriod).toEqual({ from: "2026-09-01", to: "2026-09-05" });
    expect(result.previous.wonCount).toBe(1);
    expect(result.series.points).toHaveLength(31); // chart stays on the full selected period
  });

  it("series has one point per day and places the win on its São Paulo local day", async () => {
    const { db, a, get } = await setup();
    await db.update(opportunities).set({ estimatedValueCents: 90000 }).where(eq(opportunities.id, a.opportunity.id));
    await closeAt(db, a.organization.id, a.opportunity.id, "FECHADO", "2026-10-11T01:30:00Z"); // 22:30 SP on Oct 10
    const { series } = await get();
    expect(series.bucket).toBe("day");
    expect(series.points).toHaveLength(31);
    for (const p of series.points) {
      if (p.start === "2026-10-10") expect(p).toEqual({ start: "2026-10-10", wonCents: 90000, wonCount: 1 });
      else expect(p).toEqual({ start: p.start, wonCents: 0, wonCount: 0 });
    }
  });

  it("openNow and funnel ignore the period", async () => {
    const { db, a, get } = await setup();
    await setCreatedAt(db, a.opportunity.id, "2025-03-01T12:00:00Z");
    await OpportunitiesRepository.updateStage(db, a.organization.id, a.opportunity.id, "NEGOCIACAO");
    const { openNow, funnel } = await get();
    expect(openNow.count).toBe(1);
    const expected = STAGES.filter((s) => s !== "FECHADO" && s !== "PERDIDO");
    expect(funnel.map((f) => f.stage)).toEqual(expected);
    expect(funnel.find((f) => f.stage === "NEGOCIACAO")?.count).toBe(1);
    expect(funnel.reduce((sum, f) => sum + f.count, 0)).toBe(1);
    expect(funnel.some((f) => (f.stage as string) === "FECHADO" || (f.stage as string) === "PERDIDO")).toBe(false);
  });

  it("openNow falls back to the estimate when the newest proposal has no items", async () => {
    const { db, a, get } = await setup();
    await db.update(opportunities).set({ estimatedValueCents: 90000 }).where(eq(opportunities.id, a.opportunity.id));
    await db.insert(proposalItems).values({ organizationId: a.organization.id, proposalId: a.proposal.id, description: "Reels", quantity: 1, unitPrice: 50000 });
    await db.update(proposals).set({ createdAt: new Date("2026-01-01T12:00:00Z") }).where(eq(proposals.id, a.proposal.id));
    await ProposalService.create(db, a.organization.id, { opportunityId: a.opportunity.id, title: "Nova", theme: "PREMIUM", userId: a.owner.id });
    const { openNow } = await get();
    expect(openNow).toEqual({ count: 1, valueCents: 90000 });
  });

  it("creators: listed with zeros; approvalRate from ACCEPT/REJECT only", async () => {
    const { db, a, get } = await setup();
    const idle = (await get()).creators;
    expect(idle).toEqual([{ creatorId: a.creator.id, name: "Thais", openOpportunities: 1, proposalsSent: 0, wonCount: 0, wonCents: 0, approvalRate: null }]);

    const second = await addOpportunity(db, a);
    const third = await addOpportunity(db, a);
    await publishAndRespond(db, a, a.proposal.id, "ACCEPT");
    await publishAndRespond(db, a, second.proposal.id, "REJECT");
    expect((await get(a, THIS_YEAR)).creators[0].approvalRate).toBe(0.5);
    await publishAndRespond(db, a, third.proposal.id, "REQUEST_CHANGES");
    const [row] = (await get(a, THIS_YEAR)).creators;
    expect(row.approvalRate).toBe(0.5);
    expect(row.proposalsSent).toBe(3);
  });

  it("is isolated per organization", async () => {
    const { db, a, get } = await setup();
    const b = await seedProposal(db);
    await db.update(opportunities).set({ estimatedValueCents: 500000 }).where(eq(opportunities.id, b.opportunity.id));
    await closeAt(db, b.organization.id, b.opportunity.id, "FECHADO", "2026-10-10T12:00:00Z");
    const result = await get(a);
    expect(result.current.wonCount).toBe(0);
    expect(result.current.wonCents).toBe(0);
    expect(result.openNow.count).toBe(1);
    expect(result.creators.map((c) => c.creatorId)).toEqual([a.creator.id]);
    expect((await get(b)).current.wonCents).toBe(500000);
  });

  it("creatorScope narrows every number to that creator", async () => {
    const { db, a, get } = await setup();
    await db.update(opportunities).set({ estimatedValueCents: 90000 }).where(eq(opportunities.id, a.opportunity.id));
    await closeAt(db, a.organization.id, a.opportunity.id, "FECHADO", "2026-10-10T12:00:00Z");
    const other = await addOpportunity(db, a);
    await closeAt(db, a.organization.id, other.opportunity.id, "PERDIDO", "2026-10-12T12:00:00Z");
    const unscoped = await get();
    const mine = await get(a, OCT, { creatorScope: a.creator.id, now: NOW });
    expect(mine).toEqual(unscoped);
    expect(mine.current.wonCents).toBe(90000);

    const stranger = await get(a, OCT, { creatorScope: "00000000-0000-4000-8000-000000000099", now: NOW });
    expect(stranger.creators).toEqual([]);
    expect(stranger.current).toMatchObject({ inquiriesReceived: 0, opportunitiesCreated: 0, wonCount: 0, wonCents: 0, lostCount: 0 });
    expect(stranger.previous.wonCount).toBe(0);
    expect(stranger.openNow).toEqual({ count: 0, valueCents: 0 });
    expect(stranger.funnel.every((f) => f.count === 0)).toBe(true);
    expect(stranger.series.points.every((p) => p.wonCount === 0 && p.wonCents === 0)).toBe(true);
  });
});
