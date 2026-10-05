import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { creatorSession, importRouteWithSession, ownerSession } from "@/test/helpers/route";

describe("GET /api/dashboard/actions", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function call(session: "owner" | "creator" | "none") {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const s = await seedProposal(db);
    const value = session === "owner" ? ownerSession(s.organization.id, s.owner.id)
      : session === "creator" ? creatorSession(s.organization.id, s.owner.id, s.creator.id) : null;
    const { GET } = await importRouteWithSession(() => import("./route"), { db, session: value });
    return GET();
  }

  it("returns all seven action keys", async () => {
    const response = await call("owner");
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(Object.keys(json).sort()).toEqual([
      "awaitingClient", "awaitingCreatorApproval", "clientChangesRequested", "creatorChangesRequested",
      "readyToSend", "truncated", "untriagedInquiries",
    ]);
  });

  it("403 for CREATOR and 401 without session", async () => {
    expect((await call("creator")).status).toBe(403);
    expect((await call("none")).status).toBe(401);
  });
});
