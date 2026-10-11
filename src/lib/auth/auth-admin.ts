import { createClient, type GoTrueAdminApi } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { AuthProvisioningError } from "./errors";

// Server-only: the service-role key bypasses every Supabase auth rule. Never
// import this module from a "use client" file. Callers run it AFTER their DB
// transaction commits -- never inside one (external call, lock time).

export interface EnsureAuthUserResult {
  authUserId: string | null;
  created: boolean;
}

export interface AuthAdmin {
  ensureAuthUser(email: string, options?: { password?: string }): Promise<EnsureAuthUserResult>;
  listAuthEmails(): Promise<Set<string>>;
}

type AdminClient = { auth: { admin: Pick<GoTrueAdminApi, "createUser" | "listUsers"> } };

const ALREADY_EXISTS = new Set(["email_exists", "user_already_exists"]);
const PAGE_SIZE = 1000;

export function createAuthAdmin(client: AdminClient): AuthAdmin {
  return {
    async ensureAuthUser(email, options = {}) {
      let result: Awaited<ReturnType<AdminClient["auth"]["admin"]["createUser"]>>;
      try {
        result = await client.auth.admin.createUser({
          email,
          email_confirm: true,
          ...(options.password ? { password: options.password } : {}),
        });
      } catch (error) {
        throw new AuthProvisioningError((error as { name?: string }).name ?? "unknown");
      }
      const { data, error } = result;
      if (error) {
        if (error.code && ALREADY_EXISTS.has(error.code)) return { authUserId: null, created: false };
        throw new AuthProvisioningError(error.code ?? String(error.status ?? "unknown"));
      }
      if (!data.user) throw new AuthProvisioningError("no_user_returned");
      return { authUserId: data.user.id, created: true };
    },

    async listAuthEmails() {
      const emails = new Set<string>();
      for (let page = 1; ; page++) {
        const { data, error } = await client.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
        if (error) throw new AuthProvisioningError(error.code ?? "list_users_failed");
        for (const user of data.users) if (user.email) emails.add(user.email.toLowerCase());
        if (data.users.length < PAGE_SIZE) return emails;
      }
    },
  };
}

let cached: AuthAdmin | null = null;

export function getAuthAdmin(): AuthAdmin {
  if (cached) return cached;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new AuthProvisioningError("missing_service_role_key");
  const { url } = getSupabaseEnv();
  cached = createAuthAdmin(createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }));
  return cached;
}
