import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { creatorSession, importRouteWithSession, ownerSession } from "@/test/helpers/route";

describe("GET /api/dashboard/metrics", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function call(session: "owner" | "creator" | "none", query: string) {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const s = await seedProposal(db);
    const value = session === "owner" ? ownerSession(s.organization.id, s.owner.id)
      : session === "creator" ? creatorSession(s.organization.id, s.owner.id, s.creator.id) : null;
    const { GET } = await importRouteWithSession(() => import("./route"), { db, session: value });
    return GET(new Request(`http://localhost/api/dashboard/metrics${query}`));
  }

  it("returns the metrics shape", async () => {
    const response = await call("owner", "?from=2026-10-01&to=2026-10-31");
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.period).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(json.previousPeriod).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(json.series.bucket).toBe("day");
    expect(json.series.points).toHaveLength(31);
    expect(Array.isArray(json.creators)).toBe(true);
  });

  it("400 with Portuguese messages", async () => {
    const missing = await call("owner", "?to=2026-10-31");
    expect(missing.status).toBe(400);
    expect((await missing.json()).errors.from).toEqual(["Informe a data inicial."]);
    const reversed = await call("owner", "?from=2026-10-31&to=2026-10-01");
    expect((await reversed.json()).errors.to).toEqual(["A data final deve ser igual ou posterior à inicial."]);
  });

  it("403 for CREATOR and 401 without session", async () => {
    expect((await call("creator", "?from=2026-10-01&to=2026-10-31")).status).toBe(403);
    expect((await call("none", "?from=2026-10-01&to=2026-10-31")).status).toBe(401);
  });
});
