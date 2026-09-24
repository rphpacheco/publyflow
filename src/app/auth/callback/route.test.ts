import { describe, it, expect, vi } from "vitest";

async function importCallback(options: {
  exchange: { data: { user: { id: string; email?: string } | null }; error: unknown };
  session: unknown;
  signOut?: ReturnType<typeof vi.fn>;
}) {
  const signOut = options.signOut ?? vi.fn(async () => ({ error: null }));
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
  const route = await import("./route");
  return { ...route, signOut };
}

describe("GET /auth/callback", () => {
  it("redirects to /pipeline when the user resolves to a session", async () => {
    const { GET } = await importCallback({
      exchange: { data: { user: { id: "a", email: "a@x.test" } }, error: null },
      session: { userId: "u", organizationId: "o", role: "OWNER" },
    });
    const response = await GET(new Request("http://localhost:3000/auth/callback?code=abc"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/pipeline");
  });

  it("signs out and redirects to /sem-acesso for an unprovisioned user", async () => {
    const { GET, signOut } = await importCallback({
      exchange: { data: { user: { id: "a", email: "a@x.test" } }, error: null },
      session: null,
    });
    const response = await GET(new Request("http://localhost:3000/auth/callback?code=abc"));
    expect(signOut).toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("http://localhost:3000/sem-acesso");
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
});
