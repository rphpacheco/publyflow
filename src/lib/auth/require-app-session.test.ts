import { describe, it, expect, vi } from "vitest";

class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`redirect:${url}`);
  }
}

async function importWithSession(session: unknown) {
  vi.resetModules();
  vi.doMock("next/navigation", () => ({
    redirect: (url: string) => {
      throw new RedirectSignal(url);
    },
  }));
  vi.doMock("./session", () => ({ getSession: async () => session }));
  return import("./require-app-session");
}

describe("requireAppSession", () => {
  it("returns the session when there is one", async () => {
    const session = { userId: "u1", organizationId: "o1", role: "OWNER" };
    const { requireAppSession } = await importWithSession(session);
    await expect(requireAppSession()).resolves.toEqual(session);
  });

  it("sends an authenticated user without PublyFlow access to the no-access sign-out", async () => {
    const { requireAppSession } = await importWithSession(null);
    await expect(requireAppSession()).rejects.toMatchObject({ url: "/auth/signout?reason=no-access" });
  });
});
