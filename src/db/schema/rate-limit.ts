import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/** Fixed-window request counters for public surfaces. Global (not tenant data); no RLS. */
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.key, table.windowStart] }),
    index("rate_limit_buckets_window_idx").on(table.windowStart),
  ],
);
