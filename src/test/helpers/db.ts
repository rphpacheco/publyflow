import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

const DOMAIN_TABLES = [
  "messages",
  "contacts",
  "brands",
  "companies",
  "organization_members",
  "conversations",
  "creators",
  "users",
  "organizations",
] as const;

// Connects as `app_user`: a non-superuser, non-owner, non-BYPASSRLS role
// (see docker/test-db-init/01-app-user.sql). Unlike the `postgres`
// superuser `withTestDb()` uses for general setup/seeding, RLS policies
// are actually enforced for this role, so it's what tests that need to
// prove tenant isolation (e.g. src/db/rls-core.test.ts) should query
// through, once any setup rows they depend on already exist.
export function getAppUserDb() {
  return getDb(process.env.TEST_APP_DATABASE_URL!);
}

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
