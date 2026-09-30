import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession, creatorSession } from "@/test/helpers/route";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { organizationMembers } from "@/db/schema/organizations";
import { ProposalApprovalService } from "@/services/proposal-approval.service";

const scheduleEventDrain = vi.fn();
vi.mock("@/lib/events/schedule-drain", () => ({ scheduleEventDrain: () => scheduleEventDrain() }));

const post = (id: string, body?: unknown) =>
  new Request(`http://localhost/api/proposals/${id}/approval/request-changes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function setupWithRequest(db: Awaited<ReturnType<typeof withTestDb>>["db"]) {
  const { organization, owner, creator, proposal } = await seedProposal(db);
  await db.insert(organizationMembers).values({ organizationId: organization.id, userId: creator.userId, role: "CREATOR" });
  await ProposalApprovalService.request(db, organization.id, proposal.id, owner.id);
  return { organization, owner, creator, proposal };
}

describe("/api/proposals/:id/approval/request-changes", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => {
    scheduleEventDrain.mockClear();
    await cleanup?.();
  });

  it("200 records the requested changes for the owning creator", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, creator, proposal } = await setupWithRequest(db);
    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: creatorSession(organization.id, creator.userId, creator.id),
    });

    const response = await POST(post(proposal.id, { message: "Trocar capa" }), params(proposal.id));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.approval.decision).toBe("CHANGES_REQUESTED");
    expect(body.approval.message).toBe("Trocar capa");
    expect(scheduleEventDrain).toHaveBeenCalledTimes(1);
  });

  it("400 when the message is blank", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, creator, proposal } = await setupWithRequest(db);
    const { POST } = await importRouteWithSession(() => import("./route"), {
      db,
      session: creatorSession(organization.id, creator.userId, creator.id),
    });

    const response = await POST(post(proposal.id, { message: "   " }), params(proposal.id));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ errors: { message: ["Descreva os ajustes."] } });
  });

  it("403 for OWNER", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await setupWithRequest(db);
    const { POST } = await importRouteWithSession(() => import("./route"), { db, session: ownerSession(organization.id, owner.id) });

    const response = await POST(post(proposal.id, { message: "Trocar capa" }), params(proposal.id));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Somente o creator pode aprovar." });
  });
});
