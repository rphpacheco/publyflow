import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { getDb } from "./client";

describe("getDb", () => {
  it("connects and can run a trivial query", async () => {
    const db = getDb(process.env.TEST_DATABASE_URL!);
    const result = await db.execute(sql`select 1 as value`);
    expect(result.rows[0]).toEqual({ value: 1 });
  });
});
