import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

async function importConfirm(options: {
  verify: { data: { user: { id: string; email?: string; email_confirmed_at?: string } | null }; error: unknown };
  session: unknown;
}) {
  const signOut = vi.fn(async () => ({ error: null }));
  const verifyOtp = vi.fn(async (_args: unknown) => options.verify);
  const exchangeCodeForSession = vi.fn(async (_code: string) => options.verify);
  const recordLoginMock = vi.fn(async () => undefined);
  vi.resetModules();
  vi.doMock("@/db", () => ({ db: {} }));
  vi.doMock("@/lib/supabase/server", () => ({
    createSupabaseServerClient: async () => ({ auth: { verifyOtp, exchangeCodeForSession, signOut } }),
  }));
  vi.doMock("@/lib/auth/resolve-session", () => ({
    resolveSessionForAuthUser: async () => options.session,
  }));
  vi.doMock("@/repositories/organization-members.repository", () => ({
    OrganizationMembersRepository: { recordLogin: recordLoginMock },
  }));
  const route = await import("./route");
  const grant = await import("@/lib/auth/password-reset-grant");
  return { ...route, grant, signOut, verifyOtp, exchangeCodeForSession, recordLoginMock };
}

const ok = {
  data: { user: { id: "a", email: "a@x.test", email_confirmed_at: "2026-01-01T00:00:00Z" } },
  error: null,
};
const session = { userId: "u", organizationId: "o", role: "OWNER" };
const EXPIRED = "http://localhost:3000/forgot-password?expired=1";

describe("GET /auth/confirm", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects to expired without token_hash or code", async () => {
    const { GET, verifyOtp } = await importConfirm({ verify: ok, session });
    const response = await GET(new Request("http://localhost:3000/auth/confirm?type=recovery"));
    expect(response.headers.get("location")).toBe(EXPIRED);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("rejects any type other than recovery without verifying", async () => {
    const { GET, verifyOtp } = await importConfirm({ verify: ok, session });
    const response = await GET(new Request("http://localhost:3000/auth/confirm?token_hash=h&type=magiclink"));
    expect(response.headers.get("location")).toBe(EXPIRED);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("redirects to expired when verifyOtp fails", async () => {
    const { GET, verifyOtp } = await importConfirm({
      verify: { data: { user: null }, error: { code: "otp_expired" } },
      session,
    });
    const response = await GET(new Request("http://localhost:3000/auth/confirm?token_hash=h&type=recovery"));
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "h", type: "recovery" });
    expect(response.headers.get("location")).toBe(EXPIRED);
  });

  it("signs out and goes to /sem-acesso without access, with no grant", async () => {
    const { GET, signOut, recordLoginMock } = await importConfirm({ verify: ok, session: null });
    const response = await GET(new Request("http://localhost:3000/auth/confirm?token_hash=h&type=recovery"));
    expect(signOut).toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("http://localhost:3000/sem-acesso");
    expect(response.headers.get("set-cookie") ?? "").not.toContain("pf_pw_reset");
    expect(recordLoginMock).not.toHaveBeenCalled();
  });

  it("sets the grant cookie for the member and goes to /reset-password", async () => {
    const { GET, grant, recordLoginMock } = await importConfirm({ verify: ok, session });
    const response = await GET(new Request("http://localhost:3000/auth/confirm?token_hash=h&type=recovery"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/reset-password");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("pf_pw_reset=");
    expect(cookie).toMatch(/httponly/i);
    const value = decodeURIComponent(cookie.match(/pf_pw_reset=([^;]+)/)![1]);
    expect(grant.verifyResetGrant(value, "u")).toBe(true);
    expect(recordLoginMock).toHaveBeenCalledWith(expect.anything(), "o", "u", expect.any(Date));
  });

  it("still redirects with the grant when recordLogin fails", async () => {
    const { GET, recordLoginMock } = await importConfirm({ verify: ok, session });
    recordLoginMock.mockRejectedValueOnce(new Error("db unavailable"));
    const response = await GET(new Request("http://localhost:3000/auth/confirm?token_hash=h&type=recovery"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/reset-password");
    expect(response.headers.get("set-cookie") ?? "").toContain("pf_pw_reset=");
  });

  it("exchanges a PKCE code, sets the grant for the member and goes to /reset-password", async () => {
    const { GET, grant, exchangeCodeForSession, verifyOtp, recordLoginMock } = await importConfirm({ verify: ok, session });
    const response = await GET(new Request("http://localhost:3000/auth/confirm?code=abc"));
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("http://localhost:3000/reset-password");
    const cookie = response.headers.get("set-cookie") ?? "";
    const value = decodeURIComponent(cookie.match(/pf_pw_reset=([^;]+)/)![1]);
    expect(grant.verifyResetGrant(value, "u")).toBe(true);
    expect(recordLoginMock).toHaveBeenCalled();
  });

  it("redirects to expired when the code exchange fails", async () => {
    const { GET } = await importConfirm({
      verify: { data: { user: null }, error: { code: "flow_state_not_found" } },
      session,
    });
    const response = await GET(new Request("http://localhost:3000/auth/confirm?code=abc"));
    expect(response.headers.get("location")).toBe(EXPIRED);
    expect(response.headers.get("set-cookie") ?? "").not.toContain("pf_pw_reset");
  });

  it("signs out and goes to /sem-acesso when the code user has no access", async () => {
    const { GET, signOut } = await importConfirm({ verify: ok, session: null });
    const response = await GET(new Request("http://localhost:3000/auth/confirm?code=abc"));
    expect(signOut).toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("http://localhost:3000/sem-acesso");
  });

  it("redirects Supabase error params to expired without verifying", async () => {
    const { GET, verifyOtp, exchangeCodeForSession } = await importConfirm({ verify: ok, session });
    const response = await GET(
      new Request("http://localhost:3000/auth/confirm?error=access_denied&error_code=otp_expired&error_description=x"),
    );
    expect(response.headers.get("location")).toBe(EXPIRED);
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
