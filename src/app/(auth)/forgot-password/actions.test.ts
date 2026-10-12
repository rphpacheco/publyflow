import { describe, it, expect, vi, beforeEach } from "vitest";

const { allowMock, sendMock, state } = vi.hoisted(() => ({
  allowMock: vi.fn(),
  sendMock: vi.fn(),
  state: { origin: "https://app.test" as string | null },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(state.origin ? { origin: state.origin } : {}),
}));
vi.mock("@/lib/auth/email-link-limit", () => ({ allowEmailLink: allowMock }));
vi.mock("@/lib/auth/request-password-link", () => ({ sendPasswordLink: sendMock }));

import { requestPasswordReset } from "./actions";

function form(email: string): FormData {
  const d = new FormData();
  d.set("email", email);
  return d;
}
const prev = { sent: false, error: null };

describe("requestPasswordReset", () => {
  beforeEach(() => {
    state.origin = "https://app.test";
    allowMock.mockReset().mockResolvedValue(true);
    sendMock.mockReset().mockResolvedValue(undefined);
  });

  it("rejects an invalid e-mail", async () => {
    expect(await requestPasswordReset(prev, form("nope"))).toEqual({ sent: false, error: "Informe um e-mail válido." });
    expect(await requestPasswordReset(prev, form(""))).toEqual({ sent: false, error: "Informe um e-mail válido." });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("reports rate limiting", async () => {
    allowMock.mockResolvedValue(false);
    expect(await requestPasswordReset(prev, form("a@b.com"))).toEqual({
      sent: false,
      error: "Muitas tentativas. Tente novamente em alguns minutos.",
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends the link and answers sent", async () => {
    expect(await requestPasswordReset(prev, form(" A@B.com "))).toEqual({ sent: true, error: null });
    expect(allowMock).toHaveBeenCalledWith("password-reset", "a@b.com", null);
    expect(sendMock).toHaveBeenCalledWith("a@b.com", "https://app.test");
  });

  it("still answers sent when sending fails", async () => {
    sendMock.mockResolvedValue(false);
    expect(await requestPasswordReset(prev, form("a@b.com"))).toEqual({ sent: true, error: null });
  });

  it("answers sent without sending when there is no origin", async () => {
    state.origin = null;
    expect(await requestPasswordReset(prev, form("a@b.com"))).toEqual({ sent: true, error: null });
    expect(sendMock).not.toHaveBeenCalled();
  });
});
