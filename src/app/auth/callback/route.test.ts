import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

async function importCallback(options: {
  exchange: { data: { user: { id: string; email?: string; email_confirmed_at?: string } | null }; error: unknown };
  session: unknown;
  signOut?: ReturnType<typeof vi.fn>;
}) {
  const signOut = options.signOut ?? vi.fn(async () => ({ error: null }));
  const recordLoginMock = vi.fn(async () => undefined);
  vi.resetModules();
  vi.doMock("@/db", () => ({ db: {} }));
  vi.doMock("@/lib/supabase/server", () => ({
    createSupabaseServerClient: async () => ({
      auth: { exchangeCodeForSession: async () => options.exchange, signOut },
    }),
  }));
  vi.doMock("@/lib/auth/resolve-session", () => ({
    resolveSessionForAuthUser: async () => options.session,
  }));
  vi.doMock("@/repositories/organization-members.repository", () => ({
    OrganizationMembersRepository: { recordLogin: recordLoginMock },
  }));
  const route = await import("./route");
  return { ...route, signOut, recordLoginMock };
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects to /pipeline when the user resolves to a session", async () => {
    const session = { userId: "u", organizationId: "o", role: "OWNER" };
    const { GET, recordLoginMock } = await importCallback({
      exchange: {
        data: { user: { id: "a", email: "a@x.test", email_confirmed_at: "2026-01-01T00:00:00Z" } },
        error: null,
      },
      session,
    });
    const response = await GET(new Request("http://localhost:3000/auth/callback?code=abc"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/pipeline");
    expect(recordLoginMock).toHaveBeenCalledWith(
      expect.anything(),
      session.organizationId,
      session.userId,
      expect.any(Date),
    );
  });

  it("signs out and redirects to /sem-acesso for an unprovisioned user", async () => {
    const { GET, signOut, recordLoginMock } = await importCallback({
      exchange: {
        data: { user: { id: "a", email: "a@x.test", email_confirmed_at: "2026-01-01T00:00:00Z" } },
        error: null,
      },
      session: null,
    });
    const response = await GET(new Request("http://localhost:3000/auth/callback?code=abc"));
    expect(signOut).toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("http://localhost:3000/sem-acesso");
    expect(recordLoginMock).not.toHaveBeenCalled();
  });

  it("still redirects to /pipeline when recordLogin fails (F2)", async () => {
    const session = { userId: "u", organizationId: "o", role: "OWNER" };
    const { GET, recordLoginMock } = await importCallback({
      exchange: {
        data: { user: { id: "a", email: "a@x.test", email_confirmed_at: "2026-01-01T00:00:00Z" } },
        error: null,
      },
      session,
    });
    recordLoginMock.mockRejectedValueOnce(new Error("db unavailable"));
    const response = await GET(new Request("http://localhost:3000/auth/callback?code=abc"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/pipeline");
    expect(recordLoginMock).toHaveBeenCalled();
  });

  it("redirects to /login?error=oauth without a code or when the exchange fails", async () => {
    const { GET } = await importCallback({
      exchange: { data: { user: null }, error: { message: "bad" } },
      session: null,
    });
    const noCode = await GET(new Request("http://localhost:3000/auth/callback"));
    expect(noCode.headers.get("location")).toBe("http://localhost:3000/login?error=oauth");
    const failed = await GET(new Request("http://localhost:3000/auth/callback?code=abc"));
    expect(failed.headers.get("location")).toBe("http://localhost:3000/login?error=oauth");
  });

  it("redirects to /sem-acesso when Supabase reports signup_disabled (no code)", async () => {
    const { GET } = await importCallback({ exchange: { data: { user: null }, error: null }, session: null });
    const byCode = await GET(
      new Request("http://localhost:3000/auth/callback?error=access_denied&error_code=signup_disabled"),
    );
    expect(byCode.headers.get("location")).toBe("http://localhost:3000/sem-acesso");
    const byDescription = await GET(
      new Request("http://localhost:3000/auth/callback?error=access_denied&error_description=Signups+not+allowed+for+this+instance"),
    );
    expect(byDescription.headers.get("location")).toBe("http://localhost:3000/sem-acesso");
  });

  it("keeps /login?error=oauth for any other error without a code", async () => {
    const { GET } = await importCallback({ exchange: { data: { user: null }, error: null }, session: null });
    const response = await GET(
      new Request("http://localhost:3000/auth/callback?error=access_denied&error_code=other&error_description=nope"),
    );
    expect(response.headers.get("location")).toBe("http://localhost:3000/login?error=oauth");
  });

  describe("password reset grant", () => {
    const exchange = {
      data: { user: { id: "a", email: "a@x.test", email_confirmed_at: "2026-01-01T00:00:00Z" } },
      error: null,
    };
    const session = { userId: "u", organizationId: "o", role: "OWNER" };

    it("sets the grant cookie and goes to /reset-password for next=reset", async () => {
      const { GET } = await importCallback({ exchange, session });
      const response = await GET(new Request("http://localhost:3000/auth/callback?code=abc&next=reset"));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("http://localhost:3000/reset-password");
      const cookie = response.headers.get("set-cookie") ?? "";
      expect(cookie).toContain("pf_pw_reset=");
      expect(cookie).toMatch(/httponly/i);
      expect(cookie).toMatch(/max-age=900/i);
      expect(cookie).toMatch(/path=\//i);
      expect(cookie).toMatch(/samesite=lax/i);
    });

    it("sets no grant without next", async () => {
      const { GET } = await importCallback({ exchange, session });
      const response = await GET(new Request("http://localhost:3000/auth/callback?code=abc"));
      expect(response.headers.get("location")).toBe("http://localhost:3000/pipeline");
      expect(response.headers.get("set-cookie") ?? "").not.toContain("pf_pw_reset");
    });

    it("ignores any other next value", async () => {
      const { GET } = await importCallback({ exchange, session });
      const response = await GET(new Request("http://localhost:3000/auth/callback?code=abc&next=/evil"));
      expect(response.headers.get("location")).toBe("http://localhost:3000/pipeline");
      expect(response.headers.get("set-cookie") ?? "").not.toContain("pf_pw_reset");
    });

    it("sets no grant when the user has no access", async () => {
      const { GET } = await importCallback({ exchange, session: null });
      const response = await GET(new Request("http://localhost:3000/auth/callback?code=abc&next=reset"));
      expect(response.headers.get("location")).toBe("http://localhost:3000/sem-acesso");
      expect(response.headers.get("set-cookie") ?? "").not.toContain("pf_pw_reset");
    });
  });
});
