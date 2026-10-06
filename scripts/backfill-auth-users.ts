import { parseArgs } from "node:util";
import type { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../src/db/schema";
import { getDb } from "../src/db/client";
import { createAuthAdmin } from "../src/lib/auth/auth-admin";
import { backfillAuthUsers, checkAuthUsers, describeTarget } from "../src/lib/auth/backfill-auth-users";

const USAGE = `Usage:
  pnpm backfill-auth-users [--check]

Creates a confirmed Supabase user for every OWNER/MANAGER/CREATOR member e-mail missing from auth.users (only OWNER/MANAGER rows are linked; creators never are).
--check is read-only: it lists the e-mails still missing and exits 1 when any exist. Run it before turning public sign-up off.`;

function printCheck(check: { missingInAuth: string[]; unlinked: number }): void {
  console.log(`missing in auth.users (BLOCKING): ${check.missingInAuth.length}`);
  for (const email of check.missingInAuth) console.log(`  ${email}`);
  console.log(`members without auth_user_id (informational): ${check.unlinked}`);
}

async function main() {
  const { values } = parseArgs({ options: { check: { type: "boolean" } } });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  if (!supabaseUrl || !serviceRoleKey || !databaseUrl) {
    console.error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL must be set in .env.local.\n\n" + USAGE);
    process.exit(1);
  }

  console.log(describeTarget(supabaseUrl, databaseUrl));

  const admin = createAuthAdmin(
    createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }),
  );
  // `getDb` erases the `$client` property drizzle attaches at runtime; added
  // back to close the pool (same as scripts/provision-user.ts).
  const db = getDb(databaseUrl) as NodePgDatabase<typeof schema> & { $client: Pool };

  let exitCode = 0;
  try {
    let failed = 0;
    if (!values.check) {
      const result = await backfillAuthUsers(db, admin);
      console.log(JSON.stringify(result, null, 2));
      failed = result.failed.length;
    }
    const check = await checkAuthUsers(db, admin);
    printCheck(check);
    if (failed > 0 || check.missingInAuth.length > 0) exitCode = 1;
  } finally {
    await db.$client.end();
  }
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
