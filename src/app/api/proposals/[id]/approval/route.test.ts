import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession, creatorSession } from "@/test/helpers/route";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { organizationMembers } from "@/db/schema/organizations";

const scheduleEventDrain = vi.fn();
vi.mock("@/lib/events/schedule-drain", () => ({ scheduleEventDrain: () => scheduleEventDrain() }));

const post = (id: string) => new Request(`http://localhost/api/proposals/${id}/approval`, { method: "POST" });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("/api/proposals/:id/approval", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => {
    scheduleEventDrain.mockClear();
    await cleanup?.();
  });

  it("POST 201 requests approval for OWNER, then 200 idempotently", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, creator, proposal } = await seedProposal(db);
    await db.insert(organizationMembers).values({ organizationId: organization.id, userId: creator.userId, role: "CREATOR" });
    const { POST } = await importRouteWithSession(() => import("./route"), { db, session: ownerSession(organization.id, owner.id) });

    const first = await POST(post(proposal.id), params(proposal.id));
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(firstBody.approval.requestNumber).toBe(1);
    expect(scheduleEventDrain).toHaveBeenCalledTimes(1);

    const again = await POST(post(proposal.id), params(proposal.id));
    expect(again.status).toBe(200);
    expect((await again.json()).approval.requestNumber).toBe(1);
    expect(scheduleEventDrain).toHaveBeenCalledTimes(1);
  });

  it("POST 403 for CREATOR session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, creator, proposal } = await seedProposal(db);
    await db.insert(organizationMembers).values({ organizationId: organization.id, userId: creator.userId, role: "CREATOR" });
    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: creatorSession(organization.id, creator.userId, creator.id),
    });

    const response = await POST(post(proposal.id), params(proposal.id));
    expect(response.status).toBe(403);
  });

  it("POST 409 when the creator has no PublyFlow access", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const { POST } = await importRouteWithSession(() => import("./route"), { db, session: ownerSession(organization.id, owner.id) });

    const response = await POST(post(proposal.id), params(proposal.id));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Este creator não tem acesso ao PublyFlow; envie direto." });
  });

  it("POST 404 for a malformed id", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner } = await seedProposal(db);
    const { POST } = await importRouteWithSession(() => import("./route"), { db, session: ownerSession(organization.id, owner.id) });

    const response = await POST(post("not-a-uuid"), params("not-a-uuid"));
    expect(response.status).toBe(404);
  });

  it("409 with a retry message when request hits a Postgres deadlock (40P01)", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const deadlock = Object.assign(new Error("deadlock detected"), { code: "40P01" });
    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
      extraMocks: () => {
        vi.doMock("@/services/proposal-approval.service", () => ({
          ProposalApprovalService: { request: vi.fn().mockRejectedValue(deadlock) },
        }));
      },
    });

    const response = await POST(post(proposal.id), params(proposal.id));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Não foi possível salvar agora. Tente novamente." });
  });
});
