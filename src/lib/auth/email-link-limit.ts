import { db } from "@/db";
import { checkRateLimit } from "@/lib/rate-limit";

const WINDOW = { limit: 5, windowSeconds: 600 } as const;

/**
 * Shared limiter for the public "send me a link" forms (magic link, password reset): one bucket per
 * client IP and one per e-mail (the e-mail goes in the `ip` field, as `checkRateLimit` hashes it).
 */
export async function allowEmailLink(scope: "magic-link" | "password-reset", email: string, ip: string | null): Promise<boolean> {
  const byIp = await checkRateLimit(db, { scope: `${scope}:ip`, ip, ...WINDOW });
  const byEmail = await checkRateLimit(db, { scope: `${scope}:email`, ip: email, ...WINDOW });
  return byIp.allowed && byEmail.allowed;
}
