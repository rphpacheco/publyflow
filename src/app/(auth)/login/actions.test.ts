import { describe, it, expect, vi } from "vitest";

class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`redirect:${url}`);
  }
}

const signInWithOtpMock = vi.fn(async (): Promise<{ error: { code?: string } | null }> => ({ error: null }));
const checkRateLimitMock = vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 }));

async function importActions(options: {
  signIn?: { data: { user: { id: string; email?: string; email_confirmed_at?: string } | null }; error: unknown };
  session?: unknown;
}) {
  const signOut = vi.fn(async () => ({ error: null }));
  const recordLoginMock = vi.fn(async () => undefined);
  vi.resetModules();
  signInWithOtpMock.mockReset().mockResolvedValue({ error: null });
  checkRateLimitMock.mockReset().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
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
      auth: {
        signInWithPassword: async () => options.signIn,
        signOut,
        signInWithOtp: signInWithOtpMock,
      },
    }),
  }));
  vi.doMock("@/lib/auth/resolve-session", () => ({
    resolveSessionForAuthUser: async () => options.session,
  }));
  vi.doMock("@/repositories/organization-members.repository", () => ({
    OrganizationMembersRepository: { recordLogin: recordLoginMock },
  }));
  vi.doMock("@/lib/rate-limit", () => ({
    checkRateLimit: checkRateLimitMock,
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

  it("still redirects to /pipeline when recordLogin fails (F2)", async () => {
    const session = { userId: "u", organizationId: "o", role: "OWNER" };
    const { loginWithPassword, recordLoginMock } = await importActions({
      signIn: {
        data: { user: { id: "a", email: "a@x.test", email_confirmed_at: "2026-01-01T00:00:00Z" } },
        error: null,
      },
      session,
    });
    recordLoginMock.mockRejectedValueOnce(new Error("db unavailable"));
    await expect(loginWithPassword({ error: null }, form("a@x.test", "secret"))).rejects.toMatchObject({
      url: "/pipeline",
    });
    expect(recordLoginMock).toHaveBeenCalled();
  });
});

describe("sendMagicLink", () => {
  it("sends a magic link to /auth/callback and always answers sent", async () => {
    const { sendMagicLink } = await importActions({});
    const form = new FormData();
    form.set("email", " Thais@Example.com ");
    expect(await sendMagicLink({ sent: false, error: null }, form)).toEqual({ sent: true, error: null });
    expect(signInWithOtpMock).toHaveBeenCalledWith({
      email: "thais@example.com",
      options: { emailRedirectTo: "http://localhost:3000/auth/callback", shouldCreateUser: true },
    });
  });

  it("still answers sent when Supabase refuses", async () => {
    const { sendMagicLink } = await importActions({});
    signInWithOtpMock.mockResolvedValueOnce({ error: { code: "over_email_send_rate_limit" } });
    const form = new FormData();
    form.set("email", "thais@example.com");
    expect(await sendMagicLink({ sent: false, error: null }, form)).toEqual({ sent: true, error: null });
  });

  it("checks both the IP and the e-mail limits, and refuses when either is exceeded", async () => {
    const { sendMagicLink } = await importActions({});
    const form = new FormData();
    form.set("email", "thais@example.com");
    await sendMagicLink({ sent: false, error: null }, form);
    expect(checkRateLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scope: "magic-link:ip", limit: 5, windowSeconds: 600 }),
    );
    expect(checkRateLimitMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scope: "magic-link:email", ip: "thais@example.com", limit: 5, windowSeconds: 600 }),
    );

    checkRateLimitMock
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0 })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 60 });
    expect(await sendMagicLink({ sent: false, error: null }, form)).toEqual({
      sent: false,
      error: "Muitas tentativas. Tente novamente em alguns minutos.",
    });
    expect(signInWithOtpMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty e-mail", async () => {
    const { sendMagicLink } = await importActions({});
    expect(await sendMagicLink({ sent: false, error: null }, new FormData())).toEqual({
      sent: false,
      error: "Informe seu e-mail.",
    });
  });

  it("rejects an invalid e-mail format before checking the rate limit (F3)", async () => {
    const { sendMagicLink } = await importActions({});
    const form = new FormData();
    form.set("email", "not-an-email");
    expect(await sendMagicLink({ sent: false, error: null }, form)).toEqual({
      sent: false,
      error: "Informe um e-mail válido.",
    });
    expect(checkRateLimitMock).not.toHaveBeenCalled();
    expect(signInWithOtpMock).not.toHaveBeenCalled();
  });

  it("refuses when only the IP limit trips (F4)", async () => {
    const { sendMagicLink } = await importActions({});
    checkRateLimitMock.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 60 });
    const form = new FormData();
    form.set("email", "thais@example.com");
    expect(await sendMagicLink({ sent: false, error: null }, form)).toEqual({
      sent: false,
      error: "Muitas tentativas. Tente novamente em alguns minutos.",
    });
    expect(signInWithOtpMock).not.toHaveBeenCalled();
  });
});
