import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { importRouteWithSession, ownerSession } from "@/test/helpers/route";
import { seedProposal } from "@/test/helpers/proposal-fixtures";

const get = (id: string) => new Request(`http://localhost/api/proposals/${id}/send-state`);
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/proposals/:id/send-state", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("returns the computed state", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const { organization, owner, proposal } = await seedProposal(db);
    const { GET } = await importRouteWithSession(() => import("./route"), { db, session: ownerSession(organization.id, owner.id) });

    const response = await GET(get(proposal.id), params(proposal.id));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "DRAFT",
      publicPath: null,
      latestPublication: null,
      latestVersionNumber: 1,
      hasUnsentChanges: true,
      canSend: true,
    });
  });

  it("404 for another organization and 401 without a session", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const a = await seedProposal(db);
    const b = await seedProposal(db);
    const asB = await importRouteWithSession(() => import("./route"), { db, session: ownerSession(b.organization.id, b.owner.id) });
    expect((await asB.GET(get(a.proposal.id), params(a.proposal.id))).status).toBe(404);
    const anonymous = await importRouteWithSession(() => import("./route"), { db, session: null });
    expect((await anonymous.GET(get(a.proposal.id), params(a.proposal.id))).status).toBe(401);
  });
});
