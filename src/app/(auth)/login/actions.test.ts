import { describe, it, expect, vi } from "vitest";

class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`redirect:${url}`);
  }
}

async function importActions(options: {
  signIn: { data: { user: { id: string; email?: string; email_confirmed_at?: string } | null }; error: unknown };
  session: unknown;
}) {
  const signOut = vi.fn(async () => ({ error: null }));
  const recordLoginMock = vi.fn(async () => undefined);
  vi.resetModules();
  vi.doMock("@/db", () => ({ db: {} }));
  vi.doMock("next/navigation", () => ({
    redirect: (url: string) => {
      throw new RedirectSignal(url);
    },
  }));
  vi.doMock("next/headers", () => ({
    headers: async () => new Headers({ origin: "http://localhost:3000" }),
  }));
  vi.doMock("@/lib/supabase/server", () => ({
    createSupabaseServerClient: async () => ({
      auth: { signInWithPassword: async () => options.signIn, signOut },
    }),
  }));
  vi.doMock("@/lib/auth/resolve-session", () => ({
    resolveSessionForAuthUser: async () => options.session,
  }));
  vi.doMock("@/repositories/organization-members.repository", () => ({
    OrganizationMembersRepository: { recordLogin: recordLoginMock },
  }));
  const actions = await import("./actions");
  return { ...actions, signOut, recordLoginMock };
}

function form(email: string, password: string): FormData {
  const data = new FormData();
  data.set("email", email);
  data.set("password", password);
  return data;
}

describe("loginWithPassword", () => {
  it("asks for both fields when one is missing", async () => {
    const { loginWithPassword } = await importActions({ signIn: { data: { user: null }, error: null }, session: null });
    expect(await loginWithPassword({ error: null }, form("", ""))).toEqual({ error: "Informe e-mail e senha." });
  });

  it("returns an error for invalid credentials", async () => {
    const { loginWithPassword } = await importActions({
      signIn: { data: { user: null }, error: { message: "Invalid login credentials" } },
      session: null,
    });
    expect(await loginWithPassword({ error: null }, form("a@x.test", "wrong"))).toEqual({
      error: "E-mail ou senha inválidos.",
    });
  });

  it("redirects to /pipeline for a provisioned user", async () => {
    const session = { userId: "u", organizationId: "o", role: "OWNER" };
    const { loginWithPassword, recordLoginMock } = await importActions({
      signIn: {
        data: { user: { id: "a", email: "a@x.test", email_confirmed_at: "2026-01-01T00:00:00Z" } },
        error: null,
      },
      session,
    });
    await expect(loginWithPassword({ error: null }, form("a@x.test", "secret"))).rejects.toMatchObject({
      url: "/pipeline",
    });
    expect(recordLoginMock).toHaveBeenCalledWith(
      expect.anything(),
      session.organizationId,
      session.userId,
      expect.any(Date),
    );
  });

  it("signs out and redirects to /sem-acesso for an unprovisioned user", async () => {
    const { loginWithPassword, signOut, recordLoginMock } = await importActions({
      signIn: {
        data: { user: { id: "a", email: "a@x.test", email_confirmed_at: "2026-01-01T00:00:00Z" } },
        error: null,
      },
      session: null,
    });
    await expect(loginWithPassword({ error: null }, form("a@x.test", "secret"))).rejects.toMatchObject({
      url: "/sem-acesso",
    });
    expect(signOut).toHaveBeenCalled();
    expect(recordLoginMock).not.toHaveBeenCalled();
  });
});
