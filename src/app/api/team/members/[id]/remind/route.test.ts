import { describe, it, expect, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { importRouteWithSession } from "@/test/helpers/route";
import { setupTeam, mockAuthAdmin, ensureAuthUserMock } from "@/test/helpers/team";
import { organizationMembers } from "@/db/schema/organizations";

describe("POST /api/team/members/:id/remind", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  const post = (id: string) => new Request(`http://localhost/api/team/members/${id}/remind`, { method: "POST" });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  async function setup(who: "ownerSess" | "managerSess" | "creatorSess" | null) {
    const t = await setupTeam();
    cleanup = t.cleanup;
    const { POST } = await importRouteWithSession(() => import("./route"), {
      db: t.db,
      session: who ? t[who] : null,
      extraMocks: mockAuthAdmin,
    });
    return { t, POST };
  }

  it("401 without a session", async () => {
    const { t, POST } = await setup(null);
    expect((await POST(post(t.manager.id), ctx(t.manager.id))).status).toBe(401);
  });

  it("403 for MANAGER and CREATOR", async () => {
    for (const who of ["managerSess", "creatorSess"] as const) {
      await cleanup?.();
      const { t, POST } = await setup(who);
      const response = await POST(post(t.manager.id), ctx(t.manager.id));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Sem permissão." });
    }
  });

  it("404 for malformed id and for another organization's membership", async () => {
    const { t, POST } = await setup("ownerSess");
    for (const id of ["not-a-uuid", t.otherMembershipId]) {
      const response = await POST(post(id), ctx(id));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Membro não encontrado." });
    }
  });

  it("200 returns loginUrl and message", async () => {
    const { t, POST } = await setup("ownerSess");
    const response = await POST(post(t.manager.id), ctx(t.manager.id));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      loginUrl: "http://localhost/login",
      message:
        "Olá, Ana Lima! Você foi convidado(a) para a equipe da Org no PublyFlow. Acesse http://localhost/login e entre com Google ou com um link enviado para ana@publyflow.test.",
    });
    expect(ensureAuthUserMock).toHaveBeenCalledWith("ana@publyflow.test");
  });

  it("409 NOT_A_MANAGER for an owner", async () => {
    const { t, POST } = await setup("ownerSess");
    await t.db.update(organizationMembers).set({ role: "OWNER" }).where(eq(organizationMembers.id, t.manager.id));
    const response = await POST(post(t.manager.id), ctx(t.manager.id));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Só é possível reenviar o acesso de um gestor.", code: "NOT_A_MANAGER" });
  });

  it("502 when provisioning fails", async () => {
    const { t, POST } = await setup("ownerSess");
    ensureAuthUserMock.mockImplementationOnce(async () => {
      const { AuthProvisioningError } = await import("@/lib/auth/errors");
      throw new AuthProvisioningError("x");
    });
    const response = await POST(post(t.manager.id), ctx(t.manager.id));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "Não foi possível liberar o acesso agora. Tente novamente.",
      code: "AUTH_PROVISIONING_FAILED",
    });
  });
});
