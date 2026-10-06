import { describe, it, expect, vi } from "vitest";

class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`redirect:${url}`);
  }
}

async function importWithAuthState(getAuthState: () => Promise<unknown>) {
  vi.resetModules();
  vi.doMock("next/navigation", () => ({
    redirect: (url: string) => {
      throw new RedirectSignal(url);
    },
  }));
  vi.doMock("./session", () => ({ getAuthState }));
  return import("./require-app-session");
}

describe("requireAppSession", () => {
  it("returns ok with the session for a member", async () => {
    const session = { userId: "u1", organizationId: "o1", role: "OWNER", creatorId: null };
    const { requireAppSession } = await importWithAuthState(async () => ({ status: "member", session }));
    await expect(requireAppSession()).resolves.toEqual({ status: "ok", session });
  });

  it("sends a Supabase user without PublyFlow access to /sem-acesso (no sign-out)", async () => {
    const { requireAppSession } = await importWithAuthState(async () => ({
      status: "no-access",
      email: "stranger@x.test",
    }));
    await expect(requireAppSession()).rejects.toMatchObject({ url: "/sem-acesso" });
  });

  it("sends an anonymous visitor to /login", async () => {
    const { requireAppSession } = await importWithAuthState(async () => ({ status: "anonymous" }));
    await expect(requireAppSession()).rejects.toMatchObject({ url: "/login" });
  });

  it("returns unavailable when the auth provider is down", async () => {
    const { requireAppSession } = await importWithAuthState(async () => {
      // Same module instance require-app-session.ts sees (registry was reset).
      const { AuthUnavailableError } = await import("./errors");
      throw new AuthUnavailableError();
    });
    await expect(requireAppSession()).resolves.toEqual({ status: "unavailable" });
  });

  it("rethrows any other error", async () => {
    const boom = new Error("boom");
    const { requireAppSession } = await importWithAuthState(async () => {
      throw boom;
    });
    await expect(requireAppSession()).rejects.toBe(boom);
  });
});
