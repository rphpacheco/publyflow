import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

const DOMAIN_TABLES = [
  "organization_members",
  "creators",
  "users",
  "organizations",
] as const;

export async function withTestDb() {
  const db = getDb(process.env.TEST_DATABASE_URL!);

  return {
    db,
    cleanup: async () => {
      for (const table of DOMAIN_TABLES) {
        try {
          await db.execute(sql.raw(`truncate table "${table}" cascade`));
        } catch (error) {
          // Tables introduced by later tasks may not exist yet in this
          // migration state; ignore "relation does not exist" (42P01) so
          // this helper stays usable incrementally across tasks.
          const code =
            (error as { code?: string; cause?: { code?: string } }).code ??
            (error as { cause?: { code?: string } }).cause?.code;
          if (code !== "42P01") {
            throw error;
          }
        }
      }
    },
  };
}
