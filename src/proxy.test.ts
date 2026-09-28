// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const checkRateLimit = vi.fn();

async function importProxy(user: { id: string } | null) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test");
  vi.doMock("@supabase/ssr", () => ({
    createServerClient: () => ({
      auth: { getUser: async () => ({ data: { user }, error: null }) },
    }),
  }));
  vi.doMock("@/db", () => ({ db: {} }));
  vi.doMock("@/lib/rate-limit", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
    checkRateLimit: (...args: unknown[]) => checkRateLimit(...args),
  }));
  return import("./proxy");
}

describe("proxy", () => {
  beforeEach(() => {
    checkRateLimit.mockReset();
    checkRateLimit.mockResolvedValue({ allowed: true, retryAfterSeconds: 0 });
  });

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

  it("rate-limits the public proposal page per IP with 429 and Retry-After", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 42 });
    const { proxy } = await importProxy(null);
    const response = await proxy(
      new NextRequest("http://localhost:3000/p/abc", { headers: { "x-real-ip": "203.0.113.7" } }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toBe("Muitas requisições. Aguarde um minuto e recarregue a página.");
    expect(checkRateLimit).toHaveBeenCalledWith(
      {},
      { scope: "public-page", limit: 60, windowSeconds: 60, ip: "203.0.113.7" },
    );
  });

  it("lets the public page through when under the limit", async () => {
    const { proxy } = await importProxy(null);
    const response = await proxy(new NextRequest("http://localhost:3000/p/abc"));
    expect(response.status).toBe(200);
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
  });

  it("never rate-limits other paths", async () => {
    const { proxy } = await importProxy({ id: "a" });
    await proxy(new NextRequest("http://localhost:3000/pipeline"));
    await proxy(new NextRequest("http://localhost:3000/login"));
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});
