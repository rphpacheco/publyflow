// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const signOut = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { signOut } }),
}));

import { GET, POST } from "./route";

describe("/auth/signout", () => {
  beforeEach(() => signOut.mockClear());

  it("POST signs out and redirects to /login with 303", async () => {
    const res = await POST(new Request("http://localhost:3000/auth/signout", { method: "POST" }));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("pf_pw_reset=;");
    expect(cookie).toMatch(/max-age=0/i);
    expect(cookie).toMatch(/path=\//i);
  });

  it("GET is 405 with Allow: POST and does not sign out", () => {
    const res = GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
    expect(signOut).not.toHaveBeenCalled();
  });
});
