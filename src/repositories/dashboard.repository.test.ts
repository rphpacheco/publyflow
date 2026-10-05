import { describe, it, expect, afterEach } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { seedInquiry } from "@/test/helpers/inquiry-fixtures";
import { opportunityStageHistory } from "@/db/schema";
import { proposalItems } from "@/db/schema/proposals";
import { runInTenantContext } from "./tenant-context";
import { OpportunitiesRepository } from "./opportunities.repository";
import { ProposalSendingService } from "@/services/proposal-sending.service";
import { ProposalResponseService } from "@/services/proposal-response.service";
import { DashboardRepository } from "./dashboard.repository";

const OCT = { start: new Date("2026-10-01T03:00:00Z"), endExclusive: new Date("2026-11-01T03:00:00Z") };

type Db = Parameters<typeof runInTenantContext>[0];

async function setHistoryDate(db: Db, opportunityId: string, at: string) {
  await db.update(opportunityStageHistory).set({ changedAt: new Date(at) })
    .where(eq(opportunityStageHistory.opportunityId, opportunityId));
}

/** Moves the opportunity to `stage` and dates ONLY the history row that move created. */
async function moveStageAt(db: Db, organizationId: string, opportunityId: string, stage: "FECHADO" | "PERDIDO" | "NEGOCIACAO", at: string) {
  const before = await db.select({ id: opportunityStageHistory.id }).from(opportunityStageHistory)
    .where(eq(opportunityStageHistory.opportunityId, opportunityId));
  await OpportunitiesRepository.updateStage(db, organizationId, opportunityId, stage);
  const after = await db.select({ id: opportunityStageHistory.id }).from(opportunityStageHistory)
    .where(eq(opportunityStageHistory.opportunityId, opportunityId));
  const known = new Set(before.map((r) => r.id));
  const created = after.filter((r) => !known.has(r.id)).map((r) => r.id);
  expect(created).toHaveLength(1);
  await db.update(opportunityStageHistory).set({ changedAt: new Date(at) })
    .where(inArray(opportunityStageHistory.id, created));
}

const SEP = { start: new Date("2026-09-01T03:00:00Z"), endExclusive: new Date("2026-10-01T03:00:00Z") };

