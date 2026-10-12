import { describe, it, expect, vi, beforeEach } from "vitest";

const { store, authState, updateUser, redirectSignal } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  authState: { value: null as unknown },
  updateUser: vi.fn(),
  redirectSignal: class RedirectSignal extends Error {
    constructor(public url: string) {
      super("NEXT_REDIRECT");
    }
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
    delete: (name: string) => {
      store.delete(name);
    },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new redirectSignal(url);
  },
}));
vi.mock("@/lib/auth/session", () => ({
  getAuthState: async () => {
    if (authState.value instanceof Error) throw authState.value;
    return authState.value;
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { updateUser } }),
}));

import { setNewPassword } from "./actions";
import { hasValidResetGrant } from "./grant-check";
import { AuthUnavailableError } from "@/lib/auth/errors";
import { RESET_GRANT_COOKIE, createResetGrant } from "@/lib/auth/password-reset-grant";

const prev = { error: null, fieldErrors: {} };
import { RESET_EXPIRED_MESSAGE as EXPIRED } from "./messages";

function form(password: string, confirm = password): FormData {
  const d = new FormData();
  d.set("password", password);
  d.set("confirm", confirm);
  return d;
}
function member(userId = "u1") {
  authState.value = { status: "member", session: { userId } };
}

describe("setNewPassword", () => {
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
    store.clear();
    updateUser.mockReset().mockResolvedValue({ error: null });
    member();
    store.set(RESET_GRANT_COOKIE, createResetGrant("u1"));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("hasValidResetGrant reports unavailable on provider outage", async () => {
    authState.value = new AuthUnavailableError();
    expect(await hasValidResetGrant()).toBe("unavailable");
  });

  it("rejects without a grant", async () => {
    store.clear();
    expect(await setNewPassword(prev, form("12345678"))).toEqual({ error: EXPIRED, fieldErrors: {}, code: "expired" });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("rejects another user's grant", async () => {
    store.set(RESET_GRANT_COOKIE, createResetGrant("someone-else"));
    expect((await setNewPassword(prev, form("12345678"))).error).toBe(EXPIRED);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("rejects a non-member", async () => {
    authState.value = { status: "anonymous" };
    expect((await setNewPassword(prev, form("12345678"))).error).toBe(EXPIRED);
    authState.value = { status: "no-access", email: "a@b.com" };
    expect((await setNewPassword(prev, form("12345678"))).error).toBe(EXPIRED);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("validates the length", async () => {
    const msg = { error: null, fieldErrors: { password: "A senha precisa ter entre 8 e 72 caracteres." } };
    expect(await setNewPassword(prev, form("1234567"))).toEqual(msg);
    expect(await setNewPassword(prev, form("a".repeat(73)))).toEqual(msg);
    expect(await setNewPassword(prev, form("ã".repeat(40)))).toEqual(msg); // 40 chars, 80 bytes
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("accepts 72 ASCII characters", async () => {
    await expect(setNewPassword(prev, form("a".repeat(72)))).rejects.toMatchObject({ url: "/pipeline?senha=ok" });
  });

  it.each(["reauthentication_needed", "reauth_nonce_missing"])("maps %s to a new-link prompt", async (code) => {
    updateUser.mockResolvedValue({ error: { code, message: "raw" } });
    expect(await setNewPassword(prev, form("12345678"))).toEqual({
      error: "Por segurança, peça um novo link.",
      fieldErrors: {},
      code: "expired",
    });
  });

  it("validates the confirmation", async () => {
    expect(await setNewPassword(prev, form("12345678", "123456789"))).toEqual({
      error: null,
      fieldErrors: { confirm: "As senhas não conferem." },
    });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it.each([
    ["same_password", "A nova senha precisa ser diferente da atual."],
    ["weak_password", "Senha fraca. Use pelo menos 8 caracteres, misturando letras e números."],
    ["other", "Não foi possível salvar a senha. Tente novamente."],
  ])("maps %s", async (code, message) => {
    updateUser.mockResolvedValue({ error: { code, message: "raw" } });
    expect(await setNewPassword(prev, form("12345678"))).toEqual({ error: message, fieldErrors: {} });
    expect(store.has(RESET_GRANT_COOKIE)).toBe(true);
  });

  it("updates, consumes the grant and redirects; a second call is expired", async () => {
    await expect(setNewPassword(prev, form("12345678"))).rejects.toMatchObject({ url: "/pipeline?senha=ok" });
    expect(updateUser).toHaveBeenCalledWith({ password: "12345678" });
    expect(store.has(RESET_GRANT_COOKIE)).toBe(false);
    expect((await setNewPassword(prev, form("12345678"))).error).toBe(EXPIRED);
    expect(updateUser).toHaveBeenCalledTimes(1);
  });
});
