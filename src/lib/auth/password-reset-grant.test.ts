import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RESET_GRANT_COOKIE,
  createResetGrant,
  resetGrantCookieOptions,
  verifyResetGrant,
} from "./password-reset-grant";

const NOW = 1_800_000_000_000;

describe("password reset grant", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("verifies for the same user within the window", () => {
    const token = createResetGrant("user-1", NOW);
    expect(verifyResetGrant(token, "user-1", NOW + 899_000)).toBe(true);
  });

  it("fails once expired", () => {
    const token = createResetGrant("user-1", NOW);
    expect(verifyResetGrant(token, "user-1", NOW + 900_001)).toBe(false);
  });

  it("fails for another user", () => {
    const token = createResetGrant("user-1", NOW);
    expect(verifyResetGrant(token, "user-2", NOW)).toBe(false);
  });

  it("fails if any character of payload or signature changes", () => {
    const token = createResetGrant("user-1", NOW);
    const [payload, signature] = token.split(".");
    const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
    for (let i = 0; i < payload.length; i++) {
      expect(verifyResetGrant(`${flip(payload, i)}.${signature}`, "user-1", NOW)).toBe(false);
    }
    for (let i = 0; i < signature.length; i++) {
      expect(verifyResetGrant(`${payload}.${flip(signature, i)}`, "user-1", NOW)).toBe(false);
    }
  });

  it("fails for malformed tokens", () => {
    for (const bad of [undefined, "", "a.b.c", "garbage", "."]) {
      expect(verifyResetGrant(bad, "user-1", NOW)).toBe(false);
    }
  });

  it("never verifies and cannot create without the key", () => {
    const token = createResetGrant("user-1", NOW);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(verifyResetGrant(token, "user-1", NOW)).toBe(false);
    expect(() => createResetGrant("user-1", NOW)).toThrow("password reset grant key unavailable");
  });

  it("exposes the cookie name and options", () => {
    expect(RESET_GRANT_COOKIE).toBe("pf_pw_reset");
    expect(resetGrantCookieOptions()).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 900,
      secure: false,
    });
  });
});
