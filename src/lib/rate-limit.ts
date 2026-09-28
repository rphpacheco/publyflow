import { createHash } from "node:crypto";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { RateLimitRepository } from "@/repositories/rate-limit.repository";

export const PUBLIC_RESPONSE_LIMIT = { scope: "public-response", limit: 10, windowSeconds: 600 } as const;
export const PUBLIC_PAGE_LIMIT = { scope: "public-page", limit: 60, windowSeconds: 60 } as const;

/** Bound on how long a rate-limit check may block the request before failing open. */
export const RATE_LIMIT_TIMEOUT_MS = 500;

export interface RateLimitOptions {
  scope: string;
  ip: string | null;
  limit: number;
  windowSeconds: number;
  now?: Date;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * The raw IP is never stored: only its pseudonymous SHA-256 (not anonymous — reversible by
 * enumeration over the small IPv4/IPv6 space), namespaced by scope, kept at most ~48 h (purged
 * daily by cron of anything older than 24 h). `ip` is trusted only behind Vercel, which
 * overwrites the forwarding headers (see `clientIp`).
 */
export function rateLimitKey(scope: string, ip: string | null): string {
  return `${scope}:${createHash("sha256").update(ip ?? "unknown").digest("hex")}`;
}

/**
 * Fixed-window limit. Fails open: an error here must never take a public
 * page down (if the DB is down, the page fails anyway).
 */
export async function checkRateLimit(
  db: NodePgDatabase<typeof schema>,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  try {
    const windowMs = options.windowSeconds * 1000;
    const nowMs = (options.now ?? new Date()).getTime();
    const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;

    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Rate limit check timed out")), RATE_LIMIT_TIMEOUT_MS);
    });
    const hit = RateLimitRepository.hit(db, rateLimitKey(options.scope, options.ip), new Date(windowStartMs));
    const count = await Promise.race([hit, timeout]).finally(() => clearTimeout(timer));

    return {
      allowed: count <= options.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((windowStartMs + windowMs - nowMs) / 1000)),
    };
  } catch (error) {
    console.error("Rate limit check failed", error);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}
