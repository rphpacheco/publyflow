import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession, creatorSession } from "@/test/helpers/route";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { organizationMembers } from "@/db/schema/organizations";
import { CreatorService } from "@/services/creator.service";
import { ProposalApprovalService } from "@/services/proposal-approval.service";
import { ProposalService } from "@/services/proposal.service";

const scheduleEventDrain = vi.fn();
vi.mock("@/lib/events/schedule-drain", () => ({ scheduleEventDrain: () => scheduleEventDrain() }));

const post = (id: string, body?: unknown) =>
  new Request(`http://localhost/api/proposals/${id}/approval/approve`, {
    method: "POST",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const DUMMY_APPROVAL_ID = "00000000-0000-0000-0000-000000000000";

async function setupWithRequest(db: Awaited<ReturnType<typeof withTestDb>>["db"]) {
  const { organization, owner, creator, proposal } = await seedProposal(db);
  await db.insert(organizationMembers).values({ organizationId: organization.id, userId: creator.userId, role: "CREATOR" });
  const { approval } = await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
  return { organization, owner, creator, proposal, approval };
}

describe("/api/proposals/:id/approval/approve", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => {
    scheduleEventDrain.mockClear();
    await cleanup?.();
  });

  it("200 approves for the owning creator", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, creator, proposal, approval } = await setupWithRequest(db);
    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: creatorSession(organization.id, creator.userId, creator.id),
    });

    const response = await POST(post(proposal.id, { approvalId: approval.id }), params(proposal.id));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.approval.decision).toBe("APPROVED");
    expect(scheduleEventDrain).toHaveBeenCalledTimes(1);
  });

  it("403 for OWNER", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await setupWithRequest(db);
    const { POST } = await importRouteWithSession(() => import("./route"), { db, session: ownerSession(organization.id, owner.id) });

    const response = await POST(post(proposal.id), params(proposal.id));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Somente o creator pode aprovar." });
  });

  it("404 for another creator of the same org", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, proposal } = await setupWithRequest(db);
    const otherCreator = await CreatorService.onboardCreator(db, organization.id, {
      email: `other-${Date.now()}@publyflow.test`,
      fullName: "Outro Creator",
      displayName: "Outro",
      instagramHandle: null,
    });
    await db.insert(organizationMembers).values({ organizationId: organization.id, userId: otherCreator.userId, role: "CREATOR" });
    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: creatorSession(organization.id, otherCreator.userId, otherCreator.id),
    });

    const response = await POST(post(proposal.id), params(proposal.id));
    expect(response.status).toBe(404);
  });

  it("409 when there is no pending approval", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, creator, proposal } = await seedProposal(db);
    await db.insert(organizationMembers).values({ organizationId: organization.id, userId: creator.userId, role: "CREATOR" });
    void owner;
    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: creatorSession(organization.id, creator.userId, creator.id),
    });

    const response = await POST(post(proposal.id, { approvalId: DUMMY_APPROVAL_ID }), params(proposal.id));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Não há pedido de aprovação pendente." });
  });

  it("409 when the proposal changed after the request", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, creator, proposal, approval } = await setupWithRequest(db);
    await ProposalService.update(db, organization.id, proposal.id, { title: "Campanha Verão 2", userId: owner.id });
    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: creatorSession(organization.id, creator.userId, creator.id),
    });

    const response = await POST(post(proposal.id, { approvalId: approval.id }), params(proposal.id));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "A proposta mudou depois do pedido de aprovação." });
  });

  it("409 when approvalId no longer names the latest request", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, creator, proposal, approval } = await setupWithRequest(db);
    await ProposalService.update(db, organization.id, proposal.id, { title: "Campanha Verão 2", userId: owner.id });
    await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: creatorSession(organization.id, creator.userId, creator.id),
    });

    const response = await POST(post(proposal.id, { approvalId: approval.id }), params(proposal.id));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "A proposta mudou depois do pedido de aprovação." });
  });

  it("400 when approvalId is missing or not a uuid", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, creator, proposal } = await setupWithRequest(db);
    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: creatorSession(organization.id, creator.userId, creator.id),
    });

    expect((await POST(post(proposal.id), params(proposal.id))).status).toBe(400);
    expect((await POST(post(proposal.id, { approvalId: "not-a-uuid" }), params(proposal.id))).status).toBe(400);
  });

  it("400 when the message is too long", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, creator, proposal, approval } = await setupWithRequest(db);
    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: creatorSession(organization.id, creator.userId, creator.id),
    });

    const response = await POST(post(proposal.id, { approvalId: approval.id, message: "a".repeat(2001) }), params(proposal.id));
    expect(response.status).toBe(400);
  });

  it("409 with a retry message on a Postgres deadlock (40P01)", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, creator, proposal, approval } = await setupWithRequest(db);
    const deadlock = Object.assign(new Error("deadlock detected"), { code: "40P01" });
    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: creatorSession(organization.id, creator.userId, creator.id),
      extraMocks: () => {
        vi.doMock("@/services/proposal-approval.service", () => ({
          ProposalApprovalService: { approve: vi.fn().mockRejectedValue(deadlock) },
        }));
      },
    });

    const response = await POST(post(proposal.id, { approvalId: approval.id }), params(proposal.id));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Não foi possível salvar agora. Tente novamente." });
  });
});
