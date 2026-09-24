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
  const actions = await import("./actions");
  return { ...actions, signOut };
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
    const { loginWithPassword } = await importActions({
      signIn: {
        data: { user: { id: "a", email: "a@x.test", email_confirmed_at: "2026-01-01T00:00:00Z" } },
        error: null,
      },
      session: { userId: "u", organizationId: "o", role: "OWNER" },
    });
    await expect(loginWithPassword({ error: null }, form("a@x.test", "secret"))).rejects.toMatchObject({
      url: "/pipeline",
    });
  });

  it("signs out and redirects to /sem-acesso for an unprovisioned user", async () => {
    const { loginWithPassword, signOut } = await importActions({
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
  });
});
