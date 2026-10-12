import { describe, it, expect, vi, beforeEach } from "vitest";

const { allowMock, sendMock, getUserMock, state } = vi.hoisted(() => ({
  allowMock: vi.fn(),
  sendMock: vi.fn(),
  getUserMock: vi.fn(),
  state: { origin: "https://app.test" as string | null },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(state.origin ? { origin: state.origin } : {}),
}));
vi.mock("@/lib/auth/email-link-limit", () => ({ allowEmailLink: allowMock }));
vi.mock("@/lib/auth/request-password-link", () => ({ sendPasswordLink: sendMock }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: getUserMock } }),
}));

import { requestPasswordChange } from "./account-actions";

const GENERIC = "Não foi possível enviar o link. Tente novamente.";

describe("requestPasswordChange", () => {
  beforeEach(() => {
    state.origin = "https://app.test";
    allowMock.mockReset().mockResolvedValue(true);
    sendMock.mockReset().mockResolvedValue(true);
    getUserMock.mockReset().mockResolvedValue({ data: { user: { email: "Ana@Brand.com" } } });
  });

  it("fails without a session user", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    expect(await requestPasswordChange()).toEqual({ ok: false, error: GENERIC });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("reports rate limiting", async () => {
    allowMock.mockResolvedValue(false);
    expect(await requestPasswordChange()).toEqual({
      ok: false,
      error: "Muitas tentativas. Tente novamente em alguns minutos.",
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("fails without an origin header", async () => {
    state.origin = null;
    expect(await requestPasswordChange()).toEqual({ ok: false, error: GENERIC });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("returns the generic error when sending fails", async () => {
    sendMock.mockResolvedValue(false);
    expect(await requestPasswordChange()).toEqual({ ok: false, error: GENERIC });
  });

  it("sends the link to the session e-mail", async () => {
    expect(await requestPasswordChange()).toEqual({ ok: true, email: "ana@brand.com" });
    expect(allowMock).toHaveBeenCalledWith("password-reset", "ana@brand.com", null);
    expect(sendMock).toHaveBeenCalledWith("ana@brand.com", "https://app.test");
  });
});
