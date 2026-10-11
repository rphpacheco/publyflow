import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { importRouteWithSession } from "@/test/helpers/route";
import { setupTeam, mockAuthAdmin } from "@/test/helpers/team";
import { organizationMembers } from "@/db/schema/organizations";

describe("DELETE /api/team/members/:id", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  const del = (id: string) => new Request(`http://localhost/api/team/members/${id}`, { method: "DELETE" });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  async function setup(who: "ownerSess" | "managerSess" | "creatorSess" | null) {
    const t = await setupTeam();
    cleanup = t.cleanup;
    const { DELETE } = await importRouteWithSession(() => import("./route"), {
      db: t.db,
      session: who ? t[who] : null,
      extraMocks: mockAuthAdmin,
    });
    return { t, DELETE };
  }

  it("401 without a session", async () => {
    const { t, DELETE } = await setup(null);
    expect((await DELETE(del(t.manager.id), ctx(t.manager.id))).status).toBe(401);
  });

  it("403 for MANAGER and CREATOR", async () => {
    for (const who of ["managerSess", "creatorSess"] as const) {
      await cleanup?.();
      const { t, DELETE } = await setup(who);
      const response = await DELETE(del(t.manager.id), ctx(t.manager.id));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Sem permissão." });
    }
  });

  it("404 for malformed id and for another organization's membership", async () => {
    const { t, DELETE } = await setup("ownerSess");
    for (const id of ["not-a-uuid", t.otherMembershipId]) {
      const response = await DELETE(del(id), ctx(id));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Membro não encontrado." });
    }
  });

  it("204 removes the member from the list", async () => {
    const { t, DELETE } = await setup("ownerSess");
    const response = await DELETE(del(t.manager.id), ctx(t.manager.id));
    expect(response.status).toBe(204);
    const { GET } = await importRouteWithSession(() => import("../../route"), { db: t.db, session: t.ownerSess, extraMocks: mockAuthAdmin });
    const list = await (await GET()).json();
    expect(list.map((m: { id: string }) => m.id)).not.toContain(t.manager.id);
  });

  it("409 CANNOT_REMOVE_OWNER (own membership, and another owner)", async () => {
    const { t, DELETE } = await setup("ownerSess");
    const { GET } = await importRouteWithSession(() => import("../../route"), { db: t.db, session: t.ownerSess, extraMocks: mockAuthAdmin });
    const ownerId = (await (await GET()).json()).find((m: { isSelf: boolean }) => m.isSelf).id;
    const { DELETE: del2 } = await importRouteWithSession(() => import("./route"), { db: t.db, session: t.ownerSess, extraMocks: mockAuthAdmin });
    const self = await del2(del(ownerId), ctx(ownerId));
    expect(self.status).toBe(409);
    expect(await self.json()).toEqual({ error: "Não é possível remover um proprietário.", code: "CANNOT_REMOVE_OWNER" });

    await t.db.update(organizationMembers).set({ role: "OWNER" }).where(eq(organizationMembers.id, t.manager.id));
    const owner = await DELETE(del(t.manager.id), ctx(t.manager.id));
    expect(owner.status).toBe(409);
    expect(await owner.json()).toEqual({ error: "Não é possível remover um proprietário.", code: "CANNOT_REMOVE_OWNER" });
  });
});
