// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

async function importProxy(user: { id: string } | null) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test");
  vi.doMock("@supabase/ssr", () => ({
    createServerClient: () => ({
      auth: { getUser: async () => ({ data: { user }, error: null }) },
    }),
  }));
  return import("./proxy");
}

describe("proxy", () => {
  it("redirects an unauthenticated page request to /login", async () => {
    const { proxy } = await importProxy(null);
    const response = await proxy(new NextRequest("http://localhost:3000/pipeline"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("lets an unauthenticated request to a public path through", async () => {
    const { proxy } = await importProxy(null);
    const response = await proxy(new NextRequest("http://localhost:3000/login"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("lets an authenticated page request through", async () => {
    const { proxy } = await importProxy({ id: "a" });
    const response = await proxy(new NextRequest("http://localhost:3000/pipeline"));
    expect(response.headers.get("location")).toBeNull();
  });
});
