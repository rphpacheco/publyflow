import { describe, it, expect, vi, beforeEach } from "vitest";

const { resetMock } = vi.hoisted(() => ({ resetMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { resetPasswordForEmail: resetMock } }),
}));

import { sendPasswordLink } from "./request-password-link";

describe("sendPasswordLink", () => {
  beforeEach(() => {
    resetMock.mockReset().mockResolvedValue({ error: null });
  });

  it("asks Supabase for a link redirecting to the callback with next=reset", async () => {
    expect(await sendPasswordLink("a@b.com", "https://app.test")).toBe(true);
    expect(resetMock).toHaveBeenCalledWith("a@b.com", { redirectTo: "https://app.test/auth/callback?next=reset" });
  });

  it("returns false, logs the error code and does not throw", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    resetMock.mockResolvedValue({ error: { code: "over_email_send_rate_limit" } });
    await expect(sendPasswordLink("a@b.com", "https://app.test")).resolves.toBe(false);
    expect(spy).toHaveBeenCalledWith("Password link request failed", "over_email_send_rate_limit");
    spy.mockRestore();
  });

  it("returns false and logs only the error name when the call throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    resetMock.mockImplementation(async () => {
      throw new TypeError("secret detail");
    });
    await expect(sendPasswordLink("a@b.com", "https://app.test")).resolves.toBe(false);
    expect(spy).toHaveBeenCalledWith("Password link request threw", "TypeError");
    spy.mockRestore();
  });
});
