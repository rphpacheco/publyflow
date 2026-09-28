import { describe, it, expect, afterEach } from "vitest";
import { withTestDb, getAppUserDb } from "@/test/helpers/db";
import { rateLimitBuckets } from "./schema/rate-limit";

describe("RLS on rate_limit_buckets", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("denies all access to the non-owner app_user role", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    await db.insert(rateLimitBuckets).values({
      key: "public-page:deadbeef",
      windowStart: new Date("2026-09-28T12:00:00Z"),
      count: 1,
    });

    const appDb = getAppUserDb();
    const visible = await appDb.select().from(rateLimitBuckets);

    expect(visible).toEqual([]);
  });
});