describe("DashboardRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup() {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const b = await seedProposal(db); // other org
    const read = <T>(fn: (tx: typeof db) => Promise<T>) => runInTenantContext(db, a.organization.id, fn);
    return { db, a, b, read };
  }

  it("closedOpportunities uses the most recent FECHADO entry and the current WON status", async () => {
    const { db, a, read } = await setup();
    const id = a.opportunity.id;
    await OpportunitiesRepository.updateStage(db, a.organization.id, id, "FECHADO");
    await setHistoryDate(db, id, "2026-10-10T12:00:00Z");
    let rows = await read((tx) => DashboardRepository.closedOpportunities(tx, a.organization.id, OCT, "FECHADO", null));
    expect(rows.map((r) => r.id)).toEqual([id]);
    expect(rows[0].closedAt.toISOString()).toBe("2026-10-10T12:00:00.000Z");

    await OpportunitiesRepository.updateStage(db, a.organization.id, id, "NEGOCIACAO"); // reopened → status OPEN
    rows = await read((tx) => DashboardRepository.closedOpportunities(tx, a.organization.id, OCT, "FECHADO", null));
    expect(rows).toEqual([]);
  });

  it("closed in September, reopened, closed again in October: counted once in October only", async () => {
    const { db, a, read } = await setup();
    const id = a.opportunity.id;
    await moveStageAt(db, a.organization.id, id, "FECHADO", "2026-09-15T12:00:00Z");
    await moveStageAt(db, a.organization.id, id, "NEGOCIACAO", "2026-09-20T12:00:00Z");
    await moveStageAt(db, a.organization.id, id, "FECHADO", "2026-10-12T12:00:00Z");
    const oct = await read((tx) => DashboardRepository.closedOpportunities(tx, a.organization.id, OCT, "FECHADO", null));
    expect(oct.map((r) => r.id)).toEqual([id]);
    expect(oct[0].closedAt.toISOString()).toBe("2026-10-12T12:00:00.000Z");
    expect(await read((tx) => DashboardRepository.closedOpportunities(tx, a.organization.id, SEP, "FECHADO", null))).toEqual([]);
  });

  it("FECHADO then directly PERDIDO: appears as PERDIDO, not as FECHADO", async () => {
    const { db, a, read } = await setup();
    const id = a.opportunity.id;
    await moveStageAt(db, a.organization.id, id, "FECHADO", "2026-10-03T12:00:00Z");
    await moveStageAt(db, a.organization.id, id, "PERDIDO", "2026-10-08T12:00:00Z");
    const lost = await read((tx) => DashboardRepository.closedOpportunities(tx, a.organization.id, OCT, "PERDIDO", null));
    expect(lost.map((r) => r.id)).toEqual([id]);
    expect(lost[0].closedAt.toISOString()).toBe("2026-10-08T12:00:00.000Z");
    expect(await read((tx) => DashboardRepository.closedOpportunities(tx, a.organization.id, OCT, "FECHADO", null))).toEqual([]);
  });

  it("closed outside the period is not returned; scope filters by creator", async () => {
    const { db, a, read } = await setup();
    await OpportunitiesRepository.updateStage(db, a.organization.id, a.opportunity.id, "FECHADO");
    await setHistoryDate(db, a.opportunity.id, "2026-09-30T23:00:00Z"); // 20:00 SP on Sep 30
    expect(await read((tx) => DashboardRepository.closedOpportunities(tx, a.organization.id, OCT, "FECHADO", null))).toEqual([]);
    await setHistoryDate(db, a.opportunity.id, "2026-10-02T12:00:00Z");
    expect(await read((tx) => DashboardRepository.closedOpportunities(tx, a.organization.id, OCT, "FECHADO", "00000000-0000-4000-8000-000000000099"))).toEqual([]);
    expect(await read((tx) => DashboardRepository.closedOpportunities(tx, a.organization.id, OCT, "FECHADO", a.creator.id))).toHaveLength(1);
  });

  it("openOpportunities and currentProposalTotals", async () => {
    const { db, a, read } = await setup();
    await db.insert(proposalItems).values({ organizationId: a.organization.id, proposalId: a.proposal.id, description: "Reels", quantity: 2, unitPrice: 50000 });
    const open = await read((tx) => DashboardRepository.openOpportunities(tx, a.organization.id, null));
    expect(open.map((o) => o.id)).toEqual([a.opportunity.id]);
    const totals = await read((tx) => DashboardRepository.currentProposalTotals(tx, a.organization.id, [a.opportunity.id]));
    expect(totals.get(a.opportunity.id)).toBeGreaterThanOrEqual(100000);
  });

  it("currentProposalTotals leaves out an opportunity whose current proposal has no items; zero-sum items count as 0", async () => {
    const { db, a, read } = await setup();
    let totals = await read((tx) => DashboardRepository.currentProposalTotals(tx, a.organization.id, [a.opportunity.id]));
    expect(totals.has(a.opportunity.id)).toBe(false);
    await db.insert(proposalItems).values({ organizationId: a.organization.id, proposalId: a.proposal.id, description: "Brinde", quantity: 1, unitPrice: 0 });
    totals = await read((tx) => DashboardRepository.currentProposalTotals(tx, a.organization.id, [a.opportunity.id]));
    expect(totals.get(a.opportunity.id)).toBe(0);
  });

  it("acceptedSnapshots returns the snapshot of the accepted publication", async () => {
    const { db, a, read } = await setup();
    await db.insert(proposalItems).values({ organizationId: a.organization.id, proposalId: a.proposal.id, description: "Reels", quantity: 1, unitPrice: 70000 });
    const { publication, publicPath } = await ProposalSendingService.publish(db, a.organization.id, a.proposal.id, a.owner.id);
    const token = publicPath.split("/").pop()!;
    await ProposalResponseService.respond(db, token, { publicationId: publication.id, action: "ACCEPT", name: "Cliente", email: "c@x.com", message: null });
    const snapshots = await read((tx) => DashboardRepository.acceptedSnapshots(tx, a.organization.id, [a.opportunity.id]));
    expect(snapshots.has(a.opportunity.id)).toBe(true);
  });

  it("creators, proposals sent and client responses by creator", async () => {
    const { db, a, read } = await setup();
    const { publication, publicPath } = await ProposalSendingService.publish(db, a.organization.id, a.proposal.id, a.owner.id);
    const token = publicPath.split("/").pop()!;
    await ProposalResponseService.respond(db, token, { publicationId: publication.id, action: "REJECT", name: "Cliente", email: "c@x.com", message: null });
    const wide = { start: new Date("2000-01-01T00:00:00Z"), endExclusive: new Date("2100-01-01T00:00:00Z") };
    expect(await read((tx) => DashboardRepository.creators(tx, a.organization.id, null))).toEqual([{ id: a.creator.id, name: "Thais" }]);
    expect((await read((tx) => DashboardRepository.proposalsSentByCreator(tx, a.organization.id, wide, null))).get(a.creator.id)).toBe(1);
    expect((await read((tx) => DashboardRepository.clientResponsesByCreator(tx, a.organization.id, wide, null))).get(a.creator.id)).toEqual({ accepts: 0, rejects: 1 });
  });

  it("inquiryCounts and opportunitiesCreatedCount respect period, org and scope", async () => {
    const { db, a, b, read } = await setup();
    const wide = { start: new Date("2000-01-01T00:00:00Z"), endExclusive: new Date("2100-01-01T00:00:00Z") };
    expect(await read((tx) => DashboardRepository.opportunitiesCreatedCount(tx, a.organization.id, wide, null))).toBe(1);
    expect(await read((tx) => DashboardRepository.opportunitiesCreatedCount(tx, a.organization.id, OCT, null))).toBe(
      a.opportunity.createdAt >= OCT.start && a.opportunity.createdAt < OCT.endExclusive ? 1 : 0,
    );
    await seedInquiry(db, a.organization.id, a.creator.id, "CONVERTED", "2026-10-02T12:00:00Z");
    await seedInquiry(db, a.organization.id, a.creator.id, "NEW", "2026-10-03T12:00:00Z");
    await seedInquiry(db, a.organization.id, a.creator.id, "CONVERTED", "2026-09-30T23:30:00Z"); // 20:30 SP, September
    await seedInquiry(db, b.organization.id, b.creator.id, "CONVERTED", "2026-10-02T12:00:00Z"); // other org
    expect(await read((tx) => DashboardRepository.inquiryCounts(tx, a.organization.id, OCT, null))).toEqual({ received: 2, converted: 1 });
    expect(await read((tx) => DashboardRepository.inquiryCounts(tx, a.organization.id, OCT, "00000000-0000-4000-8000-000000000099"))).toEqual({ received: 0, converted: 0 });
  });
});
