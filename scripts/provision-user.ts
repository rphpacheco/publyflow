import { parseArgs } from "node:util";
import type { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../src/db/schema";
import { getDb } from "../src/db/client";
import { createAuthAdmin } from "../src/lib/auth/auth-admin";
import { provisionUser, type ProvisionUserInput } from "../src/lib/auth/provision-user";

const USAGE = `Usage:
  pnpm provision-user --email <e-mail> --name <nome> --role OWNER|MANAGER
                      (--org <organization-uuid> | --new-org <nome da organização>)
                      [--password <senha>]

A confirmed Supabase user is always created. Without --password, the user signs in with Google or an e-mail link (same e-mail). --password is applied only when the Supabase user is created now; an existing user's password is never changed.
CREATOR is not accepted here: use the creator invite flow in the app instead.`;

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string" },
      org: { type: "string" },
      "new-org": { type: "string" },
      password: { type: "string" },
    },
  });

  const role = values.role;
  if (!values.email || !values.name || (role !== "OWNER" && role !== "MANAGER")) {
    console.error(USAGE);
    process.exit(1);
  }
  if (Boolean(values.org) === Boolean(values["new-org"])) {
    console.error("Pass exactly one of --org or --new-org.\n\n" + USAGE);
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  if (!supabaseUrl || !serviceRoleKey || !databaseUrl) {
    console.error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL must be set in .env.local.");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createAuthAdmin(supabase);

  const input: ProvisionUserInput = {
    email: values.email,
    fullName: values.name,
    role,
    organization: values.org ? { id: values.org } : { newName: values["new-org"]! },
    password: values.password,
  };

  // `getDb`'s declared return type is the plain `NodePgDatabase<typeof schema>`,
  // which erases the `$client` property that `drizzle()` actually attaches at
  // runtime (see drizzle-orm/node-postgres/driver.d.ts) -- so it's added back
  // here to close the pool once the script is done.
  const db = getDb(databaseUrl) as NodePgDatabase<typeof schema> & { $client: Pool };
  const result = await provisionUser(db, admin, input);
  console.log(JSON.stringify(result, null, 2));
  if (values.password && !result.createdAuthUser && result.authUserId === null) {
    console.error("Note: this e-mail already existed in Supabase; --password was not applied.");
  }
  await db.$client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
