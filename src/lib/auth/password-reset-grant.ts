import { createHmac, timingSafeEqual } from "node:crypto";

export const RESET_GRANT_COOKIE = "pf_pw_reset";
export const RESET_GRANT_MAX_AGE_SECONDS = 900;

// Proves the holder opened a password e-mail link for this user within the
// last 15 minutes (spec D3/D4). Server-only: never import from "use client".
function grantKey(): Buffer | null {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  return createHmac("sha256", secret).update("password-reset-v1").digest();
}

const b64 = (value: string | Buffer) => Buffer.from(value).toString("base64url");

export function resetGrantCookieOptions() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/" as const,
    maxAge: RESET_GRANT_MAX_AGE_SECONDS,
  };
}

export function createResetGrant(userId: string, now = Date.now()): string {
  const key = grantKey();
  if (!key) throw new Error("password reset grant key unavailable");
  const payload = b64(`${userId}.${now + RESET_GRANT_MAX_AGE_SECONDS * 1000}`);
  const signature = b64(createHmac("sha256", key).update(payload).digest());
  return `${payload}.${signature}`;
}

export function verifyResetGrant(token: string | undefined, userId: string, now = Date.now()): boolean {
  const key = grantKey();
  if (!key || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  const expected = Buffer.from(createHmac("sha256", key).update(payload).digest());
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  const decoded = Buffer.from(payload, "base64url").toString("utf8");
  const dot = decoded.lastIndexOf(".");
  if (dot <= 0) return false;
  const tokenUser = decoded.slice(0, dot);
  const expiresAt = Number(decoded.slice(dot + 1));
  return tokenUser === userId && Number.isFinite(expiresAt) && now <= expiresAt;
}
