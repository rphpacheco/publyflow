import { describe, it, expect, vi } from "vitest";

async function importSignout() {
  const signOut = vi.fn(async () => ({ error: null }));
  vi.resetModules();
  vi.doMock("@/lib/supabase/server", () => ({
    createSupabaseServerClient: async () => ({ auth: { signOut } }),
  }));
  const route = await import("./route");
  return { ...route, signOut };
}

describe("/auth/signout", () => {
  it("signs out and redirects to /login (POST, from the header)", async () => {
    const { POST, signOut } = await importSignout();
    const response = await POST(new Request("http://localhost:3000/auth/signout", { method: "POST" }));
    expect(signOut).toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("redirects to /sem-acesso when reason=no-access (GET, from the app layout)", async () => {
    const { GET } = await importSignout();
    const response = await GET(new Request("http://localhost:3000/auth/signout?reason=no-access"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/sem-acesso");
  });
});
