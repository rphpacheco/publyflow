import { describe, it, expect, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { withTestDb } from "@/test/helpers/db";
import { rateLimitBuckets } from "@/db/schema/rate-limit";
import { RateLimitRepository } from "@/repositories/rate-limit.repository";
import { checkRateLimit, rateLimitKey } from "./rate-limit";

const at = (iso: string) => new Date(iso);

describe("checkRateLimit", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup?.();
  });

  it("allows up to the limit, then blocks until the window ends", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const options = { scope: "public-page", ip: "203.0.113.7", limit: 3, windowSeconds: 60 };

    for (let i = 0; i < 3; i += 1) {
      expect((await checkRateLimit(db, { ...options, now: at("2026-09-28T12:00:10Z") })).allowed).toBe(true);
    }
    expect(await checkRateLimit(db, { ...options, now: at("2026-09-28T12:00:30Z") })).toEqual({
      allowed: false,
      retryAfterSeconds: 30,
    });
    expect((await checkRateLimit(db, { ...options, now: at("2026-09-28T12:01:00Z") })).allowed).toBe(true);
  });

  it("rounds Retry-After up and never returns less than 1", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const options = { scope: "s", ip: "203.0.113.7", limit: 0, windowSeconds: 60 };

    expect((await checkRateLimit(db, { ...options, now: at("2026-09-28T12:00:59.500Z") })).retryAfterSeconds).toBe(1);
    expect((await checkRateLimit(db, { ...options, now: at("2026-09-28T12:00:10.200Z") })).retryAfterSeconds).toBe(50);
  });

  it("keeps IPs and scopes independent", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const now = at("2026-09-28T12:00:00Z");

    expect((await checkRateLimit(db, { scope: "a", ip: "203.0.113.7", limit: 1, windowSeconds: 60, now })).allowed).toBe(true);
    expect((await checkRateLimit(db, { scope: "a", ip: "203.0.113.8", limit: 1, windowSeconds: 60, now })).allowed).toBe(true);
    expect((await checkRateLimit(db, { scope: "b", ip: "203.0.113.7", limit: 1, windowSeconds: 60, now })).allowed).toBe(true);
    expect((await checkRateLimit(db, { scope: "a", ip: "203.0.113.7", limit: 1, windowSeconds: 60, now })).allowed).toBe(false);
  });

  it("stores only a hash of the IP", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    await checkRateLimit(db, { scope: "public-page", ip: "203.0.113.7", limit: 5, windowSeconds: 60 });

    const [row] = await db.select().from(rateLimitBuckets);
    expect(row.key).toBe(`public-page:${createHash("sha256").update("203.0.113.7").digest("hex")}`);
    expect(row.key).not.toContain("203.0.113.7");
    expect(rateLimitKey("x", null)).toBe(`x:${createHash("sha256").update("unknown").digest("hex")}`);
  });

  it("fails open and logs when the store errors", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    vi.spyOn(RateLimitRepository, "hit").mockRejectedValueOnce(new Error("db down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await checkRateLimit(db, { scope: "s", ip: "203.0.113.7", limit: 1, windowSeconds: 60 })).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(log).toHaveBeenCalledWith("Rate limit check failed", expect.any(Error));
  });
});
