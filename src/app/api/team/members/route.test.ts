import { describe, it, expect, afterEach } from "vitest";
import { importRouteWithSession } from "@/test/helpers/route";
import { setupTeam, mockAuthAdmin, ensureAuthUserMock } from "@/test/helpers/team";

describe("POST /api/team/members", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  const req = (body: unknown) =>
    new Request("http://localhost/api/team/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const valid = { fullName: "Bia Souza", email: "bia@publyflow.test" };

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
    const { POST } = await setup(null);
    expect((await POST(req(valid))).status).toBe(401);
  });

  it("403 for MANAGER and CREATOR", async () => {
    for (const who of ["managerSess", "creatorSess"] as const) {
      await cleanup?.();
      const { POST } = await setup(who);
      const response = await POST(req(valid));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Sem permissão." });
    }
  });

  it("400 with field errors for empty name, bad e-mail and bad JSON", async () => {
    const { POST } = await setup("ownerSess");
    const noName = await POST(req({ fullName: "  ", email: "bia@publyflow.test" }));
    expect(noName.status).toBe(400);
    expect(await noName.json()).toEqual({ errors: { fullName: ["Informe o nome."] } });
    const badMail = await POST(req({ fullName: "Bia", email: "nope" }));
    expect(badMail.status).toBe(400);
    expect(await badMail.json()).toEqual({ errors: { email: ["Informe um e-mail válido."] } });
    expect((await POST(req("not json"))).status).toBe(400);
  });

  it("200 for a padded e-mail (trimmed before validation)", async () => {
    const { POST } = await setup("ownerSess");
    const response = await POST(req({ fullName: "Ana Souza", email: "  ana2@publyflow.test  " }));
    expect(response.status).toBe(200);
    expect((await response.json()).member.email).toBe("ana2@publyflow.test");
  });

  it("200 returns the member (same as GET /api/team), loginUrl and message", async () => {
    const { t, POST } = await setup("ownerSess");
    const response = await POST(req(valid));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.loginUrl).toBe("http://localhost/login");
    expect(body.message).toBe(
      "Olá, Bia Souza! Você foi convidado(a) para a equipe da Org no PublyFlow. Acesse http://localhost/login e entre com Google ou com um link enviado para bia@publyflow.test.",
    );
    expect(ensureAuthUserMock).toHaveBeenCalledWith("bia@publyflow.test");
    const { GET } = await importRouteWithSession(() => import("../route"), { db: t.db, session: t.ownerSess, extraMocks: mockAuthAdmin });
    const list = await (await GET()).json();
    expect(list.find((m: { id: string }) => m.id === body.member.id)).toEqual(body.member);
  });

  it("409 with code for each conflict", async () => {
    const { POST } = await setup("ownerSess");
    const cases = [
      ["owner@publyflow.test", "ALREADY_IN_TEAM", "Essa pessoa já faz parte da equipe."],
      ["thais@publyflow.test", "IS_CREATOR", "Esse e-mail é de um creator desta organização."],
      ["outra@publyflow.test", "OTHER_ORGANIZATION", "Esse e-mail já tem acesso a outra organização."],
    ] as const;
    for (const [email, code, error] of cases) {
      const response = await POST(req({ fullName: "Fulano", email }));
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error, code });
    }
  });

  it("502 when provisioning fails", async () => {
    const { POST } = await setup("ownerSess");
    ensureAuthUserMock.mockImplementationOnce(async () => {
      const { AuthProvisioningError } = await import("@/lib/auth/errors");
      throw new AuthProvisioningError("x");
    });
    const response = await POST(req(valid));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "Não foi possível liberar o acesso agora. Tente novamente.",
      code: "AUTH_PROVISIONING_FAILED",
    });
  });
});
