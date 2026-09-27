import { describe, it, expect, afterEach, vi } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { ProposalService } from "@/services/proposal.service";

const scheduleEventDrain = vi.fn();
vi.mock("@/lib/events/schedule-drain", () => ({ scheduleEventDrain: () => scheduleEventDrain() }));

const post = (id: string) => new Request(`http://localhost/api/proposals/${id}/publications`, { method: "POST" });
const get = (id: string) => new Request(`http://localhost/api/proposals/${id}/publications`);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("/api/proposals/:id/publications", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => {
    scheduleEventDrain.mockClear();
    await cleanup?.();
  });

  it("POST publishes (201), repeats idempotently (200) and GET lists the history", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const { POST, GET } = await importRouteWithSession(() => import("./route"), { db, session: ownerSession(organization.id, owner.id) });

    const first = await POST(post(proposal.id), params(proposal.id));
    expect(first.status).toBe(201);
    const body = await first.json();
    expect(body.created).toBe(true);
    expect(body.publicPath).toMatch(/^\/p\//);
    expect(scheduleEventDrain).toHaveBeenCalledTimes(1);

    const again = await POST(post(proposal.id), params(proposal.id));
    expect(again.status).toBe(200);
    expect((await again.json()).created).toBe(false);
    expect(scheduleEventDrain).toHaveBeenCalledTimes(1);

    const history = await GET(get(proposal.id), params(proposal.id));
    expect(history.status).toBe(200);
    expect(await history.json()).toHaveLength(1);
  });

  it("POST 409 PROPOSAL_ARCHIVED for an archived proposal", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    await ProposalService.update(db, organization.id, proposal.id, { status: "ARCHIVED", userId: owner.id });
    const { POST } = await importRouteWithSession(() => import("./route"), { db, session: ownerSession(organization.id, owner.id) });

    const response = await POST(post(proposal.id), params(proposal.id));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("PROPOSAL_ARCHIVED");
  });

  it("404 for another organization's proposal and 401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const b = await seedProposal(db);
    const asB = await importRouteWithSession(() => import("./route"), { db, session: ownerSession(b.organization.id, b.owner.id) });
    expect((await asB.POST(post(a.proposal.id), params(a.proposal.id))).status).toBe(404);
    expect((await asB.GET(get(a.proposal.id), params(a.proposal.id))).status).toBe(404);

    const anonymous = await importRouteWithSession(() => import("./route"), { db, session: null });
    expect((await anonymous.POST(post(a.proposal.id), params(a.proposal.id))).status).toBe(401);
    expect((await anonymous.GET(get(a.proposal.id), params(a.proposal.id))).status).toBe(401);
  });
});
