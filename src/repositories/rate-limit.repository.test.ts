import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { rateLimitBuckets } from "@/db/schema/rate-limit";
import { RateLimitRepository } from "./rate-limit.repository";

describe("RateLimitRepository", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("increments atomically per key and window", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    const window = new Date("2026-09-28T12:00:00Z");

    expect(await RateLimitRepository.hit(db, "a", window)).toBe(1);
    expect(await RateLimitRepository.hit(db, "a", window)).toBe(2);
    expect(await RateLimitRepository.hit(db, "b", window)).toBe(1);
    expect(await RateLimitRepository.hit(db, "a", new Date("2026-09-28T12:01:00Z"))).toBe(1);

    const counts = await Promise.all(Array.from({ length: 5 }, () => RateLimitRepository.hit(db, "c", window)));
    expect(counts.sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
  });

  it("purges only windows older than the cutoff", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    await RateLimitRepository.hit(db, "old", new Date("2026-09-27T11:00:00Z"));
    await RateLimitRepository.hit(db, "new", new Date("2026-09-28T11:00:00Z"));

    expect(await RateLimitRepository.purgeOlderThan(db, new Date("2026-09-27T12:00:00Z"))).toBe(1);
    const rows = await db.select().from(rateLimitBuckets);
    expect(rows.map((row) => row.key)).toEqual(["new"]);
  });
});
