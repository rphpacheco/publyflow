import { describe, it, expect, afterEach } from "vitest";
import { importRouteWithSession } from "@/test/helpers/route";
import { setupTeam, mockAuthAdmin } from "@/test/helpers/team";

describe("GET /api/team", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  const load = (db: Parameters<typeof importRouteWithSession>[1]["db"], session: Parameters<typeof importRouteWithSession>[1]["session"]) =>
    importRouteWithSession(() => import("./route"), { db, session, extraMocks: mockAuthAdmin });

  it("401 without a session", async () => {
    const t = await setupTeam();
    cleanup = t.cleanup;
    const { GET } = await load(t.db, null);
    expect((await GET()).status).toBe(401);
  });

  it("403 for CREATOR", async () => {
    const t = await setupTeam();
    cleanup = t.cleanup;
    const { GET } = await load(t.db, t.creatorSess);
    const response = await GET();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Sem permissão." });
  });

  it("200 for MANAGER and OWNER, owner first, no creators, isSelf from the session", async () => {
    const t = await setupTeam();
    cleanup = t.cleanup;
    const asManager = await (await (await load(t.db, t.managerSess)).GET()).json();
    expect(asManager.map((m: { role: string }) => m.role)).toEqual(["OWNER", "MANAGER"]);
    expect(asManager.map((m: { isSelf: boolean }) => m.isSelf)).toEqual([false, true]);

    const response = await (await load(t.db, t.ownerSess)).GET();
    expect(response.status).toBe(200);
    const asOwner = await response.json();
    expect(asOwner.map((m: { isSelf: boolean }) => m.isSelf)).toEqual([true, false]);
    expect(asOwner.some((m: { email: string }) => m.email === "thais@publyflow.test")).toBe(false);
    expect(asOwner[1]).toEqual(t.manager);
  });
});
