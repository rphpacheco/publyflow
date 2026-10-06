import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { organizationMembers, users } from "@/db/schema/organizations";
import { UsersRepository } from "@/repositories/users.repository";
import type { AuthAdmin } from "./auth-admin";

// Operator-script logic: reads across organizations on purpose (like
// provisioning). Not tenant-scoped app code. Supabase calls are sequential and
// never run inside a DB transaction.

type Db = NodePgDatabase<typeof schema>;

export interface AuthCheckResult {
  missingInAuth: string[];
  unlinked: number;
}

export interface BackfillResult {
  created: string[];
  linked: string[];
  failed: string[];
}

async function memberUsers(db: Db) {
  const email = sql<string>`lower(${users.email})`;
  return db
    .selectDistinct({ id: users.id, email, authUserId: users.authUserId })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId));
}

export async function checkAuthUsers(db: Db, admin: AuthAdmin): Promise<AuthCheckResult> {
  const members = await memberUsers(db);
  const authEmails = await admin.listAuthEmails();
  const missing = members.filter((m) => !authEmails.has(m.email));
  return {
    missingInAuth: [...new Set(missing.map((m) => m.email))].sort(),
    unlinked: members.filter((m) => m.authUserId === null).length,
  };
}

export async function backfillAuthUsers(db: Db, admin: AuthAdmin): Promise<BackfillResult> {
  const { missingInAuth } = await checkAuthUsers(db, admin);
  const result: BackfillResult = { created: [], linked: [], failed: [] };

  for (const email of missingInAuth) {
    try {
      const { authUserId, created } = await admin.ensureAuthUser(email);
      if (!created) {
        console.warn(`${email}: already exists in Supabase, not linked`);
        continue;
      }
      result.created.push(email);
      if (!authUserId) continue;

      const [staff] = await db
        .selectDistinct({ id: users.id })
        .from(users)
        .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
        .where(
          and(
            sql`lower(${users.email}) = ${email}`,
            isNull(users.authUserId),
            inArray(organizationMembers.role, ["OWNER", "MANAGER"]),
          ),
        );
      if (staff && (await UsersRepository.linkAuthUser(db, staff.id, authUserId))) {
        result.linked.push(email);
      }
    } catch (error) {
      console.error(`backfill failed for ${email}:`, (error as Error).message ?? error);
      result.failed.push(email);
    }
  }
  return result;
}

// Credential-free description of what the backfill script is pointed at, so
// an operator can tell dev from production before trusting the output.
export function describeTarget(supabaseUrl: string, databaseUrl: string): string {
  const host = (raw: string, build: (u: URL) => string): string => {
    try {
      return build(new URL(raw));
    } catch {
      return "invalid-url";
    }
  };
  const supabase = host(supabaseUrl, (u) => u.host);
  const database = host(databaseUrl, (u) => `${u.host}${u.pathname}`);
  return `Target: supabase=${supabase} db=${database}`;
}
