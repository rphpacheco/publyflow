import { lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { rateLimitBuckets } from "@/db/schema/rate-limit";

export const RateLimitRepository = {
  /** Atomically counts one request in (key, window) and returns the new count. */
  async hit(db: NodePgDatabase<typeof schema>, key: string, windowStart: Date): Promise<number> {
    const [row] = await db
      .insert(rateLimitBuckets)
      .values({ key, windowStart, count: 1 })
      .onConflictDoUpdate({
        target: [rateLimitBuckets.key, rateLimitBuckets.windowStart],
        set: { count: sql`${rateLimitBuckets.count} + 1` },
      })
      .returning({ count: rateLimitBuckets.count });
    return row.count;
  },

  async purgeOlderThan(db: NodePgDatabase<typeof schema>, cutoff: Date): Promise<number> {
    const deleted = await db
      .delete(rateLimitBuckets)
      .where(lt(rateLimitBuckets.windowStart, cutoff))
      .returning({ key: rateLimitBuckets.key });
    return deleted.length;
  },
};
