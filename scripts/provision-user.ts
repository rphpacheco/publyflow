import { parseArgs } from "node:util";
import type { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../src/db/schema";
import { getDb } from "../src/db/client";
import { provisionUser, type AuthAdmin, type ProvisionUserInput } from "../src/lib/auth/provision-user";

const USAGE = `Usage:
  pnpm provision-user --email <e-mail> --name <nome> --role OWNER|MANAGER|CREATOR
                      (--org <organization-uuid> | --new-org <nome da organização>)
                      [--password <senha>]

Without --password, the user signs in with Google (same e-mail) and is linked on first login.`;

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
  if (!values.email || !values.name || (role !== "OWNER" && role !== "MANAGER" && role !== "CREATOR")) {
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
  const admin: AuthAdmin = {
    async createUser({ email, password }) {
      const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) {
        throw new Error(`Supabase could not create ${email}: ${error?.message ?? "unknown error"}`);
      }
      return { id: data.user.id };
    },
  };

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
  await db.$client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
